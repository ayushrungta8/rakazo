import type { MessageBlock } from "@rakazo/contracts";
import { isApprovalAskBlock } from "@rakazo/core";

/** Choose once: a specialized request must never fall through to a text field. */
export function mobileAskPresentation(block: MessageBlock) {
  if (block.kind !== "ask") return undefined;
  if (block.input === "location") return "location";
  if (block.actions?.length) return "actions";
  if (!isApprovalAskBlock(block)) return "text";
  return undefined;
}
