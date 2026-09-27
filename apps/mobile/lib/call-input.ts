import type { ThreadMessage } from "@rakazo/contracts";
import { isSecretAskBlock, spokenDecision } from "@rakazo/core";

export type CallMessage = Pick<ThreadMessage, "id" | "role" | "blocks" | "runId">;
export type CallSnapshot = { messages: CallMessage[]; run: { id: string; status: string } | null };

export function pendingCallAsk(snapshot: CallSnapshot | null): CallMessage | null {
  if (snapshot?.run?.status !== "waiting_input") return null;
  return (
    [...snapshot.messages]
      .reverse()
      .find(
        (message) =>
          message.runId === snapshot.run?.id &&
          message.blocks.some((block) => block.kind === "ask" && block.status !== "answered"),
      ) ?? null
  );
}
export function callRequiresScreen(snapshot: CallSnapshot | null): boolean {
  if (snapshot?.run?.status === "waiting_takeover") return true;
  return !!pendingCallAsk(snapshot)?.blocks.some(
    (block) =>
      block.kind === "ask" &&
      block.status !== "answered" &&
      (isSecretAskBlock(block) || block.input === "location"),
  );
}
export function callInput(
  snapshot: CallSnapshot | null,
  text: string,
):
  | { kind: "screen" }
  | { kind: "answer"; message: CallMessage; text: string }
  | { kind: "followUp" | "send"; text: string } {
  if (callRequiresScreen(snapshot)) return { kind: "screen" };
  const message = pendingCallAsk(snapshot);
  if (message) return { kind: "answer", message, text: spokenDecision(text) ?? text };
  return {
    kind:
      snapshot?.run && ["queued", "leased", "running"].includes(snapshot.run.status)
        ? "followUp"
        : "send",
    text,
  };
}
