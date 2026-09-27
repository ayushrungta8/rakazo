import type { ThreadSnapshot } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { callInput, callRequiresScreen } from "./call-input";

const pending = (input: "text" | "secret" | "location") =>
  ({
    run: { id: "run", status: "waiting_input" },
    messages: [
      {
        id: "ask",
        runId: "run",
        role: "bot",
        blocks: [{ kind: "ask", input, status: "pending", text: "Answer" }],
      },
    ],
  }) as unknown as ThreadSnapshot;
describe("call input routing", () => {
  it.each(["secret", "location"] as const)(
    "requires the screen for %s and never turns speech into an answer",
    (kind) => {
      expect(callRequiresScreen(pending(kind))).toBe(true);
      expect(callInput(pending(kind), "yes")).toEqual({ kind: "screen" });
    },
  );
  it("maps spoken decisions only for a current unanswered request", () => {
    const current = pending("text");
    expect(callInput(current, "yes")).toEqual({
      kind: "answer",
      message: current.messages[0],
      text: "yes",
    });
    expect(callInput({ ...current, run: { ...current.run!, id: "new" } }, "yes")).toEqual({
      kind: "send",
      text: "yes",
    });
  });
  it.each(["running", "queued", "leased"] as const)("uses a follow-up during %s", (status) => {
    expect(
      callInput({ ...pending("text"), run: { ...pending("text").run!, status } }, "next step"),
    ).toEqual({ kind: "followUp", text: "next step" });
  });
});

it("requires the screen while the browser waits for handover", () => {
  expect(
    callInput({ ...pending("text"), run: { id: "run", status: "waiting_takeover" } }, "yes"),
  ).toEqual({ kind: "screen" });
});
