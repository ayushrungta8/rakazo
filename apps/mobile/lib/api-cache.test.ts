import * as SecureStore from "expo-secure-store";
import { beforeEach, expect, it, vi } from "vitest";
import { apiCacheScope, loadApiBase, peekRpc, rpc, selectSpace, writeRpcSnapshot } from "./api";
import { clearSessionToken, saveSessionToken } from "./session";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("./live-notifications", () => ({
  stopLiveNotifications: vi.fn(async () => undefined),
  resumeLiveNotifications: vi.fn(async () => undefined),
}));
vi.mock("./ai-consent", () => ({ promptAiConsent: vi.fn() }));

beforeEach(async () => {
  const store = new Map<string, string>();
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => store.get(key) ?? null);
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    store.set(key, value);
  });
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    store.delete(key);
  });
  await clearSessionToken();
  await loadApiBase();
  await saveSessionToken("fake-session-A");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ json: { name: "fresh" } })),
  );
});

it("deduplicates concurrent reads but always refreshes unless cache use is explicit", async () => {
  await Promise.all([rpc("bots/list"), rpc("bots/list")]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(peekRpc("bots/list")).toEqual({ name: "fresh" });
  await rpc("bots/list", {}, { cache: "prefer-cache" });
  expect(fetch).toHaveBeenCalledTimes(1);
  await rpc("bots/list");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("separates bot/group requests and caller-owned abort signals", async () => {
  await Promise.all([rpc("threads/get", { botId: "a" }), rpc("threads/get", { groupId: "a" })]);
  expect(fetch).toHaveBeenCalledTimes(2);
  const abort = new AbortController();
  await Promise.all([rpc("bots/list"), rpc("bots/list", {}, { signal: abort.signal })]);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("clears snapshots for session/Space changes including returning to the same Space", async () => {
  await selectSpace("space-A");
  const first = apiCacheScope();
  writeRpcSnapshot("threads/get", { botId: "a" }, { text: "private A" });
  await selectSpace("space-B");
  await selectSpace("space-A");
  expect(apiCacheScope()).not.toBe(first);
  expect(peekRpc("threads/get", { botId: "a" })).toBeUndefined();
  writeRpcSnapshot("bots/list", {}, ["private A"]);
  await saveSessionToken("fake-session-B");
  expect(peekRpc("bots/list")).toBeUndefined();
});

it("purges successful mutations and inaccessible resources but leaves mark-read neutral", async () => {
  writeRpcSnapshot("bots/list", {}, ["saved"]);
  await rpc("threads/markRead", { botId: "a" });
  expect(peekRpc("bots/list")).toEqual(["saved"]);
  await rpc("bots/remove", { botId: "a" });
  expect(peekRpc("bots/list")).toBeUndefined();
  writeRpcSnapshot("bots/list", {}, ["deleted"]);
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: { message: "Forbidden" } }, { status: 403 }),
  );
  await expect(rpc("bots/list")).rejects.toMatchObject({ status: 403 });
  expect(peekRpc("bots/list")).toBeUndefined();
});

it("does not repopulate a signed-out session with an in-flight response", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = rpc("bots/list");
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await clearSessionToken();
  finish(Response.json({ json: ["old account"] }));
  await pending;
  expect(peekRpc("bots/list")).toBeUndefined();
});
