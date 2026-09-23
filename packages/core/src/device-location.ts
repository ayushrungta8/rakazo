/** Validate device fixes before storing them or exposing them to a model. */
export function normalizeDeviceLocationAnswer(answer: string, now = Date.now()): string | null {
  if (answer === "location-declined") {
    return "Device location sharing declined. Continue without location or ask for a place name; do not repeat the location request.";
  }
  if (answer.length > 1024) return null;
  let fix: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(answer);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    fix = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const keys = ["kind", "latitude", "longitude", "accuracyMeters", "capturedAt"];
  if (Object.keys(fix).length !== keys.length || keys.some((key) => !(key in fix))) return null;
  const { kind, latitude, longitude, accuracyMeters, capturedAt } = fix;
  if (
    kind !== "device-location" ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180 ||
    typeof accuracyMeters !== "number" ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters < 0 ||
    accuracyMeters > 100_000 ||
    typeof capturedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt)
  )
    return null;
  const capturedTime = Date.parse(capturedAt);
  if (
    !Number.isFinite(capturedTime) ||
    new Date(capturedTime).toISOString() !== capturedAt ||
    capturedTime < now - 120_000 ||
    capturedTime > now + 30_000
  )
    return null;
  return `Device location shared: latitude ${latitude}, longitude ${longitude}, accuracy ${accuracyMeters} meters, captured at ${capturedAt}. This is a one-time device fix, not ongoing location tracking.`;
}
