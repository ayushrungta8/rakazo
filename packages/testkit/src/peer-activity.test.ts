import { PeerConversationPageSchema, PeerMessagePageSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { createDb } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadPeerConversationPage,
  loadPeerMessagePage,
} from "../../../apps/api/src/peer-message-pages.js";

const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeDatabase = enabled ? describe : describe.skip;

describeDatabase("peer activity PostgreSQL pagination", () => {
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  beforeAll(() => {
    const client = createDb(process.env.DATABASE_URL!, { poolMax: 1 });
    prisma = client.prisma;
    close = async () => {
      await prisma.$disconnect();
      await client.pool.end();
    };
  });
  afterAll(async () => {
    await close?.();
  });

  it("filters 1,000 ordinary rows, pages receipt blocks without gaps, and summarizes peers without bodies", async () => {
    await prisma.$transaction(async (tx) => {
      // Session-local tables shadow the production schema only for this transaction.
      // All data is synthetic; ON COMMIT DROP leaves no rows or schema behind.
      await tx.$executeRaw`CREATE TEMP TABLE threads (id text, "historyCompactionGeneration" int) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE messages (id text, "threadId" text, seq int, blocks jsonb, "createdAt" timestamp) ON COMMIT DROP`;
      await tx.$executeRaw`INSERT INTO threads VALUES ('fixture-thread', 2), ('empty-thread', 7)`;
      await tx.$executeRaw`
        INSERT INTO messages
        SELECT 'ordinary-' || s, 'fixture-thread', s,
          jsonb_build_array(jsonb_build_object('kind', 'text', 'text', 'Synthetic ordinary message')),
          TIMESTAMP '2026-01-01' + s * INTERVAL '1 second'
        FROM generate_series(1, 1000) s
      `;
      await tx.$executeRaw`
        INSERT INTO messages
        SELECT 'receipt-' || s, 'fixture-thread', 1000 + s,
          jsonb_build_array(
            jsonb_build_object('kind', 'bot_message_sent', 'toBotId', 'peer-target', 'toBotName', 'Target', 'text', 'Synthetic brief ' || s),
            jsonb_build_object('kind', 'bot_message_received', 'fromBotId', 'peer-target', 'fromBotName', 'Target', 'text', 'Synthetic internal result ' || s),
            jsonb_build_object('kind', 'bot_message_received', 'fromBotId', 'peer-other', 'fromBotName', 'Other', 'text', 'Unrelated synthetic result')
          ), TIMESTAMP '2026-01-01' + (1000 + s) * INTERVAL '1 second'
        FROM generate_series(1, 30) s
      `;
      await tx.$executeRaw`
        INSERT INTO messages
        SELECT 'many-peers', 'fixture-thread', 2000,
          jsonb_agg(jsonb_build_object('kind', 'bot_message_sent', 'toBotId', 'peer-' || lpad(s::text, 2, '0'),
            'toBotName', 'Specialist ' || s, 'text', repeat('Synthetic preview ', 30)) ORDER BY s),
          TIMESTAMP '2026-01-02'
        FROM generate_series(1, 33) s
      `;
      // The unknown thread receipt must never enter another authorized thread's page.
      await tx.$executeRaw`
        INSERT INTO messages VALUES ('unrelated', 'different-thread', 3000,
          '[{"kind":"bot_message_received","fromBotId":"peer-target","fromBotName":"Other account","text":"Synthetic private fixture"}]'::jsonb,
          TIMESTAMP '2026-01-03')
      `;
      const first = await loadPeerMessagePage(tx, "fixture-thread", "peer-target");
      expect(PeerMessagePageSchema.safeParse(first).success).toBe(true);
      expect(first.messages).toHaveLength(40);
      expect(first.messages[0]).toMatchObject({ seq: 1011, blockIndex: 0, direction: "sent" });
      expect(first.messages.at(-1)).toMatchObject({
        seq: 1030,
        blockIndex: 1,
        direction: "received",
      });
      const second = await loadPeerMessagePage(
        tx,
        "fixture-thread",
        "peer-target",
        first.olderCursor!,
      );
      expect(second.messages).toHaveLength(20);
      expect(second.olderCursor).toBeNull();
      const full = [...second.messages, ...first.messages];
      expect(new Set(full.map((row) => `${row.seq}:${row.blockIndex}`)).size).toBe(60);
      expect(full.every((row) => row.peerBotId === "peer-target")).toBe(true);
      expect(full.map((row) => row.direction)).toEqual(
        Array.from({ length: 30 }, () => ["sent", "received"]).flat(),
      );
      const withinMessage = await loadPeerMessagePage(tx, "fixture-thread", "peer-target", {
        seq: 1020,
        blockIndex: 1,
      });
      expect(withinMessage.messages).toHaveLength(39);
      expect(withinMessage.messages.at(-1)).toMatchObject({
        seq: 1020,
        blockIndex: 0,
        direction: "sent",
      });
      expect(withinMessage.olderCursor).toBeNull();

      const summary = await loadPeerConversationPage(tx, "fixture-thread");
      expect(PeerConversationPageSchema.safeParse(summary).success).toBe(true);
      expect(summary.conversations).toHaveLength(30);
      expect(summary.conversations[0]?.peerBotId).toBe("peer-01");
      expect(summary.conversations.at(-1)?.peerBotId).toBe("peer-30");
      expect(summary.conversations.every((row) => row.lastText.length <= 160)).toBe(true);
      const next = await loadPeerConversationPage(tx, "fixture-thread", summary.nextCursor!);
      expect(next.conversations.map((row) => row.peerBotId)).toEqual([
        "peer-31",
        "peer-32",
        "peer-33",
        "peer-other",
        "peer-target",
      ]);
      expect(next.nextCursor).toBeNull();
      const target = next.conversations.find((row) => row.peerBotId === "peer-target");
      expect(target?.lastDirection).toBe("received");
      expect(target?.lastText).toBe("Synthetic internal result 30");

      const empty = await loadPeerMessagePage(tx, "empty-thread", "peer-target");
      expect(empty.historyGeneration).toBe(7);
      expect(empty.messages).toEqual([]);
      const emptySummary = await loadPeerConversationPage(tx, "empty-thread");
      expect(emptySummary).toMatchObject({
        historyGeneration: 7,
        conversations: [],
        nextCursor: null,
      });
    });
  });
});
