import { describe, expect, it } from "vitest";
import { matchesCalendarDateFilter } from "./calendar-date-filter.js";

const now = new Date(2026, 8, 27, 12); // Sunday in the viewer's timezone.
describe("artifact calendar dates", () => {
  it("uses local calendar days rather than the previous 24 hours", () => {
    expect(matchesCalendarDateFilter(new Date(2026, 8, 27, 0).toISOString(), "today", now)).toBe(
      true,
    );
    expect(
      matchesCalendarDateFilter(new Date(2026, 8, 26, 23, 59).toISOString(), "today", now),
    ).toBe(false);
  });
  it("starts this week at Sunday midnight and this month at the current month/year", () => {
    expect(matchesCalendarDateFilter(new Date(2026, 8, 27, 0).toISOString(), "week", now)).toBe(
      true,
    );
    expect(
      matchesCalendarDateFilter(new Date(2026, 8, 26, 23, 59).toISOString(), "week", now),
    ).toBe(false);
    expect(matchesCalendarDateFilter(new Date(2026, 8, 1).toISOString(), "month", now)).toBe(true);
    expect(matchesCalendarDateFilter(new Date(2025, 8, 1).toISOString(), "month", now)).toBe(false);
    expect(matchesCalendarDateFilter(new Date(2026, 7, 31).toISOString(), "month", now)).toBe(
      false,
    );
  });
  it("rejects invalid dates for calendar filters", () => {
    expect(matchesCalendarDateFilter("invalid", "month", now)).toBe(false);
    expect(matchesCalendarDateFilter("invalid", "week", now)).toBe(false);
  });
});
