import { readFileSync } from "node:fs";
import { mergeThreadHistory } from "@rakazo/core";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { MobileMessage, MobileSnapshot } from "./api";
import { isOlderThreadSnapshot } from "./thread-view-state";

// Exercise the screen's actual refresh with a controlled network completion order.
const screen = readFileSync(new URL("../app/thread.tsx", import.meta.url), "utf8");
const handler = ts.transpileModule(
  screen.slice(screen.indexOf("  async function refresh("), screen.indexOf("  const refreshRef")),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

class RpcError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function message(id: string, seq: number): MobileMessage {
  return { id, seq, role: "user", blocks: [{ kind: "text", text: id }] };
}

function snapshot(cursor: number, messages = [message("cached", 1)]): MobileSnapshot {
  return { threadId: "thread-1", cursor, messages, olderCursor: null, run: null };
}

function harness(current = snapshot(10)) {
  let resolve!: (snapshot: MobileSnapshot) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<MobileSnapshot>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let scope = "scope-a";
  let revision = 0;
  const snapRef = { current: current as MobileSnapshot | null };
  const historyEpoch = { current: 0 };
  const expandedHistoryThread = { current: null as string | null };
  const commitSnap = vi.fn((next: MobileSnapshot | null) => {
    snapRef.current = next;
  });
  const setRefreshError = vi.fn();
  const setReplyTarget = vi.fn();
  const context = {
    botId: "bot-1",
    groupId: undefined,
    activeBotId: { current: "bot-1" },
    activeGroupId: { current: undefined },
    snapRef,
    historyEpoch,
    expandedHistoryThread,
    apiCacheRevision: () => revision,
    isCurrentTarget: () => scope === "scope-a",
    rpc: vi.fn(() => pending),
    MobileRpcError: RpcError,
    isOlderThreadSnapshot,
    shouldApplyMobileThreadRefresh: (input: { requestEpoch: number; currentEpoch: number }) =>
      input.requestEpoch === input.currentEpoch,
    mergeMobileSnapshot: (prev: MobileSnapshot | null, next: MobileSnapshot, preserve: boolean) =>
      mergeThreadHistory<MobileMessage, MobileSnapshot>(prev, next, preserve),
    commitSnap,
    setRefreshError,
    setReplyTarget,
    t: (text: string) => text,
  };
  const refresh = new Function(
    "context",
    `const {${Object.keys(context).join(",")}} = context; ${handler}; return refresh;`,
  )(context) as () => Promise<MobileSnapshot | undefined>;
  return {
    refresh,
    resolve,
    reject,
    commitSnap,
    snapRef,
    setRefreshError,
    setReplyTarget,
    historyEpoch,
    expandedHistoryThread,
    mutateElsewhere: () => revision++,
    changeIdentity: () => {
      scope = "scope-b";
    },
  };
}

describe("chat background refresh", () => {
  it("retains newer live content when an older GET completes", async () => {
    const h = harness();
    const pending = h.refresh();
    h.snapRef.current = snapshot(12, [message("live", 12)]);
    h.resolve(snapshot(11));
    await pending;
    expect(h.commitSnap).not.toHaveBeenCalled();
    expect(h.snapRef.current?.messages[0]?.id).toBe("live");
  });

  it("cannot manually cache a response from before an external clear or deletion", async () => {
    const h = harness();
    const pending = h.refresh();
    h.mutateElsewhere();
    h.resolve(snapshot(11));
    await pending;
    expect(h.commitSnap).not.toHaveBeenCalled();
  });

  it("cannot revive history after a live clear advances the epoch", async () => {
    const h = harness();
    const pending = h.refresh();
    h.historyEpoch.current++;
    h.snapRef.current = snapshot(20, []);
    h.resolve(snapshot(11));
    await pending;
    expect(h.commitSnap).not.toHaveBeenCalled();
    expect(h.snapRef.current?.messages).toEqual([]);
  });

  it("discards a response after the account or Space changes", async () => {
    const h = harness();
    const pending = h.refresh();
    h.changeIdentity();
    h.resolve(snapshot(11));
    await pending;
    expect(h.commitSnap).not.toHaveBeenCalled();
  });

  it("retains useful content offline and exposes a retry error", async () => {
    const h = harness();
    const pending = h.refresh();
    h.reject(new Error("Network request failed"));
    await expect(pending).rejects.toThrow("Network request failed");
    expect(h.commitSnap).not.toHaveBeenCalled();
    expect(h.snapRef.current?.messages[0]?.id).toBe("cached");
    expect(h.setRefreshError).toHaveBeenCalledWith("Network request failed");
  });

  it("hides inaccessible cached content and its reply target", async () => {
    const h = harness();
    const pending = h.refresh();
    h.reject(new RpcError("Not found", 404));
    await expect(pending).rejects.toThrow("Not found");
    expect(h.commitSnap).toHaveBeenCalledWith(null);
    expect(h.setReplyTarget).toHaveBeenCalledWith(null);
  });

  it("keeps expanded history while reconciling current messages", async () => {
    const previous = snapshot(
      200,
      Array.from({ length: 200 }, (_, seq) => message(`m${seq}`, seq)),
    );
    previous.olderCursor = 0;
    const h = harness(previous);
    h.expandedHistoryThread.current = previous.threadId;
    const pending = h.refresh();
    h.resolve(snapshot(201, [message("m199", 199), message("m200", 200)]));
    await pending;
    expect(h.snapRef.current?.messages).toHaveLength(201);
    expect(h.snapRef.current?.messages.at(-1)?.id).toBe("m200");
    expect(h.snapRef.current?.olderCursor).toBe(0);
  });
});
