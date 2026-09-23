import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDeviceLocation } from "./device-location";

afterEach(() => vi.unstubAllGlobals());
function browser(getCurrentPosition: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
}
describe("one-time browser location", () => {
  it("requests a fresh sample and preserves the device timestamp", async () => {
    const get = vi.fn((success, _failure, _options) =>
      success({
        coords: { latitude: 12, longitude: 34, accuracy: 8 },
        timestamp: 1_800_000_000_000,
      }),
    );
    browser(get);
    const value = JSON.parse(await requestDeviceLocation(new AbortController().signal));
    expect(value).toEqual({
      kind: "device-location",
      latitude: 12,
      longitude: 34,
      accuracyMeters: 8,
      capturedAt: "2027-01-15T08:00:00.000Z",
    });
    expect(get.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20_000,
    });
  });
  it.each([
    [1, "permission was denied"],
    [2, "could not determine"],
    [3, "timed out"],
  ])("reports error %i without an answer", async (code, message) => {
    browser(vi.fn((_success, failure) => failure({ code })));
    await expect(requestDeviceLocation(new AbortController().signal)).rejects.toThrow(
      String(message),
    );
  });
  it("discards a sample arriving after navigation cancellation", async () => {
    let success: (value: unknown) => void = () => {};
    browser(
      vi.fn((callback) => {
        success = callback;
      }),
    );
    const controller = new AbortController();
    const result = requestDeviceLocation(controller.signal);
    controller.abort();
    success({ coords: { latitude: 12, longitude: 34, accuracy: 8 }, timestamp: Date.now() });
    await expect(result).rejects.toThrow("cancelled");
  });
  it("never starts a request if already cancelled", async () => {
    const get = vi.fn();
    browser(get);
    const controller = new AbortController();
    controller.abort();
    await expect(requestDeviceLocation(controller.signal)).rejects.toThrow("cancelled");
    expect(get).not.toHaveBeenCalled();
  });
});
