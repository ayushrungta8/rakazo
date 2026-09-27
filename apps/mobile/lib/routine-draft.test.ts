import { afterEach, describe, expect, it, vi } from "vitest";
import { oneShotRunAt, routineInput } from "./routine-draft";

const draft = {
  name: " Morning ",
  prompt: " Check updates ",
  schedules: "0 9 * * *\n\n0 18 * * *",
  timezone: "Asia/Bangkok",
  active: false,
  notify: true,
  webhookEnabled: false,
  githubEnabled: false,
  messageProvider: "",
};
afterEach(() => vi.useRealTimers());
describe("Android routine editor", () => {
  it("preserves multiple schedules and does not activate a new routine by default", () => {
    const result = routineInput("bot-1", draft);
    expect(result.crons).toEqual(["0 9 * * *", "0 18 * * *"]);
    expect(result.active).toBe(false);
    expect(result.name).toBe("Morning");
    expect(result.messageProvider).toBe(null);
  });
  it("requires a trigger and a valid timezone", () => {
    expect(() => routineInput("bot-1", { ...draft, schedules: "" })).toThrow();
    expect(() => routineInput("bot-1", { ...draft, timezone: "invalid" })).toThrow("timezone");
    expect(routineInput("bot-1", { ...draft, schedules: "", webhookEnabled: true }).crons).toEqual(
      [],
    );
  });
  it("arms only never-run one-shots, rejecting invalid and past dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T00:00:00Z"));
    expect(oneShotRunAt(["@once"], "2026-10-01T09:00:00Z")).toBe("2026-10-01T09:00:00.000Z");
    expect(() => oneShotRunAt(["@once"], "bad")).toThrow();
    expect(() => oneShotRunAt(["@once"], "2026-01-01")).toThrow();
    expect(
      oneShotRunAt(["@once"], "", { lastRunAt: "2026-09-01", nextRunAt: null }),
    ).toBeUndefined();
    expect(oneShotRunAt(["0 9 * * *"], "bad")).toBeUndefined();
  });
});
