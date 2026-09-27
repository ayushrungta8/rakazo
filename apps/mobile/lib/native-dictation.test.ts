import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  cancelDictation,
  finishDictation,
  listenNative,
  RECOGNITION_FINISH_TIMEOUT_MS,
  RECOGNITION_TIMEOUT_MS,
} from "./native-dictation";

describe("native microphone ownership", () => {
  afterEach(async () => {
    await cancelDictation();
    vi.useRealTimers();
  });
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

  it("phone dictation selects the default engine even when an offline engine is installed", async () => {
    mocks.available.mockResolvedValue({ available: true, onDevice: true });
    mocks.permission.mockResolvedValue({ granted: true });
    await listenNative({ allowNetwork: true, onText: vi.fn(), onError: vi.fn() });
    expect(mocks.start).toHaveBeenLastCalledWith(expect.any(Number), "en-US", false);
    await cancelDictation();
  });
  it("reports a missing offline language model with a useful next action", async () => {
    const onError = vi.fn();
    await listenNative({ onText: vi.fn(), onError });
    const id = mocks.start.mock.calls.at(-1)?.[0];
    mocks.listeners.get("error")?.({ sessionId: id, code: 13 } as never);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("not downloaded") }),
      false,
    );
    await cancelDictation();
  });
  it("finishing preserves partial words when an engine never sends its final result", async () => {
    vi.useFakeTimers();
    const onText = vi.fn();
    await listenNative({ onText, onError: vi.fn() });
    const id = mocks.start.mock.calls.at(-1)?.[0];
    mocks.listeners.get("transcript")?.({
      sessionId: id,
      text: "Keep these words",
      final: false,
    } as never);
    await finishDictation();
    await vi.advanceTimersByTimeAsync(RECOGNITION_FINISH_TIMEOUT_MS);
    expect(onText).toHaveBeenLastCalledWith("Keep these words", true);
    await cancelDictation();
    vi.useRealTimers();
  });
  it("a silent recognition engine times out instead of leaving dictation stuck listening", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    await listenNative({ onText: vi.fn(), onError });
    await vi.advanceTimersByTimeAsync(RECOGNITION_TIMEOUT_MS);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("did not return") }),
      false,
    );
    await cancelDictation();
    vi.useRealTimers();
  });
});
