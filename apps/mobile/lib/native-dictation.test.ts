import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  permission: vi.fn(),
  remove: vi.fn(),
  listeners: new Map<string, (value: never) => void>(),
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => ({
    ...mocks,
    addListener: (name: string, callback: (value: never) => void) => {
      mocks.listeners.set(name, callback);
      return { remove: mocks.remove };
    },
  }),
}));
vi.mock("expo-audio", () => ({ requestRecordingPermissionsAsync: mocks.permission }));

import { cancelDictation, listenNative } from "./native-dictation";

describe("native microphone ownership", () => {
  beforeEach(async () => {
    await cancelDictation();
    vi.clearAllMocks();
    mocks.available.mockResolvedValue({ available: true, onDevice: true });
    mocks.permission.mockResolvedValue({ granted: true });
  });
  it("uses on-device recognition and ignores late events after cancellation", async () => {
    const onText = vi.fn();
    await listenNative({ onText, onError: vi.fn() });
    const id = mocks.start.mock.calls[0]?.[0];
    expect(mocks.start).toHaveBeenCalledWith(id, "en-US", true);
    mocks.listeners.get("transcript")?.({ sessionId: id, text: "Hello", final: false } as never);
    expect(onText).toHaveBeenCalledWith("Hello", false);
    await cancelDictation();
    mocks.listeners.get("transcript")?.({ sessionId: id, text: "late", final: true } as never);
    expect(onText).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });
  it("does not silently fall back to network recognition", async () => {
    mocks.available.mockResolvedValue({ available: true, onDevice: false });
    await expect(listenNative({ onText: vi.fn(), onError: vi.fn() })).rejects.toThrow(
      "On-device recognition is unavailable",
    );
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("does not resurrect listening when hang-up happens during initial cleanup", async () => {
    let release: () => void = () => {};
    mocks.cancel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const operation = listenNative({ onText: vi.fn(), onError: vi.fn() });
    await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
    await cancelDictation();
    release();
    await operation;
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it("does not start after cancellation during the permission prompt", async () => {
    let grant: (permission: { granted: boolean }) => void = () => {};
    mocks.permission.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const operation = listenNative({ onText: vi.fn(), onError: vi.fn() });
    await vi.waitFor(() => expect(mocks.permission).toHaveBeenCalled());
    await cancelDictation();
    grant({ granted: true });
    await operation;
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
