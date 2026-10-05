import type { PeerConversationPage, PeerMessagePage } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { mergePeerConversationPage, mergePeerMessagePage } from "./peer-activity";

function messages(seqs: number[], generation = 0): PeerMessagePage {
  return {
    threadId: "thread",
    historyGeneration: generation,
    olderCursor: { seq: seqs[0] ?? 0, blockIndex: 0 },
    messages: seqs.map((seq) => ({
      messageId: `message-${seq}`,
      seq,
      blockIndex: 0,
      direction: "received",
      peerBotId: "peer",
      peerBotName: "Specialist",
      text: String(seq),
      createdAt: "2026-01-01T00:00:00.000Z",
    })),
  };
}
function conversations(
  ids: string[],
  seqs = ids.map((_, i) => 100 - i),
  generation = 0,
): PeerConversationPage {
  return {
    threadId: "thread",
    historyGeneration: generation,
    nextCursor: { lastSeq: seqs.at(-1) ?? 0, peerBotId: ids.at(-1) ?? "last" },
    conversations: ids.map((peerBotId, index) => ({
      peerBotId,
      peerBotName: peerBotId,
      lastSeq: seqs[index]!,
      lastAt: "2026-01-01T00:00:00.000Z",
      lastDirection: "received",
      lastText: peerBotId,
    })),
  };
}

describe("Team activity pages", () => {
  it("keeps explicitly loaded older entries and their cursor during a newest-page refresh", () => {
    const current = messages([1, 2, 3, 4]);
    const page = messages([3, 4, 5]);
    page.messages[0]!.text = "Updated receipt";
    const merged = mergePeerMessagePage(current, page);
    expect(merged.messages.map((message) => message.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(merged.messages[2]!.text).toBe("Updated receipt");
    expect(merged.olderCursor).toEqual(current.olderCursor);
  });

  it("preserves distinct receipt blocks in one message across a cursor boundary", () => {
    const current = messages([4]);
    current.messages[0]!.blockIndex = 1;
    const older = messages([4]);
    const merged = mergePeerMessagePage(current, older, true);
    expect(merged.messages.map((message) => message.blockIndex)).toEqual([0, 1]);
    expect(merged.olderCursor).toEqual(older.olderCursor);
  });

  it("ends pagination without dropping opened entries when an older page is empty", () => {
    const current = messages([1, 2]);
    const merged = mergePeerMessagePage(current, messages([]), true);
    expect(merged.messages).toEqual(current.messages);
    expect(merged.olderCursor).toBeNull();
  });

  it("drops cached history after a clear even when new conversation content exists", () => {
    expect(
      mergePeerMessagePage(messages([1, 2]), messages([3], 1)).messages.map(
        (message) => message.seq,
      ),
    ).toEqual([3]);
    expect(
      mergePeerMessagePage(messages([3], 1), messages([1, 2]), true).messages.map(
        (message) => message.seq,
      ),
    ).toEqual([3]);
    expect(mergePeerMessagePage(messages([1, 2]), messages([])).messages).toEqual([]);
  });

  it("updates peer names, avoids duplicate summaries, and keeps opened older peers", () => {
    const current = conversations(["a", "b", "c"], [5, 4, 3]);
    const refresh = conversations(["b", "d"], [8, 6]);
    refresh.conversations[0]!.peerBotName = "Renamed specialist";
    const merged = mergePeerConversationPage(current, refresh);
    expect(merged.conversations.map((entry) => entry.peerBotId)).toEqual(["b", "d", "a", "c"]);
    expect(merged.conversations[0]!.peerBotName).toBe("Renamed specialist");
    expect(merged.nextCursor).toEqual({ lastSeq: 3, peerBotId: "c" });
  });

  it("does not let a delayed older summary roll a peer's latest activity back", () => {
    const current = conversations(["a"], [10]);
    const merged = mergePeerConversationPage(current, conversations(["a", "b"], [4, 3]), true);
    expect(merged.conversations.map((entry) => entry.lastSeq)).toEqual([10, 3]);
    expect(mergePeerConversationPage(current, conversations([], [], 1)).conversations).toEqual([]);
  });
});
