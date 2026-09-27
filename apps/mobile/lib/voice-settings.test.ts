import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  outputSave: vi.fn(),
  rpc: vi.fn(),
  t: (text: string) => text,
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => (() => void) | undefined) => useEffect(callback, [callback]),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "Spinner",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeArea" }));
vi.mock("./native", () => ({ native: {}, useThemedStyles: (factory: () => unknown) => factory() }));
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("./i18n", () => ({ useI18n: () => ({ t: mock.t }) }));
vi.mock("./api", () => ({ rpc: mock.rpc }));
vi.mock("./voice", () => ({ speakText: vi.fn() }));
vi.mock("./device-voice", () => ({
  loadDeviceVoiceEnabled: vi.fn(async () => false),
  saveDeviceVoiceEnabled: mock.outputSave,
}));
vi.mock("./dictation-preference", () => ({
  loadDictationMode: mock.load,
  saveDictationMode: mock.save,
}));

import VoiceSettings from "../app/voice";

let view: ReactTestRenderer;
const option = (label: string) =>
  view.root
    .findAllByType("Pressable" as ElementType)
    .find((node) => node.props.accessibilityLabel === label)!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  mock.load.mockResolvedValue("local");
  mock.save.mockResolvedValue(undefined);
  mock.rpc.mockImplementation(async (path: string) =>
    path === "voice/status" ? { provider: null, transcribe: false, ready: false } : [],
  );
});
afterEach(async () => {
  if (view) await act(async () => view.unmount());
});
it("keeps dictation separate from reply playback when changing the saved method", async () => {
  await act(async () => {
    view = create(createElement(VoiceSettings));
  });
  expect(option("Offline dictation").props.accessibilityState.checked).toBe(true);
  await act(async () => {
    option("Phone dictation").props.onPress();
  });
  expect(mock.save).toHaveBeenCalledWith("device");
  expect(option("Phone dictation").props.accessibilityState.checked).toBe(true);
  expect(mock.outputSave).not.toHaveBeenCalled();
  expect(mock.rpc).not.toHaveBeenCalledWith("voice/setVoice", expect.anything());
});
it("retains the selected mode and shows the error when saving fails", async () => {
  mock.save.mockRejectedValueOnce(new Error("Save failed"));
  await act(async () => {
    view = create(createElement(VoiceSettings));
  });
  await act(async () => {
    option("Phone dictation").props.onPress();
  });
  expect(option("Offline dictation").props.accessibilityState.checked).toBe(true);
  expect(
    view.root
      .findAllByType("Text" as ElementType)
      .some((node) => node.props.children === "Save failed"),
  ).toBe(true);
});
it("shows no selected upload mode after a read error, allowing an explicit new choice", async () => {
  mock.load.mockRejectedValueOnce(new Error("Read failed"));
  await act(async () => {
    view = create(createElement(VoiceSettings));
  });
  expect(option("Phone dictation").props.accessibilityState.checked).toBe(false);
  expect(option("Voice provider").props.accessibilityState.checked).toBe(false);
  await act(async () => {
    option("Offline dictation").props.onPress();
  });
  expect(option("Offline dictation").props.accessibilityState.checked).toBe(true);
});
it("a delayed preference read cannot overwrite a newly saved choice", async () => {
  let resolveRead: (mode: string) => void = () => {};
  mock.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  await act(async () => {
    view = create(createElement(VoiceSettings));
  });
  await act(async () => {
    option("Phone dictation").props.onPress();
  });
  await act(async () => {
    resolveRead("provider");
  });
  expect(option("Phone dictation").props.accessibilityState.checked).toBe(true);
});
