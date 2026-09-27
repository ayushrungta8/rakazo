import * as SecureStore from "expo-secure-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));

import { DICTATION_MODE_KEY, loadDictationMode, saveDictationMode } from "./dictation-preference";
import type { RecognitionMode } from "./use-voice-recognition";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
});
describe("dictation preference", () => {
  it("uses phone dictation only when no preference has been saved", async () => {
    await expect(loadDictationMode()).resolves.toBe("device");
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(DICTATION_MODE_KEY);
  });
  it.each(["device", "local", "provider"] as const)(
    "saves and reads %s without altering the choice",
    async (mode) => {
      await saveDictationMode(mode);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(DICTATION_MODE_KEY, mode);
      vi.mocked(SecureStore.getItemAsync).mockResolvedValue(mode);
      await expect(loadDictationMode()).resolves.toBe(mode);
    },
  );
  it("does not opt into external audio when the preference cannot be read", async () => {
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error("Storage unavailable"));
    await expect(loadDictationMode()).rejects.toThrow("Storage unavailable");
  });
  it.each(["", "broken", "true"])(
    "rejects corrupt storage %j instead of falling back to external audio",
    async (value) => {
      vi.mocked(SecureStore.getItemAsync).mockResolvedValue(value);
      await expect(loadDictationMode()).rejects.toThrow("Choose it again in Voice settings");
    },
  );
  it("propagates write failures so Settings can retain its prior selection", async () => {
    vi.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error("Write failed"));
    await expect(saveDictationMode("local")).rejects.toThrow("Write failed");
  });
  it("rejects an invalid runtime value before writing", async () => {
    await expect(saveDictationMode("invalid" as RecognitionMode)).rejects.toThrow(
      "Invalid dictation method",
    );
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
