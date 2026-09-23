import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { mobileAskPresentation } from "./ask-presentation";

describe("mobile question routing", () => {
  it("routes a server location request without actions to device sharing, never typing", () => {
    const request: MessageBlock = {
      kind: "ask",
      input: "location",
      status: "pending",
      text: "Share your current location once for nearby recommendations.",
    };
    expect([request].find((block) => mobileAskPresentation(block) === "text")).toBeUndefined();
    expect(mobileAskPresentation(request)).toBe("location");
    expect(mobileAskPresentation({ ...request, status: "answered" })).toBe("location");
  });

  it("preserves text, secret, multiple-choice and approval routes", () => {
    expect(mobileAskPresentation({ kind: "ask", text: "Your preference?" })).toBe("text");
    expect(mobileAskPresentation({ kind: "ask", input: "secret", text: "Enter a code" })).toBe(
      "text",
    );
    expect(
      mobileAskPresentation({ kind: "ask", text: "Choose", actions: [{ id: "a", label: "A" }] }),
    ).toBe("actions");
    expect(
      mobileAskPresentation({
        kind: "ask",
        text: "Approve",
        approvalEffectId: "effect",
        actions: [{ id: "allow", label: "Allow" }],
      }),
    ).toBe("actions");
    expect(mobileAskPresentation({ kind: "text", text: "Hello" })).toBeUndefined();
  });
});
