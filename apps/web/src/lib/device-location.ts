/** Called only after the user chooses to share this device's current location. */
export function requestDeviceLocation(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Location sharing cancelled."));
    if (!globalThis.isSecureContext || !navigator.geolocation) {
      return reject(new Error("Location requires a supported browser on HTTPS."));
    }
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new Error("Location sharing cancelled."));
    };
    // Browser timeout can exclude time spent waiting for permission.
    const timer = setTimeout(() => {
      finish();
      reject(new Error("Finding your location timed out. Try again or choose Not now."));
    }, 30_000);
    signal.addEventListener("abort", abort, { once: true });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (settled || signal.aborted) return;
        finish();
        if (!Number.isFinite(position.timestamp)) {
          reject(new Error("Your device returned an invalid location. Please try again."));
          return;
        }
        resolve(
          JSON.stringify({
            kind: "device-location",
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString(),
          }),
        );
      },
      (error) => {
        if (settled || signal.aborted) return;
        finish();
        reject(
          new Error(
            error.code === 1
              ? "Location permission was denied. You can enable it in browser settings or choose Not now."
              : error.code === 3
                ? "Finding your location timed out. Try again or choose Not now."
                : "Your device could not determine its location. Check location services and try again.",
          ),
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  });
}
