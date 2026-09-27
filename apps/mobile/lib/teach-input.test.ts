import { describe, expect, it, vi } from "vitest";
import type { TeachInput } from "./teach-input";
import { createTeachInputQueue } from "./teach-input";

const pointer = (type: string, x: number): TeachInput => ({
  kind: "pointer",
  payload: { type, x, y: 0, button: "left" },
});
describe("teaching input queue", () => {
  it("coalesces waiting moves and keeps final movement before release and keys", async () => {
    let unlock!: () => void;
    const first = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const sent: TeachInput[] = [];
    const queue = createTeachInputQueue(async (input) => {
      sent.push(input);
      if (sent.length === 1) await first;
    }, vi.fn());
    queue.push(pointer("down", 1));
    queue.push(pointer("move", 2));
    queue.push(pointer("move", 3));
    queue.push(pointer("move", 4));
    queue.push(pointer("up", 4));
    queue.push({ kind: "key", payload: { key: "Return" } });
    unlock();
    await queue.drain();
    expect(sent).toEqual([
      pointer("down", 1),
      pointer("move", 4),
      pointer("up", 4),
      { kind: "key", payload: { key: "Return" } },
    ]);
  });
  it("fails closed after uncertain sandbox input instead of replaying later actions", async () => {
    const error = new Error("connection lost");
    const onError = vi.fn();
    const send = vi.fn().mockRejectedValue(error);
    const queue = createTeachInputQueue(send, onError);
    queue.push(pointer("down", 1));
    queue.push(pointer("move", 2));
    await expect(queue.drain()).rejects.toBe(error);
    queue.push(pointer("down", 3));
    await expect(queue.drain()).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });
  it("drains already accepted actions on leaving but rejects new input", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const queue = createTeachInputQueue(send, vi.fn());
    queue.push(pointer("down", 1));
    queue.push(pointer("up", 1));
    queue.close();
    queue.push(pointer("down", 5));
    await queue.drain();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("waits for compensating release before allowing a fresh input session", async () => {
    let release!: () => void;
    const safety = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValue({ ok: true });
    const queue = createTeachInputQueue(send, () => safety);
    queue.push(pointer("down", 1));
    await Promise.resolve();
    expect(() => queue.reset()).toThrow("Input is still pending");
    release();
    await expect(queue.drain()).rejects.toThrow("lost response");
    queue.reset();
    queue.push(pointer("down", 7));
    await queue.drain();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual(pointer("down", 7));
  });
});
