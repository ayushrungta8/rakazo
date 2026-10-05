import { PeerConversationPageSchema, PeerMessagePageSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { loadPeerConversationPage, loadPeerMessagePage } from "./peer-message-pages.js";

describe("bounded peer activity queries", () => {
  it("uses one bounded query and returns chronological receipts with a tuple cursor", async () => {
    const rows = Array.from({ length: 41 }, (_, index) => ({
      historyGeneration: 2,
      messageId: `message-${50 - index}`,
      seq: 50 - index,
      blockIndex: 1,
      direction: "received",
      peerBotId: "peer",
      peerBotName: "Specialist",
      text: "Synthetic result",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }));
    const $queryRaw = vi.fn(async (_query: unknown) => rows);
    const page = await loadPeerMessagePage(
      { $queryRaw } as unknown as PrismaClient,
      "thread",
      "peer",
      { seq: 60, blockIndex: 3 },
    );
    expect(page.messages).toHaveLength(40);
    expect(page.messages[0]?.seq).toBe(11);
    expect(page.messages.at(-1)?.seq).toBe(50);
    expect(page.olderCursor).toEqual({ seq: 11, blockIndex: 1 });
    expect(PeerMessagePageSchema.safeParse(page).success).toBe(true);
    expect($queryRaw).toHaveBeenCalledOnce();
    const query = $queryRaw.mock.calls[0]![0] as unknown as { text: string; values: unknown[] };
    expect(query.text).toContain("jsonb_array_elements");
    expect(query.text).toContain("b.ordinality - 1 <");
    expect(query.values).toContain(41);
    expect(query.values).toContain("thread");
    expect(query.values).toContain("peer");
  });

  it("retains deletion generation for an empty detail page", async () => {
    const $queryRaw = vi.fn(async (_query: unknown) => [{ historyGeneration: 7, messageId: null }]);
    const page = await loadPeerMessagePage(
      { $queryRaw } as unknown as PrismaClient,
      "thread",
      "peer",
    );
    expect(page).toEqual({
      threadId: "thread",
      historyGeneration: 7,
      messages: [],
      olderCursor: null,
    });
  });

  it("bounds summary payloads and handles multi-peer receipt ties", async () => {
    const $queryRaw = vi.fn(async (_query: unknown) =>
      Array.from({ length: 31 }, (_, index) => ({
        historyGeneration: 1,
        peerBotId: `peer-${index}`,
        peerBotName: "Specialist",
        lastSeq: 100,
        lastAt: new Date("2026-01-01T00:00:00.000Z"),
        lastDirection: "sent",
        lastText: "🧠".repeat(160),
      })),
    );
    const page = await loadPeerConversationPage(
      { $queryRaw } as unknown as PrismaClient,
      "thread",
      { lastSeq: 110, peerBotId: "previous" },
    );
    expect(page.conversations).toHaveLength(30);
    expect(page.conversations[0]?.lastText).toHaveLength(160);
    expect(page.nextCursor).toEqual({ lastSeq: 100, peerBotId: "peer-29" });
    expect(PeerConversationPageSchema.safeParse(page).success).toBe(true);
    const query = $queryRaw.mock.calls[0]![0] as unknown as { text: string; values: unknown[] };
    expect(query.text).toContain('DISTINCT ON ("peerBotId")');
    expect(query.values).toContain(31);
    expect(query.values).toContain("previous");
  });

  it("returns an empty cleared summary with its generation", async () => {
    const $queryRaw = vi.fn(async (_query: unknown) => [{ historyGeneration: 3, peerBotId: null }]);
    const page = await loadPeerConversationPage({ $queryRaw } as unknown as PrismaClient, "thread");
    expect(page).toEqual({
      threadId: "thread",
      historyGeneration: 3,
      conversations: [],
      nextCursor: null,
    });
  });
});
