import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import RoutineEditor from "../app/routine-editor";
import Routines from "../app/routines";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  params: {} as Record<string, string>,
  push: vi.fn(),
  back: vi.fn(),
  t: (s: string) => s,
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
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("../lib/api", () => ({ rpc: mock.rpc, currentApiBase: () => "https://example.invalid" }));
vi.mock("../lib/native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("../lib/i18n", () => ({ t: mock.t, useI18n: () => ({ t: mock.t }) }));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.params = { botId: "bot" };
  mock.rpc.mockReset();
  mock.push.mockReset();
  mock.back.mockReset();
});
function button(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType("Pressable" as ElementType)
    .find((node) => node.props.accessibilityLabel === label)!;
}
const paused = {
  id: "routine",
  name: "Once",
  prompt: "Check",
  crons: ["@once"],
  timezone: "UTC",
  active: false,
  notify: true,
  webhookEnabled: false,
  githubEnabled: false,
  messageProvider: null,
  lastRunAt: null,
  nextRunAt: null,
};
it("persists a default-paused one-shot without trying to arm it", async () => {
  mock.params = { botId: "bot", name: "Once", prompt: "Check" };
  mock.rpc.mockResolvedValue(paused);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(RoutineEditor));
  });
  await act(async () => {
    button(view, "One time").props.onPress();
  });
  await act(async () => {
    button(view, "Save").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(mock.rpc).toHaveBeenCalledWith(
    "routines/create",
    expect.objectContaining({ crons: ["@once"], active: false }),
  );
  expect(mock.back).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});
it("routes one-shot Resume to an editor to choose the required future time", async () => {
  mock.rpc.mockResolvedValue([paused]);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Routines));
  });
  await act(async () => {
    button(view, "Resume").props.onPress();
  });
  expect(mock.push).toHaveBeenCalledWith({
    pathname: "/routine-editor",
    params: { botId: "bot", routineId: "routine", activate: "true" },
  });
  expect(mock.rpc).not.toHaveBeenCalledWith("routines/update", expect.anything());
  await act(async () => view.unmount());
});
it("opens resumed one-shots active and asks for a run time before updating", async () => {
  mock.params = { botId: "bot", routineId: "routine", activate: "true" };
  mock.rpc.mockResolvedValue([paused]);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(RoutineEditor));
  });
  expect(
    view.root
      .findAllByType("Switch" as ElementType)
      .find((node) => node.props.accessibilityLabel === "Active")!.props.value,
  ).toBe(true);
  const date = view.root
    .findAllByType("TextInput" as ElementType)
    .find((node) => node.props.accessibilityLabel === "Run at (local date and time)")!;
  expect(date).toBeDefined();
  await act(async () => {
    button(view, "Save").props.onPress();
  });
  expect(mock.rpc).not.toHaveBeenCalledWith("routines/update", expect.anything());
  await act(async () => {
    date.props.onChangeText("2099-01-01T09:00");
  });
  await act(async () => {
    button(view, "Save").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith(
    "routines/update",
    expect.objectContaining({ routineId: "routine", active: true, runAt: expect.any(String) }),
  );
  await act(async () => view.unmount());
});
it("keeps an existing webhook secret when saving an enabled trigger", async () => {
  mock.params = { botId: "bot", name: "Webhook", prompt: "Check" };
  mock.rpc.mockImplementation(async (path: string) =>
    path === "bots/get" ? { webhookConfigured: true } : paused,
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(RoutineEditor));
  });
  await act(async () => {
    view.root
      .findAllByType("Switch" as ElementType)
      .find((node) => node.props.accessibilityLabel === "Webhook trigger")!
      .props.onValueChange(true);
  });
  await act(async () => {
    button(view, "Save").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("bots/get", { botId: "bot" });
  expect(mock.rpc).not.toHaveBeenCalledWith("bots/rotateWebhookSecret", expect.anything());
  expect(mock.back).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});
it("provisions an absent trigger secret and keeps it available to copy after saving", async () => {
  mock.params = { botId: "bot", name: "Webhook", prompt: "Check" };
  mock.rpc.mockImplementation(async (path: string) =>
    path === "bots/get"
      ? { webhookConfigured: false }
      : path === "bots/rotateWebhookSecret"
        ? { secret: "fake-test-secret" }
        : paused,
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(RoutineEditor));
  });
  await act(async () => {
    view.root
      .findAllByType("Switch" as ElementType)
      .find((node) => node.props.accessibilityLabel === "GitHub trigger")!
      .props.onValueChange(true);
  });
  await act(async () => {
    button(view, "Save").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("bots/rotateWebhookSecret", { botId: "bot" });
  expect(mock.rpc).toHaveBeenCalledWith(
    "routines/create",
    expect.objectContaining({ githubEnabled: true }),
  );
  expect(mock.back).not.toHaveBeenCalled();
  expect(button(view, "Copy webhook secret")).toBeDefined();
  await act(async () => {
    button(view, "Done").props.onPress();
  });
  expect(mock.back).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});
