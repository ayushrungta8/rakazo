import { createElement } from "react";
import { ActionSheetIOS, Platform } from "react-native";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AndroidActionSheetHost } from "../components/android-action-sheet";
import {
  dismissAndroidActionSheet,
  getAndroidActionSheet,
  presentMessageActionSheet,
  subscribeAndroidActionSheet,
} from "./message-action-sheet";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 32, left: 0, right: 0 }),
}));
vi.mock("./native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: "NativeSymbol" }));

function sheet() {
  const actions = ["Reply", "React", "Speak", "Copy"].map((text) => ({ text, onPress: vi.fn() }));
  presentMessageActionSheet({
    actions,
    title: "12:34",
    cancel: "Cancel",
    colorScheme: "light",
  });
  return actions;
}

describe("native message action sheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dismissAndroidActionSheet();
  });

  it("preserves every iOS action, timestamp, appearance and cancellation", () => {
    Platform.OS = "ios";
    const actions = sheet();
    const [options, select] = vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mock.calls[0]!;
    expect(options).toEqual({
      options: ["Reply", "React", "Speak", "Copy", "Cancel"],
      cancelButtonIndex: 4,
      title: "12:34",
      userInterfaceStyle: "light",
    });
    select(4);
    expect(actions.every((action) => action.onPress.mock.calls.length === 0)).toBe(true);
    for (let index = 0; index < actions.length; index++) {
      select(index);
      expect(actions[index]!.onPress).toHaveBeenCalledOnce();
    }
  });

  it.each([0, 1, 3, 4, 20])("keeps Cancel separate from all %i Android choices", (count) => {
    Platform.OS = "android";
    const actions = Array.from({ length: count }, (_, index) => ({
      text: `Model ${index}`,
      selected: index === 2,
      onPress: vi.fn(),
    }));
    const changed = vi.fn();
    const unsubscribe = subscribeAndroidActionSheet(changed);
    presentMessageActionSheet({ actions, title: "Model", cancel: "Cancel", colorScheme: "dark" });
    expect(getAndroidActionSheet()).toEqual({ actions, title: "Model", cancel: "Cancel" });
    expect(changed).toHaveBeenCalledOnce();
    dismissAndroidActionSheet();
    expect(getAndroidActionSheet()).toBeNull();
    expect(actions.every((action) => action.onPress.mock.calls.length === 0)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it.each(["cancel", "outside", "back"])(
    "dismisses the Android sheet with %s without selecting",
    async (method) => {
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
      Platform.OS = "android";
      const actions = sheet();
      let view!: ReturnType<typeof create>;
      await act(async () => {
        view = create(createElement(AndroidActionSheetHost));
      });
      expect(
        view.root.findAllByType("ScrollView" as never)[0]!.findAllByType("Pressable" as never),
      ).toHaveLength(4);
      await act(async () => {
        if (method === "back") view.root.findByType("Modal" as never).props.onRequestClose();
        else {
          const buttons = view.root.findAllByType("Pressable" as never);
          buttons[method === "outside" ? 0 : buttons.length - 1]!.props.onPress();
        }
      });
      expect(view.toJSON()).toBeNull();
      expect(actions.every((action) => action.onPress.mock.calls.length === 0)).toBe(true);
      await act(async () => view.unmount());
    },
  );

  it("shows the current choice and closes before applying a selection once", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Platform.OS = "android";
    const onPress = vi.fn(() => expect(getAndroidActionSheet()).toBeNull());
    presentMessageActionSheet({
      title: "Model",
      cancel: "Cancel",
      colorScheme: "dark",
      actions: [{ text: "Current model", selected: true, onPress }],
    });
    let view!: ReturnType<typeof create>;
    await act(async () => {
      view = create(createElement(AndroidActionSheetHost));
    });
    const choice = view.root.findByType("ScrollView" as never).findByType("Pressable" as never);
    expect(choice.props.accessibilityState.selected).toBe(true);
    expect(choice.findAllByType("NativeSymbol" as never)).toHaveLength(1);
    await act(async () => choice.props.onPress());
    expect(onPress).toHaveBeenCalledOnce();
    expect(view.toJSON()).toBeNull();
    await act(async () => view.unmount());
  });
});
