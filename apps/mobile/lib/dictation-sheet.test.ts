import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import { DictationSheet } from "../components/dictation-sheet";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  params: {} as Record<string, string>,
  push: vi.fn(),
  back: vi.fn(),
  replace: vi.fn(),
  sheet: vi.fn(),
  alert: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
  background: undefined as ((state: string) => void) | undefined,
  t: (s: string, values?: Record<string, string | number>) =>
    s.replace(/\{(\w+)\}/g, (match, key) => String(values?.[key] ?? match)),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "Spinner",
  Alert: { alert: mock.alert },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Switch: "Switch",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  Modal: "Modal",
  AppState: {
    currentState: "active",
    addEventListener: (_: string, fn: (state: string) => void) => {
      mock.background = fn;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeArea",
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "StackScreen" },
  useFocusEffect: (fn: () => () => void) => useEffect(fn, [fn]),
  useLocalSearchParams: () => mock.params,
  useRouter: () => ({ push: mock.push, back: mock.back, replace: mock.replace }),
}));
vi.mock("../lib/use-voice-recognition", () => ({
  useVoiceRecognition: () => ({ start: mock.start, finish: mock.finish, cancel: mock.cancel }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("../lib/api", () => ({ rpc: mock.rpc, currentApiBase: () => "https://example.invalid" }));
vi.mock("@react-native-vector-icons/ionicons", () => ({ default: "Icon" }));
vi.mock("../lib/message-action-sheet", () => ({ presentMessageActionSheet: mock.sheet }));
vi.mock("../lib/native", () => ({
  useMobileTokens: () => ({}),
  useResolvedAppearance: () => "dark",
}));
vi.mock("../lib/i18n", () => ({
  t: mock.t,
  dateLocaleForUi: () => "en",
  useI18n: () => ({ t: mock.t }),
}));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.params = { botId: "bot" };
  mock.rpc.mockReset();
  mock.push.mockReset();
  mock.back.mockReset();
  mock.replace.mockReset();
  mock.sheet.mockReset();
  mock.alert.mockReset();
  mock.start.mockReset();
  mock.finish.mockReset();
  mock.cancel.mockReset();
});
function button(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType("Pressable" as ElementType)
    .find((node) => node.props.accessibilityLabel === label)!;
}

async function render() {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(DictationSheet, { onText: mock.push, onClose: mock.back }));
  });
  return view;
}
it("does not start recording on open and uses phone speech on deliberate start", async () => {
  const view = await render();
  expect(mock.start).not.toHaveBeenCalled();
  expect(button(view, "Insert into message")).toBeUndefined();
  expect(button(view, "Offline only")).toBeUndefined();
  await act(async () => button(view, "Start dictation").props.onPress());
  expect(mock.start.mock.calls[0]![0].mode).toBe("device");
  expect(button(view, "Stop & review")).toBeDefined();
});
it("reviews and edits a result before deliberately inserting it", async () => {
  const view = await render();
  await act(async () => button(view, "Start dictation").props.onPress());
  await act(async () => mock.start.mock.calls[0]![0].onText("Test words", true));
  expect(mock.push).not.toHaveBeenCalled();
  await act(async () =>
    view.root.findByType("TextInput" as ElementType).props.onChangeText("Edited words"),
  );
  await act(async () => button(view, "Insert into message").props.onPress());
  expect(mock.push).toHaveBeenCalledWith("Edited words");
  expect(mock.back).toHaveBeenCalledOnce();
});
it("waits for final recognition after stopping and prevents double finish", async () => {
  const view = await render();
  await act(async () => button(view, "Start dictation").props.onPress());
  await act(async () => button(view, "Stop & review").props.onPress());
  expect(button(view, "Turning speech into text…").props.disabled).toBe(true);
  expect(mock.finish).toHaveBeenCalledOnce();
  await act(async () => mock.start.mock.calls[0]![0].onText("Finished", true));
  expect(button(view, "Insert into message")).toBeDefined();
});
it("ignores late results after cancellation", async () => {
  const view = await render();
  await act(async () => button(view, "Start dictation").props.onPress());
  const options = mock.start.mock.calls[0]![0];
  await act(async () => button(view, "Cancel dictation").props.onPress());
  await act(async () => options.onText("Late", true));
  expect(mock.push).not.toHaveBeenCalled();
  expect(view.root.findAllByType("TextInput" as ElementType)).toHaveLength(0);
});
it("appends more dictation to reviewed text instead of replacing it", async () => {
  const view = await render();
  await act(async () => button(view, "Start dictation").props.onPress());
  await act(async () => mock.start.mock.calls[0]![0].onText("First", true));
  await act(async () => button(view, "Dictate more").props.onPress());
  await act(async () => mock.start.mock.calls[1]![0].onText("Second", true));
  expect(view.root.findByType("TextInput" as ElementType).props.value).toBe("First Second");
});

it("cancels background listening and ignores its late transcript", async () => {
  const view = await render();
  await act(async () => button(view, "Start dictation").props.onPress());
  const options = mock.start.mock.calls[0]![0];
  await act(async () => mock.background?.("background"));
  await act(async () => options.onText("Late background words", true));
  expect(button(view, "Start dictation")).toBeDefined();
  expect(view.root.findAllByType("TextInput" as ElementType)).toHaveLength(0);
});
it("does not cancel a pending microphone permission prompt on inactivity", async () => {
  let resolve!: () => void;
  mock.start.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const view = await render();
  await act(async () => button(view, "Start dictation").props.onPress());
  await act(async () => mock.background?.("inactive"));
  expect(mock.cancel).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(button(view, "Stop & review")).toBeDefined();
});
