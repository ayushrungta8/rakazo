import { describe, expect, it } from "vitest";
import { activityNotificationsEnabled, activityPromptSnippet } from "./runs.js";

describe("run activity copy", () => {
  it("presents structured agent messages instead of their internal wake prompt", () => {
    expect(
      activityPromptSnippet({
        trigger: "bot_message",
        prompt: "[bot] A message just arrived from another bot with internal routing data",
        sourceBlocks: [
          {
            kind: "bot_message_received",
            fromBotId: "maya",
            fromBotName: "Maya",
            text: "Please check the release workflow.",
            intent: "request",
          },
        ],
      }),
    ).toBe("Maya asked: Please check the release workflow.");
  });

  it("fails closed when an agent message has no valid structured source", () => {
    expect(
      activityPromptSnippet({
        trigger: "bot_message",
        prompt: "[bot] private internal routing envelope",
        sourceBlocks: [{ kind: "text", text: "not a peer message" }],
      }),
    ).toBe("Message from another agent");
  });
});

describe("run activity notification preference", () => {
  it("silences only direct messages", () => {
    expect(activityNotificationsEnabled(null, false)).toBe(false);
    expect(activityNotificationsEnabled("group-1", false)).toBe(true);
  });
});

describe("Android activity alert eligibility", () => {
  it("silences internal work and completed turns without actual reply text", () => {
    expect(
      activityNotificationsEnabled(null, true, {
        internal: true,
        status: "completed",
        hasReply: true,
      }),
    ).toBe(false);
    expect(
      activityNotificationsEnabled(null, true, {
        internal: false,
        status: "completed",
        hasReply: false,
      }),
    ).toBe(false);
    expect(
      activityNotificationsEnabled(null, true, {
        internal: false,
        status: "completed",
        hasReply: true,
      }),
    ).toBe(true);
    expect(
      activityNotificationsEnabled(null, true, {
        internal: false,
        status: "running",
        trigger: "created",
      }),
    ).toBe(false);
  });
  it("preserves required input and takeover alerts, respecting direct-chat preference", () => {
    expect(
      activityNotificationsEnabled(null, true, { internal: true, status: "waiting_input" }),
    ).toBe(true);
    expect(
      activityNotificationsEnabled(null, true, { internal: true, status: "waiting_takeover" }),
    ).toBe(true);
    expect(
      activityNotificationsEnabled(null, false, { internal: false, status: "waiting_input" }),
    ).toBe(false);
    expect(
      activityNotificationsEnabled("group", false, {
        internal: false,
        status: "completed",
        hasReply: true,
      }),
    ).toBe(true);
  });
});
