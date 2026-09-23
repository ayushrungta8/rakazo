import * as Location from "expo-location";
import { AppState } from "react-native";

type LocationStage = "permission" | "locating";

/** A system permission/settings activity can background Android temporarily. */
function waitForForeground(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Location sharing cancelled."));
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        cleanup();
        resolve();
      }
    });
    const abort = () => {
      cleanup();
      reject(new Error("Location sharing cancelled."));
    };
    const cleanup = () => {
      subscription.remove();
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else if (AppState.currentState === "active") {
      cleanup();
      resolve();
    }
  });
}

/** Foreground, single sample; never reads last-known location or starts a watcher. */
export function requestDeviceLocation(
  signal: AbortSignal,
  onStage?: (stage: LocationStage) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Location sharing cancelled."));
      return;
    }
    const request = new AbortController();
    let settled = false;
    let stage: LocationStage = "permission";
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      request.abort();
      reject(error);
    };
    const abort = () => fail(new Error("Location sharing cancelled."));
    // Cover permission, settings, foreground restoration and sampling, not only GPS.
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            stage === "permission"
              ? "Location permission did not finish. Check Rakazo's location permission in Android Settings and try again."
              : "Finding your location timed out. Check location services and try again or choose Not now.",
          ),
        ),
      30_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    const ensureActive = async () => {
      await waitForForeground(request.signal);
      if (settled || request.signal.aborted) throw new Error("Location sharing cancelled.");
    };
    void (async () => {
      onStage?.("permission");
      const permission = await Location.requestForegroundPermissionsAsync();
      if (settled) return;
      if (!permission.granted)
        throw new Error(
          "Location permission was denied. Enable it in Android Settings or choose Not now.",
        );
      await ensureActive();
      if (!(await Location.hasServicesEnabledAsync()))
        throw new Error("Location services are off. Turn them on and try again.");
      await ensureActive();
      stage = "locating";
      onStage?.(stage);
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (settled) return;
      await ensureActive();
      const age = Date.now() - position.timestamp;
      if (!Number.isFinite(age) || age > 30_000 || age < -30_000)
        throw new Error("Your device returned an old location. Please try again.");
      if (
        position.coords.accuracy === null ||
        !Number.isFinite(position.coords.accuracy) ||
        position.coords.accuracy < 0
      )
        throw new Error("Your device could not report location accuracy. Please try again.");
      const answer = JSON.stringify({
        kind: "device-location",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
      });
      settled = true;
      cleanup();
      resolve(answer);
    })().catch((failure) =>
      fail(
        failure instanceof Error
          ? failure
          : new Error("Could not get your location. Please try again."),
      ),
    );
  });
}
