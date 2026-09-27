import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  params: { botId: "qa-bot" } as Record<string, string>,
  push: vi.fn(),
  translate: (s: string) => s,
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
  useRouter: () => ({ push: mock.push }),
}));
vi.mock("../lib/api", () => ({ rpc: mock.rpc }));
vi.mock("../lib/native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("../lib/i18n", () => ({ t: mock.translate, useI18n: () => ({ t: mock.translate }) }));

import Teaching from "../app/teaching";

const task = {
  id: "qa-skill",
  botId: "qa-bot",
  name: "QA skill",
  goal: "Export a sample",
  status: "saved",
  playbook: {
    whenToUse: "Sample",
    inputs: [],
    steps: ["Export"],
    howToCheck: "File exists",
    whatToReturn: "File",
    approvalBoundaries: "Ask before publishing",
    failureHandling: "Stop",
  },
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.params = { botId: "qa-bot" };
  mock.rpc.mockReset();
  mock.push.mockReset();
});
function button(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType("Pressable" as ElementType)
    .find((node) => node.props.accessibilityLabel === label)!;
}
it("loading a task does not take control or start a recording", async () => {
  mock.rpc.mockImplementation(async (path: string) =>
    path === "skills/list" ? [task] : { kind: "docker" },
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Teaching));
  });
  expect(mock.rpc.mock.calls.map((call) => call[0])).toEqual(["skills/list", "computer/status"]);
  await act(async () => view.unmount());
});
it("a failed recording probe leaves Start disabled", async () => {
  mock.rpc.mockRejectedValue(new Error("offline"));
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Teaching));
  });
  expect(button(view, "Start recording").props.disabled).toBe(true);
  expect(mock.rpc).not.toHaveBeenCalledWith("skills/start", expect.anything());
  await act(async () => view.unmount());
});
it("rechecks recording before starting and recovers an existing session", async () => {
  let reads = 0;
  mock.rpc.mockImplementation(async (path: string) =>
    path === "skills/list"
      ? ++reads === 1
        ? []
        : [{ ...task, status: "recording" }]
      : { kind: "docker" },
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Teaching));
  });
  await act(async () =>
    view.root.findByType("TextInput" as ElementType).props.onChangeText("QA export"),
  );
  await act(async () => button(view, "Start recording").props.onPress());
  expect(
    mock.rpc.mock.calls.some((call) => call[0] === "computer/boot" || call[0] === "skills/start"),
  ).toBe(false);
  expect(mock.push).toHaveBeenCalledWith({
    pathname: "/teach-computer",
    params: { botId: "qa-bot", skillId: "qa-skill" },
  });
  await act(async () => view.unmount());
});
it("persisting before a test run uses current draft fields", async () => {
  mock.params.skillId = "qa-skill";
  mock.rpc.mockImplementation(async (path: string) =>
    path === "skills/list" ? [task] : { kind: "docker" },
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Teaching));
  });
  await act(async () =>
    view.root
      .findAllByType("TextInput" as ElementType)
      .find((node) => node.props.accessibilityLabel === "How to check")!
      .props.onChangeText("Verify CSV headers"),
  );
  await act(async () => button(view, "Test task").props.onPress());
  expect(mock.rpc).toHaveBeenCalledWith("skills/updateDraft", {
    skillId: "qa-skill",
    name: "QA skill",
    playbook: { ...task.playbook, howToCheck: "Verify CSV headers" },
  });
  const writes = mock.rpc.mock.calls.filter(
    (call) => call[0] === "skills/updateDraft" || call[0] === "skills/testRun",
  );
  expect(writes.map((call) => call[0])).toEqual(["skills/updateDraft", "skills/testRun"]);
  await act(async () => view.unmount());
});
