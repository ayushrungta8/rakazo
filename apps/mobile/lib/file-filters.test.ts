import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import Files from "../app/files";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), t: (s: string) => s }));
vi.mock("react-native", () => ({
  ActivityIndicator: "Spinner",
  Alert: { alert: vi.fn() },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Switch: "Switch",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("expo-router", () => ({
  Stack: { Screen: "StackScreen" },
  useFocusEffect: (fn: () => () => void) => useEffect(fn, [fn]),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../lib/api", () => ({ rpc: mock.rpc }));
vi.mock("../lib/native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("../lib/i18n", () => ({ t: mock.t, useI18n: () => ({ t: mock.t }) }));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.rpc.mockReset();
});
function button(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType("Pressable" as ElementType)
    .find((node) => node.props.accessibilityLabel === label)!;
}
function file(id: string) {
  return {
    id,
    name: id,
    description: null,
    mimeType: "text/plain",
    size: 10,
    versionCount: 1,
    createdAt: new Date().toISOString(),
  };
}
it("invalidates the old cursor and ignores its late page after changing bot scope", async () => {
  let finishOld!: (page: unknown) => void;
  mock.rpc.mockImplementation(async (path: string, input: { botId?: string; cursor?: string }) => {
    if (path === "bots/list") return [{ id: "two", name: "Bot Two" }];
    if (input.cursor === "all-next")
      return new Promise((resolve) => {
        finishOld = resolve;
      });
    return input.botId === "two"
      ? { items: [file("two-current")], nextCursor: "two-next" }
      : { items: [file("all-current")], nextCursor: "all-next" };
  });
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Files));
  });
  await act(async () => {
    button(view, "Load more").props.onPress();
  });
  await act(async () => {
    button(view, "Bot Two").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("artifacts/listSpace", { limit: 60, botId: "two" });
  expect(button(view, "all-current")).toBeUndefined();
  await act(async () => {
    finishOld({ items: [file("all-late")], nextCursor: null });
  });
  expect(button(view, "all-late")).toBeUndefined();
  expect(button(view, "two-current")).toBeDefined();
  await act(async () => {
    button(view, "Load more").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("artifacts/listSpace", {
    limit: 60,
    botId: "two",
    cursor: "two-next",
  });
  await act(async () => view.unmount());
});
it("keeps loaded-page search disclosure and does not clear the page on the current bot chip", async () => {
  mock.rpc.mockImplementation(async (path: string) =>
    path === "bots/list" ? [] : { items: [file("current")], nextCursor: "next" },
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Files));
  });
  await act(async () => {
    button(view, "All bots").props.onPress();
  });
  expect(button(view, "current")).toBeDefined();
  await act(async () => {
    view.root.findByType("TextInput" as ElementType).props.onChangeText("missing");
  });
  expect(
    view.root
      .findAllByType("Text" as ElementType)
      .some(
        (node) =>
          node.props.children === "No matches in loaded files. Load more to continue searching.",
      ),
  ).toBe(true);
  expect(button(view, "Load more")).toBeDefined();
  await act(async () => view.unmount());
});
