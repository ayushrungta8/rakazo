export type CalendarDateFilter = "all" | "today" | "week" | "month";

/** Calendar boundaries use the viewer's local timezone on every surface. */
export function matchesCalendarDateFilter(
  iso: string,
  filter: CalendarDateFilter,
  now: Date,
): boolean {
  if (filter === "all") return true;
  const date = new Date(iso);
  if (filter === "today") return date.toDateString() === now.toDateString();
  if (filter === "week") {
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    return date >= startOfWeek;
  }
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}
