import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  loadThreadViewState,
  restoreUnsentThreadViewState,
  saveThreadViewState,
} from "./thread-view-state";

// Run the screen's actual handler with controlled network and native dependencies.
const screen = readFileSync(new URL("../app/thread.tsx", import.meta.url), "utf8");
const source = screen.slice(
  screen.indexOf("  async function send()"),
  screen.indexOf("  async function stop()"),
);
const handler = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
let nextHarnessScope = 0;
function harness(attachments = false, reroute = false, routine = false) {
  const cacheScope = `send-test-${++nextHarnessScope}`;
  let liveScope = cacheScope;
  const viewKey = "bot:bot";
  loadThreadViewState(cacheScope, viewKey);
  let resolve!: (result: { seq: number }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ seq: number }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const state: Record<string, any> = {
    draft: "Hello",
    selectedSkill: null,
    selectedMentions: [],
    replyTarget: { id: "reply" },
    pendingAttachments: attachments ? [{ id: "file", threadKey: "bot", name: "note.txt" }] : [],
    attachmentNotice: null,
    sending: false,
    outgoing: null,
    error: null,
  };
  let current = true;
  const context: Record<string, any> = {
    ...state,
    cacheScope,
    viewKey,
    apiCacheScope: () => liveScope,
    captureApiRequestContext: async () => ({ apiBase: "test", headers: {} }),
    saveThreadViewState,
    restoreUnsentThreadViewState,
    viewState: {
      current: { ...state, distanceFromLatest: 0, expandedHistoryThreadId: null },
    },
    botId: "bot",
    groupId: undefined,
    sendInFlight: { current: false },
    attachmentsForThread: (items: any[], key: string) =>
      items.filter((item) => item.threadKey === key),
    serializeComposerPromptText: () => "Hello",
    mentionChipKey: (item: { id: string }) => item.id,
    resolveComposerSendPlan: () => ({
      isNoOp: false,
      shouldSend: !routine,
      shouldRunRoutines: routine,
      routineIds: ["routine"],
      trimmed: "Hello",
      mentionPayload: [],
      rerouteGroupId: reroute ? "group" : undefined,
    }),
    cancelFocusPrompt: vi.fn(),
    newClientNonce: () => "nonce",
    rpc: vi.fn(() => promise),
    loadSessionToken: () => Promise.resolve("token"),
    resumeLiveNotifications: vi.fn(),
    currentApiBase: () => "",
    selectedSpaceId: () => "space",
    router: { push: vi.fn() },
    t: (text: string) => text,
    isCurrentTarget: () => current,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  for (const key of [...Object.keys(state), "mentionQuery", "slashQuery"]) {
    context[`set${key[0]!.toUpperCase()}${key.slice(1)}`] = (value: any) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
      context.viewState.current = { ...context.viewState.current, [key]: state[key] };
    };
  }
  const send = new Function(
    "context",
    `const {${Object.keys(context).join(",")}} = context; ${handler}; return send;`,
  )(context) as () => Promise<void>;
  return {
    state,
    context,
    resolve,
    reject,
    send,
    rerender: () => {
      context.viewState.current = { ...context.viewState.current, ...state };
    },
    savedView: () => loadThreadViewState(cacheScope, viewKey),
    startNetwork: async () => {
      await Promise.resolve();
    },
    changeIdentity: () => {
      liveScope = `${cacheScope}-changed`;
      loadThreadViewState(liveScope, viewKey);
      current = false;
    },
    leave: () => {
      current = false;
    },
  };
}

describe("mobile composer send feedback", () => {
  it("clears before a slow response and preserves the next draft", async () => {
    const h = harness();
    const pending = h.send();
    expect(h.state.draft).toBe("");
    expect(h.state.outgoing.text).toBe("Hello");
    h.state.draft = "Next";
    h.rerender();
    h.resolve({ seq: 12 });
    await pending;
    expect(h.state.draft).toBe("Next");
    expect(h.state.outgoing.seq).toBe(12);
    expect(h.context.rpc.mock.calls[0][1].replyToMessageId).toBe("reply");
    expect(h.context.rpc.mock.calls[0][2]).toEqual({
      requestContext: { apiBase: "test", headers: {} },
    });
  });
  it("blocks duplicate taps before React rerenders", async () => {
    const h = harness();
    const pending = h.send();
    await h.send();
    expect(h.context.rpc).toHaveBeenCalledTimes(1);
    h.resolve({ seq: 12 });
    await pending;
  });
  it("restores failed text without losing a newer draft", async () => {
    const h = harness();
    const pending = h.send();
    h.state.draft = "Next";
    h.rerender();
    await h.startNetwork();
    h.reject(new Error("Offline"));
    await pending;
    expect(h.state.draft).toBe("Hello\nNext");
    expect(h.state.replyTarget.id).toBe("reply");
    expect(h.state.outgoing).toBeNull();
    expect(h.state.error).toBe("Offline");
    expect(h.state.sending).toBe(false);
  });
  it("restores failed uploads while retaining new attachments", async () => {
    const h = harness(true);
    const pending = h.send();
    expect(h.state.pendingAttachments).toEqual([]);
    h.state.pendingAttachments.push({ id: "new", threadKey: "bot" });
    await h.startNetwork();
    h.reject(new Error("Upload failed"));
    await pending;
    expect(h.state.pendingAttachments.map((item: { id: string }) => item.id)).toEqual([
      "file",
      "new",
    ]);
  });
  it("does not restore an accepted message after refresh failure", async () => {
    const h = harness();
    h.context.refresh.mockRejectedValue(new Error("Refresh failed"));
    const pending = h.send();
    h.resolve({ seq: 12 });
    await pending;
    expect(h.state.draft).toBe("");
    expect(h.state.outgoing.seq).toBe(12);
  });
  it("does not restore an old draft into a different chat", async () => {
    const h = harness();
    const pending = h.send();
    h.leave();
    h.state.draft = "Other chat";
    await h.startNetwork();
    h.reject(new Error("Offline"));
    await pending;
    expect(h.state.draft).toBe("Other chat");
    expect(h.state.error).toBeNull();
    expect(h.savedView()?.draft).toBe("Hello");
  });
  it("clears routine-only submissions before the response", async () => {
    const h = harness(false, false, true);
    const pending = h.send();
    expect(h.state.draft).toBe("");
    h.resolve({ seq: 12 });
    await pending;
    expect(h.state.outgoing).toBeNull();
    expect(h.context.rpc.mock.calls[0][0]).toBe("routines/testRun");
  });
  it("does not send into a changed identity after an attachment upload finishes", async () => {
    const h = harness(true);
    const pending = h.send();
    await h.startNetwork();
    expect(h.context.rpc.mock.calls[0][0]).toBe("artifacts/create");
    h.changeIdentity();
    h.resolve({ seq: 12 });
    await pending;
    expect(h.context.rpc).toHaveBeenCalledTimes(1);
    expect(h.state.draft).toBe("");
    expect(h.state.error).toBeNull();
  });
  it("reroutes group mentions with immediate feedback", async () => {
    const h = harness(false, true);
    const pending = h.send();
    expect(h.state.draft).toBe("");
    h.resolve({ seq: 12 });
    await pending;
    expect(h.context.rpc.mock.calls[0][1].groupId).toBe("group");
    expect(h.context.rpc.mock.calls[0][1].replyToMessageId).toBeUndefined();
    expect(h.context.router.push).toHaveBeenCalledTimes(1);
  });
});
