import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  currentState: "active",
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return app.currentState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      app.listeners.add(listener);
      return { remove: () => app.listeners.delete(listener) };
    },
  },
}));
function setAppState(state: string) {
  app.currentState = state;
  for (const listener of [...app.listeners]) listener(state);
}
vi.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
}));

import * as Location from "expo-location";
import { requestDeviceLocation } from "./device-location";

beforeEach(() => {
  vi.resetAllMocks();
  app.currentState = "active";
  app.listeners.clear();
  vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
    granted: true,
  } as never);
  vi.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());
describe("one-time native location", () => {
  it("preserves the sample timestamp and accuracy", async () => {
    const timestamp = Date.now();
    vi.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
      coords: { latitude: 12, longitude: 34, accuracy: 8 },
      timestamp,
    } as never);
    expect(JSON.parse(await requestDeviceLocation(new AbortController().signal))).toEqual({
      kind: "device-location",
      latitude: 12,
      longitude: 34,
      accuracyMeters: 8,
      capturedAt: new Date(timestamp).toISOString(),
    });
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.High,
    });
  });
  it("does not sample after permission denial", async () => {
    vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
      granted: false,
    } as never);
    await expect(requestDeviceLocation(new AbortController().signal)).rejects.toThrow(
      "permission was denied",
    );
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
  it("rejects stale samples", async () => {
    vi.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
      coords: {},
      timestamp: Date.now() - 60_000,
    } as never);
    await expect(requestDeviceLocation(new AbortController().signal)).rejects.toThrow(
      "old location",
    );
  });
  it("discards permission completion after navigation", async () => {
    const controller = new AbortController();
    vi.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(async () => {
      controller.abort();
      return { granted: true } as never;
    });
    await expect(requestDeviceLocation(controller.signal)).rejects.toThrow("cancelled");
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
  it("times out and never resolves a late sample", async () => {
    vi.useFakeTimers();
    vi.mocked(Location.getCurrentPositionAsync).mockReturnValue(new Promise(() => {}));
    const assertion = expect(requestDeviceLocation(new AbortController().signal)).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });
});

describe("Android system activity lifecycle", () => {
  it("waits through permission activity backgrounding and resumes once active", async () => {
    vi.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(async () => {
      setAppState("background");
      return { granted: true } as never;
    });
    vi.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
      coords: { latitude: 12, longitude: 34, accuracy: 8 },
      timestamp: Date.now(),
    } as never);
    const result = requestDeviceLocation(new AbortController().signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    setAppState("active");
    expect(JSON.parse(await result).kind).toBe("device-location");
    expect(app.listeners.size).toBe(0);
  });
  it("never returns coordinates while the app remains backgrounded", async () => {
    vi.useFakeTimers();
    vi.mocked(Location.getCurrentPositionAsync).mockImplementation(async () => {
      setAppState("background");
      return {
        coords: { latitude: 12, longitude: 34, accuracy: 8 },
        timestamp: Date.now(),
      } as never;
    });
    const assertion = expect(requestDeviceLocation(new AbortController().signal)).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(app.listeners.size).toBe(0);
  });
  it("times out a permission API that never finishes", async () => {
    vi.useFakeTimers();
    vi.mocked(Location.requestForegroundPermissionsAsync).mockReturnValue(new Promise(() => {}));
    const assertion = expect(requestDeviceLocation(new AbortController().signal)).rejects.toThrow(
      "permission did not finish",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });
});
