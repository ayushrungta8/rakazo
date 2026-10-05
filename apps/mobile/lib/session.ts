import * as SecureStore from "expo-secure-store";
import { stopLiveNotifications } from "./live-notifications";
import { mobileResourceCache } from "./resource-cache";

const SESSION_KEY = "rakazo.session_token";

/** In-memory gate so a failed SecureStore wipe cannot keep sending the old bearer. */
let sessionInvalidated = false;
let sessionFallback: string | undefined;
let observedToken: string | undefined;
let sessionOperationEpoch = 0;

function observeToken(token: string) {
  if (observedToken === token) return;
  observedToken = token;
  mobileResourceCache.resetIdentity();
}

export function sessionAvailable(): boolean | undefined {
  return observedToken === undefined ? undefined : Boolean(observedToken);
}

export async function loadSessionToken() {
  const snapshot = await snapshotSessionToken();
  return snapshot.ok ? snapshot.value : "";
}

export async function saveSessionToken(token: string) {
  const epoch = ++sessionOperationEpoch;
  await SecureStore.setItemAsync(SESSION_KEY, token);
  if (epoch !== sessionOperationEpoch) {
    // A later sign-out/sign-in owns the session; heal a stale durable write.
    await SecureStore.setItemAsync(SESSION_KEY, observedToken ?? "");
    return;
  }
  observeToken(token);
  sessionInvalidated = false;
  sessionFallback = undefined;
}

/** Clears the session. Returns false only when SecureStore could neither delete nor overwrite. */
export async function clearSessionToken(): Promise<boolean> {
  const epoch = ++sessionOperationEpoch;
  sessionInvalidated = true;
  observeToken("");
  await stopLiveNotifications(true).catch(() => undefined);
  if (epoch !== sessionOperationEpoch) return true;
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    if (epoch !== sessionOperationEpoch) {
      await SecureStore.setItemAsync(SESSION_KEY, observedToken ?? "").catch(() => undefined);
      return true;
    }
    sessionInvalidated = false;
    sessionFallback = undefined;
    return true;
  } catch {
    if (epoch !== sessionOperationEpoch) return true;
    try {
      await SecureStore.setItemAsync(SESSION_KEY, "");
      if (epoch !== sessionOperationEpoch) {
        await SecureStore.setItemAsync(SESSION_KEY, observedToken ?? "").catch(() => undefined);
        return true;
      }
      sessionInvalidated = false;
      sessionFallback = undefined;
      return true;
    } catch {
      if (epoch !== sessionOperationEpoch) return true;
      sessionInvalidated = true;
      sessionFallback = undefined;
      return false;
    }
  }
}

/** Restores the current-server session in memory even when persistence is unavailable. */
export async function restoreSessionToken(token: string) {
  sessionOperationEpoch += 1;
  observeToken(token);
  if (!token) {
    sessionInvalidated = false;
    sessionFallback = undefined;
    return;
  }
  sessionInvalidated = false;
  sessionFallback = token;
  const saving = saveSessionToken(token);
  const epoch = sessionOperationEpoch;
  try {
    await saving;
  } catch {
    if (epoch !== sessionOperationEpoch) return;
    sessionInvalidated = false;
    sessionFallback = token;
  }
}

/** Snapshots the active token without treating an unreadable store as an empty session. */
export async function snapshotSessionToken(): Promise<{ ok: true; value: string } | { ok: false }> {
  if (sessionFallback !== undefined) return { ok: true, value: sessionFallback };
  if (sessionInvalidated) return { ok: true, value: "" };
  const epoch = sessionOperationEpoch;
  try {
    const value = (await SecureStore.getItemAsync(SESSION_KEY)) ?? "";
    if (epoch !== sessionOperationEpoch) {
      return { ok: true, value: observedToken ?? "" };
    }
    observeToken(value);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export function tokenFromAuthResponse(res: Response, body: unknown) {
  const fromJson = jsonToken(body);
  if (fromJson) return fromJson;
  const cookies = res.headers.get("set-cookie") ?? "";
  const encoded = cookies.match(/(?:^|,\s*)(?:__Secure-)?better-auth\.session_token=([^;,]*)/)?.[1];
  if (!encoded) return "";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return "";
  }
}

function jsonToken(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  if (typeof record.token === "string" && record.token) return record.token;
  const session = record.session;
  if (
    session &&
    typeof session === "object" &&
    typeof (session as { token?: string }).token === "string"
  ) {
    return (session as { token: string }).token;
  }
  return "";
}
