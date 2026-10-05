import { describe, expect, it, vi } from "vitest";
import { ResourceCache, resourceKey } from "./resource-cache";

describe("process-local resource snapshots", () => {
  it("shares overlapping reads and returns the snapshot synchronously", async () => {
    const cache = new ResourceCache();
    let resolve!: (value: string[]) => void;
    const load = vi.fn(
      () =>
        new Promise<string[]>((done) => {
          resolve = done;
        }),
    );
    const first = cache.fetch("chat", load);
    const second = cache.fetch("chat", load);
    await Promise.resolve();
    resolve(["reply"]);
    expect(await first).toEqual(["reply"]);
    expect(await second).toEqual(["reply"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.peek("chat")).toEqual(["reply"]);
  });

  it.each(["invalidate", "resetIdentity"] as const)(
    "does not resurrect late reads after %s",
    async (operation) => {
      const cache = new ResourceCache();
      let resolve!: (value: string) => void;
      const pending = cache.fetch(
        "chat",
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
      await Promise.resolve();
      cache[operation]();
      cache.write("chat", "new");
      resolve("old");
      await pending;
      expect(cache.peek("chat")).toBe("new");
    },
  );

  it("keeps account/Space transitions distinct even when returning to the first identity", () => {
    const cache = new ResourceCache();
    const first = cache.scope();
    cache.write(`${first}:chat`, "private");
    cache.resetIdentity();
    cache.resetIdentity();
    expect(cache.scope()).not.toBe(first);
    expect(cache.peek(`${first}:chat`)).toBeUndefined();
  });

  it("keeps newer live changes when an older network snapshot finishes", async () => {
    const cache = new ResourceCache();
    let resolve!: (value: string) => void;
    const pending = cache.fetch(
      "chat",
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    await Promise.resolve();
    cache.write("chat", "new live reply");
    resolve("old server reply");
    await pending;
    expect(cache.peek("chat")).toBe("new live reply");
  });

  it("expires stale content and bounds snapshot count by recent usage", () => {
    let now = 0;
    const cache = new ResourceCache(() => now, 2, 500);
    cache.write("a", 1);
    cache.write("b", 2);
    expect(cache.peek("a")).toBe(1);
    cache.write("c", 3);
    expect(cache.peek("b")).toBeUndefined();
    now = 501;
    expect(cache.peek("a")).toBeUndefined();
    expect(cache.peek("c")).toBeUndefined();
  });

  it("retries failed reads without discarding an unexpired offline snapshot", async () => {
    const cache = new ResourceCache();
    cache.write("chat", "last reply");
    await expect(cache.fetch("chat", () => Promise.reject(new Error("offline")))).rejects.toThrow(
      "offline",
    );
    expect(cache.peek("chat")).toBe("last reply");
    await expect(cache.fetch("chat", () => Promise.resolve("fresh reply"))).resolves.toBe(
      "fresh reply",
    );
  });

  it("uses equivalent query keys without conflating bot/group or pagination", () => {
    expect(resourceKey({ limit: 40, botId: "a" })).toBe(
      resourceKey({ botId: "a", limit: 40, before: undefined }),
    );
    expect(resourceKey({ botId: "a" })).not.toBe(resourceKey({ groupId: "a" }));
    expect(resourceKey({ botId: "a", before: 2 })).not.toBe(resourceKey({ botId: "a", before: 3 }));
  });
});
