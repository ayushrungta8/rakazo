import type {
  PeerActivityMessage,
  PeerConversationCursor,
  PeerConversationPage,
  PeerMessageCursor,
  PeerMessagePage,
} from "@rakazo/contracts";
import { truncatedPlainText } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { Prisma } from "@rakazo/db";

export const PEER_MESSAGE_PAGE_SIZE = 40;
export const PEER_CONVERSATION_PAGE_SIZE = 30;

type ReceiptRow = Omit<PeerActivityMessage, "createdAt"> & {
  createdAt: Date;
  historyGeneration: number;
};

/** Resolve/authorize the thread before calling. A receipt block is the exchange's durable body. */
export async function loadPeerMessagePage(
  prisma: Pick<PrismaClient, "$queryRaw">,
  threadId: string,
  peerBotId: string,
  before?: PeerMessageCursor,
): Promise<PeerMessagePage> {
  const cursor = before
    ? Prisma.sql`AND (m.seq < ${before.seq} OR
        (m.seq = ${before.seq} AND b.ordinality - 1 < ${before.blockIndex}))`
    : Prisma.empty;
  // Keep the metadata and page in one SQL snapshot. The left join returns the
  // generation even for an empty/cleared thread, so cached older pages can be discarded.
  const rows = await prisma.$queryRaw<
    Array<ReceiptRow | { historyGeneration: number; messageId: null }>
  >(
    Prisma.sql`
      SELECT t."historyCompactionGeneration" AS "historyGeneration", p.*
      FROM threads t
      LEFT JOIN LATERAL (
        SELECT m.id AS "messageId", m.seq, (b.ordinality - 1)::int AS "blockIndex",
          CASE WHEN b.block->>'kind' = 'bot_message_sent' THEN 'sent' ELSE 'received' END AS direction,
          ${peerBotId}::text AS "peerBotId",
          CASE WHEN b.block->>'kind' = 'bot_message_sent'
            THEN b.block->>'toBotName' ELSE b.block->>'fromBotName' END AS "peerBotName",
          b.block->>'text' AS text, m."createdAt"
        FROM messages m
        CROSS JOIN LATERAL jsonb_array_elements(m.blocks) WITH ORDINALITY AS b(block, ordinality)
        WHERE m."threadId" = t.id
          AND ((b.block->>'kind' = 'bot_message_sent' AND b.block->>'toBotId' = ${peerBotId})
            OR (b.block->>'kind' = 'bot_message_received' AND b.block->>'fromBotId' = ${peerBotId}))
          ${cursor}
        ORDER BY m.seq DESC, b.ordinality DESC
        LIMIT ${PEER_MESSAGE_PAGE_SIZE + 1}
      ) p ON TRUE
      WHERE t.id = ${threadId}
      ORDER BY p.seq DESC, p."blockIndex" DESC
    `,
  );
  const receipts = rows.filter((row): row is ReceiptRow => row.messageId !== null);
  const pageRows = receipts.slice(0, PEER_MESSAGE_PAGE_SIZE).reverse();
  const first = pageRows[0];
  return {
    threadId,
    historyGeneration: rows[0]?.historyGeneration ?? 0,
    messages: pageRows.map(({ historyGeneration: _, createdAt, ...row }) => ({
      ...row,
      createdAt: createdAt.toISOString(),
    })),
    olderCursor:
      receipts.length > PEER_MESSAGE_PAGE_SIZE && first
        ? { seq: first.seq, blockIndex: first.blockIndex }
        : null,
  };
}

type SummaryRow = {
  peerBotId: string;
  peerBotName: string;
  lastSeq: number;
  lastAt: Date;
  lastDirection: "sent" | "received";
  lastText: string;
  historyGeneration: number;
};

/** One bounded summary per specialist; conversation bodies never leave the database. */
export async function loadPeerConversationPage(
  prisma: Pick<PrismaClient, "$queryRaw">,
  threadId: string,
  after?: PeerConversationCursor,
): Promise<PeerConversationPage> {
  const cursor = after
    ? Prisma.sql`WHERE latest."lastSeq" < ${after.lastSeq} OR
        (latest."lastSeq" = ${after.lastSeq} AND latest."peerBotId" > ${after.peerBotId})`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<SummaryRow | { historyGeneration: number; peerBotId: null }>
  >(
    Prisma.sql`
      WITH receipts AS (
        SELECT m.seq, m."createdAt", b.ordinality,
          CASE WHEN b.block->>'kind' = 'bot_message_sent'
            THEN b.block->>'toBotId' ELSE b.block->>'fromBotId' END AS "peerBotId",
          CASE WHEN b.block->>'kind' = 'bot_message_sent'
            THEN b.block->>'toBotName' ELSE b.block->>'fromBotName' END AS "peerBotName",
          CASE WHEN b.block->>'kind' = 'bot_message_sent' THEN 'sent' ELSE 'received' END AS direction,
          left(b.block->>'text', 4096) AS text
        FROM messages m
        CROSS JOIN LATERAL jsonb_array_elements(m.blocks) WITH ORDINALITY AS b(block, ordinality)
        WHERE m."threadId" = ${threadId}
          AND b.block->>'kind' IN ('bot_message_sent', 'bot_message_received')
      ), latest AS (
        SELECT DISTINCT ON ("peerBotId") "peerBotId", "peerBotName", seq AS "lastSeq",
          "createdAt" AS "lastAt", direction AS "lastDirection", text AS "lastText"
        FROM receipts
        ORDER BY "peerBotId", seq DESC, ordinality DESC
      )
      SELECT t."historyCompactionGeneration" AS "historyGeneration", p.*
      FROM threads t
      LEFT JOIN LATERAL (
        SELECT * FROM latest ${cursor}
        ORDER BY "lastSeq" DESC, "peerBotId" ASC
        LIMIT ${PEER_CONVERSATION_PAGE_SIZE + 1}
      ) p ON TRUE
      WHERE t.id = ${threadId}
      ORDER BY p."lastSeq" DESC, p."peerBotId" ASC
    `,
  );
  const summaries = rows.filter((row): row is SummaryRow => row.peerBotId !== null);
  const pageRows = summaries.slice(0, PEER_CONVERSATION_PAGE_SIZE);
  const last = pageRows.at(-1);
  return {
    threadId,
    historyGeneration: rows[0]?.historyGeneration ?? 0,
    conversations: pageRows.map(({ historyGeneration: _, lastAt, lastText, ...row }) => ({
      ...row,
      lastAt: lastAt.toISOString(),
      lastText: truncatedPlainText(lastText, 160),
    })),
    nextCursor:
      summaries.length > PEER_CONVERSATION_PAGE_SIZE && last
        ? { lastSeq: last.lastSeq, peerBotId: last.peerBotId }
        : null,
  };
}
