import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

export const PeerMessageCursorSchema = z.object({
  seq: z.number().int().nonnegative(),
  blockIndex: z.number().int().nonnegative(),
});
export type PeerMessageCursor = z.infer<typeof PeerMessageCursorSchema>;

export const PeerActivityMessageSchema = z.object({
  messageId: Id,
  seq: z.number().int().nonnegative(),
  blockIndex: z.number().int().nonnegative(),
  direction: z.enum(["sent", "received"]),
  peerBotId: Id,
  peerBotName: z.string(),
  text: z.string(),
  createdAt: IsoDate,
});
export type PeerActivityMessage = z.infer<typeof PeerActivityMessageSchema>;

export const PeerMessagePageSchema = z.object({
  threadId: Id,
  historyGeneration: z.number().int().nonnegative(),
  messages: z.array(PeerActivityMessageSchema),
  olderCursor: PeerMessageCursorSchema.nullable(),
});
export type PeerMessagePage = z.infer<typeof PeerMessagePageSchema>;

export const PeerConversationCursorSchema = z.object({
  lastSeq: z.number().int().nonnegative(),
  peerBotId: Id,
});
export type PeerConversationCursor = z.infer<typeof PeerConversationCursorSchema>;

export const PeerConversationSummarySchema = z.object({
  peerBotId: Id,
  peerBotName: z.string(),
  lastSeq: z.number().int().nonnegative(),
  lastAt: IsoDate,
  lastDirection: z.enum(["sent", "received"]),
  lastText: z.string().max(160),
});
export type PeerConversationSummary = z.infer<typeof PeerConversationSummarySchema>;

export const PeerConversationPageSchema = z.object({
  threadId: Id,
  historyGeneration: z.number().int().nonnegative(),
  conversations: z.array(PeerConversationSummarySchema),
  nextCursor: PeerConversationCursorSchema.nullable(),
});
export type PeerConversationPage = z.infer<typeof PeerConversationPageSchema>;
