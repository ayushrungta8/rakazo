import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  params: {} as Record<string, string>,
  push: vi.fn(),
  back: vi.fn(),
  sheet: vi.fn(),
}));
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
  useLocalSearchParams: () => mock.params,
  useRouter: () => ({ push: mock.push, back: mock.back }),
}));
vi.mock("../lib/api", () => ({ rpc: mock.rpc }));
vi.mock("../lib/native", () => ({
  useMobileTokens: () => ({}),
  useResolvedAppearance: () => "dark",
}));
vi.mock("../lib/message-action-sheet", () => ({ presentMessageActionSheet: mock.sheet }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "cache" } }));
vi.mock("expo-sharing", () => ({ isAvailableAsync: vi.fn(async () => false) }));
vi.mock("../lib/i18n", () => ({ t: (s: string) => s, useI18n: () => ({ t: (s: string) => s }) }));

import Approvals from "../app/approvals";
import ChatManagement from "../app/chat-management";
import Knowledge from "../app/knowledge";

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.params = {};
  mock.rpc.mockReset();
  mock.sheet.mockReset();
  mock.push.mockReset();
  mock.back.mockReset();
});
function button(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType("Pressable" as ElementType)
    .find((node) => node.props.accessibilityLabel === label)!;
}
it("approval rules load without changing policy, and save the chosen rule", async () => {
  mock.rpc.mockImplementation(async (path: string) =>
    path === "approvalRules/list" ? [] : { enabled: false, checkerAvailable: true },
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Approvals));
  });
  expect(mock.rpc.mock.calls.map((call) => call[0])).toEqual([
    "approvalRules/list",
    "autoReview/get",
  ]);
  await act(async () => {
    view.root.findByType("TextInput" as ElementType).props.onChangeText("email");
  });
  await act(async () => {
    button(view, "Add rule").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("approvalRules/set", {
    matchKind: "category",
    effect: "require_approval",
    matchValue: "email",
  });
  await act(async () => view.unmount());
});
it("builtin skills can be inspected but cannot be edited or deleted", async () => {
  mock.rpc.mockImplementation(async (path: string) =>
    path === "memory/list"
      ? []
      : path === "agentSkills/list"
        ? [{ id: "builtin", name: "Builtin", description: "Built in", readOnly: true }]
        : { id: "builtin", name: "Builtin", content: "immutable", readOnly: true },
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Knowledge));
  });
  expect(button(view, "Delete {name}")).toBeUndefined();
  await act(async () => {
    button(view, "Builtin").props.onPress();
  });
  expect(view.root.findByType("TextInput" as ElementType).props.editable).toBe(false);
  expect(button(view, "Save")).toBeUndefined();
  await act(async () => view.unmount());
});
it("reorders the complete active roster without sending archived bots", async () => {
  mock.rpc.mockImplementation(async (path: string) =>
    path === "bots/list"
      ? [
          { id: "one", name: "One" },
          { id: "old", name: "Archived", archivedAt: "yesterday" },
          { id: "two", name: "Two" },
        ]
      : [],
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(ChatManagement));
  });
  expect(mock.rpc.mock.calls.map((call) => call[0])).toEqual([
    "bots/list",
    "groups/list",
    "groups/listArchived",
  ]);
  expect(button(view, "Archived")).toBeUndefined();
  await act(async () => {
    button(view, "Reorder bots").props.onPress();
  });
  await act(async () => {
    button(view, "Move down").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("bots/reorder", { botIds: ["two", "one"] });
  await act(async () => view.unmount());
});
it("keeps archive, restore, duplicate and unread actions on their selected conversation", async () => {
  mock.rpc.mockImplementation(async (path: string) =>
    path === "bots/list"
      ? []
      : path === "groups/list"
        ? [{ id: "group", name: "Team" }]
        : path === "groups/listArchived"
          ? [{ id: "old", name: "Old" }]
          : path === "groups/duplicate"
            ? { id: "copy" }
            : {},
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(ChatManagement));
  });
  await act(async () => {
    button(view, "Team").props.onPress();
  });
  const actions = mock.sheet.mock.calls.at(-1)![0].actions as {
    text: string;
    onPress: () => void;
  }[];
  await act(async () => {
    actions.find((item) => item.text === "Duplicate")!.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("groups/duplicate", { groupId: "group" });
  expect(mock.push).toHaveBeenCalledWith({
    pathname: "/group-settings",
    params: { groupId: "copy" },
  });
  await act(async () => {
    actions.find((item) => item.text === "Archive")!.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("groups/archive", { groupId: "group" });
  await act(async () => {
    button(view, "Restore {name}").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("groups/restore", { groupId: "old" });
  await act(async () => {
    actions.find((item) => item.text === "Mark unread")!.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("threads/markUnread", { groupId: "group" });
  expect(mock.back).toHaveBeenCalledOnce();
  await act(async () => view.unmount());
});
