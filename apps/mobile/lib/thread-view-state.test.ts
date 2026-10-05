import { describe, expect, it } from "vitest";
import type { MobileSnapshot } from "./api";
import { mobileResourceCache } from "./resource-cache";
import {
  isOlderThreadSnapshot,
  loadThreadViewState,
  restoreUnsentThreadViewState,
  saveThreadViewState,
  type ThreadViewState,
} from "./thread-view-state";

function view(overrides: Partial<ThreadViewState> = {}): ThreadViewState {
  return {
    draft: "",
    selectedMentions: [],
    selectedSkill: null,
    pendingAttachments: [],
    replyTarget: null,
    attachmentNotice: null,
    distanceFromLatest: 0,
    expandedHistoryThreadId: null,
    ...overrides,
  };
}

function snapshot(cursor: number, threadId = "thread-1"): MobileSnapshot {
  return { threadId, messages: [], olderCursor: null, run: null, cursor };
}

describe("native chat reopening state", () => {
  it("restores each bot and group independently without persisting a snapshot", () => {
    loadThreadViewState("scope-1", "bot:one", 0);
    saveThreadViewState("scope-1", "bot:one", view({ draft: "first" }), 0);
    saveThreadViewState("scope-1", "group:one", view({ draft: "group" }), 0);
    expect(loadThreadViewState("scope-1", "bot:one", 100)?.draft).toBe("first");
    expect(loadThreadViewState("scope-1", "group:one", 100)?.draft).toBe("group");
  });

  it("drops all previous identity state and rejects a late cleanup or failed send", () => {
    loadThreadViewState("scope-2", "bot:one", 0);
    saveThreadViewState("scope-2", "bot:one", view({ draft: "private" }), 0);
    expect(loadThreadViewState("scope-3", "bot:one", 100)).toBeUndefined();
    saveThreadViewState("scope-2", "bot:one", view({ draft: "late" }), 100);
    expect(restoreUnsentThreadViewState("scope-2", "bot:one", view(), view())).toBeUndefined();
    expect(loadThreadViewState("scope-3", "bot:one", 100)).toBeUndefined();
    expect(loadThreadViewState("scope-4", "bot:one", 100)).toBeUndefined();
  });

  it("expires old navigation state while keeping an unfinished draft", () => {
    loadThreadViewState("scope-5", "bot:one", 0);
    saveThreadViewState(
      "scope-5",
      "bot:one",
      view({ draft: "keep this", distanceFromLatest: 600, expandedHistoryThreadId: "thread-1" }),
      0,
    );
    saveThreadViewState("scope-5", "bot:two", view({ distanceFromLatest: 400 }), 0);
    const restored = loadThreadViewState("scope-5", "bot:one", 300_000);
    expect(restored?.draft).toBe("keep this");
    expect(restored?.distanceFromLatest).toBe(0);
    expect(restored?.expandedHistoryThreadId).toBeNull();
    expect(loadThreadViewState("scope-5", "bot:two", 300_000)).toBeUndefined();
  });

  it("bounds retained navigation and keeps the most recently opened one", () => {
    loadThreadViewState("scope-6", "bot:0", 0);
    for (let index = 0; index < 12; index++)
      saveThreadViewState("scope-6", `bot:${index}`, view({ distanceFromLatest: 100 }), 0);
    loadThreadViewState("scope-6", "bot:0", 1);
    saveThreadViewState("scope-6", "bot:12", view(), 1);
    expect(loadThreadViewState("scope-6", "bot:0", 2)?.distanceFromLatest).toBe(100);
    expect(loadThreadViewState("scope-6", "bot:1", 2)).toBeUndefined();
  });

  it("retains every unfinished composer after opening more than twelve threads", () => {
    loadThreadViewState("scope-many", "bot:0", 0);
    for (let index = 0; index < 30; index++)
      saveThreadViewState(
        "scope-many",
        `bot:${index}`,
        view({ draft: `Draft ${index}`, distanceFromLatest: 500 }),
        0,
      );
    for (let index = 0; index < 30; index++)
      expect(loadThreadViewState("scope-many", `bot:${index}`, 3_600_000)?.draft).toBe(
        `Draft ${index}`,
      );
    expect(loadThreadViewState("scope-many", "bot:0", 3_600_000)?.distanceFromLatest).toBe(0);
    saveThreadViewState("scope-many", "bot:0", view(), 3_600_000);
    expect(loadThreadViewState("scope-many", "bot:0", 3_900_000)).toBeUndefined();
    expect(loadThreadViewState("scope-many-reset", "bot:1", 3_900_000)).toBeUndefined();
  });

  it("clears retained composers immediately when API identity resets", () => {
    loadThreadViewState("scope-reset", "bot:one", 0);
    saveThreadViewState("scope-reset", "bot:one", view({ draft: "private" }), 0);
    mobileResourceCache.resetIdentity();
    saveThreadViewState("scope-reset", "bot:one", view({ draft: "late cleanup" }), 1);
    expect(loadThreadViewState("scope-reset", "bot:one", 1)).toBeUndefined();
  });

  it("restores a failed closed-screen send alongside newer typing and attachments", () => {
    loadThreadViewState("scope-7", "bot:one");
    const attachment = {
      id: "file-1",
      threadKey: "one",
      name: "note.txt",
      mimeType: "text/plain" as const,
      contentBase64: "dGVzdA==",
    };
    const submitted = view({
      draft: "original",
      pendingAttachments: [attachment],
      selectedMentions: [{ kind: "bot", id: "bot-2", name: "Second" }],
    });
    saveThreadViewState(
      "scope-7",
      "bot:one",
      view({ draft: "newer", pendingAttachments: [attachment] }),
    );
    const restored = restoreUnsentThreadViewState("scope-7", "bot:one", submitted, view());
    expect(restored?.draft).toBe("original\nnewer");
    expect(restored?.pendingAttachments).toHaveLength(1);
    expect(restored?.selectedMentions).toEqual(submitted.selectedMentions);
    expect(loadThreadViewState("scope-7", "bot:one")).toEqual(restored);
  });

  it("does not resurrect a composer cleared after an accepted send", () => {
    loadThreadViewState("scope-8", "bot:one");
    saveThreadViewState("scope-8", "bot:one", view({ draft: "old" }));
    saveThreadViewState("scope-8", "bot:one", view());
    expect(loadThreadViewState("scope-8", "bot:one")?.draft).toBe("");
  });
});

describe("chat refresh ordering", () => {
  it("rejects an older GET after a newer live event but permits equal or newer snapshots", () => {
    expect(isOlderThreadSnapshot(snapshot(12), snapshot(11))).toBe(true);
    expect(isOlderThreadSnapshot(snapshot(12), snapshot(12))).toBe(false);
    expect(isOlderThreadSnapshot(snapshot(12), snapshot(13))).toBe(false);
  });

  it("does not compare cursors across distinct threads or before initial load", () => {
    expect(isOlderThreadSnapshot(snapshot(12), snapshot(1, "thread-2"))).toBe(false);
    expect(isOlderThreadSnapshot(null, snapshot(1))).toBe(false);
  });
});
