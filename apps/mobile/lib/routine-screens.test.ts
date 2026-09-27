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
  replace: vi.fn(),
  sheet: vi.fn(),
  alert: vi.fn(),
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
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("expo-router", () => ({
  Stack: { Screen: "StackScreen" },
  useFocusEffect: (fn: () => () => void) => useEffect(fn, [fn]),
  useLocalSearchParams: () => mock.params,
  useRouter: () => ({ push: mock.push, back: mock.back, replace: mock.replace }),
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
    button(view, "More actions for Once").props.onPress();
    mock.sheet.mock.calls[0]![0].actions.find(
      (item: { text: string }) => item.text === "Resume",
    ).onPress();
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

it("keeps completed one-shots out of the Resume menu", async () => {
  mock.rpc.mockResolvedValue([{ ...paused, lastRunAt: "2026-09-01T09:00:00Z" }]);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Routines));
  });
  await act(async () => {
    button(view, "More actions for Once").props.onPress();
  });
  expect(mock.sheet.mock.calls[0]![0].actions.map((item: { text: string }) => item.text)).toEqual([
    "Edit",
    "Delete",
  ]);
  expect(
    mock.rpc.mock.calls.every(([path]) => path === "routines/list" || path === "bots/get"),
  ).toBe(true);
  await act(async () => view.unmount());
});
it("pauses a recurring routine from its menu and reloads the list", async () => {
  mock.rpc.mockImplementation(async (path: string) =>
    path === "routines/list" ? [{ ...paused, crons: ["0 9 * * *"], active: true }] : {},
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Routines));
  });
  await act(async () => {
    button(view, "More actions for Once").props.onPress();
  });
  await act(async () => {
    await mock.sheet.mock.calls[0]![0].actions.find(
      (item: { text: string }) => item.text === "Pause",
    ).onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("routines/update", { routineId: "routine", active: false });
  expect(mock.rpc.mock.calls.filter(([path]) => path === "routines/list")).toHaveLength(2);
  await act(async () => view.unmount());
});
it("requires confirmation before deleting a routine from its menu", async () => {
  mock.rpc.mockResolvedValue([paused]);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Routines));
  });
  await act(async () => {
    button(view, "More actions for Once").props.onPress();
    mock.sheet.mock.calls[0]![0].actions.find(
      (item: { text: string }) => item.text === "Delete",
    ).onPress();
  });
  expect(mock.rpc).not.toHaveBeenCalledWith("routines/remove", expect.anything());
  expect(mock.alert).toHaveBeenCalledWith("Delete Once?", undefined, expect.any(Array));
  await act(async () => {
    mock.alert.mock.calls[0]![2].find(
      (item: { style: string }) => item.style === "destructive",
    ).onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("routines/remove", { routineId: "routine" });
  await act(async () => view.unmount());
});
it("starts Run now only after a tap and preserves bot context", async () => {
  mock.rpc.mockResolvedValue([paused]);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Routines));
  });
  expect(mock.rpc).not.toHaveBeenCalledWith("routines/testRun", expect.anything());
  await act(async () => {
    button(view, "Run Once now").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith(
    "routines/testRun",
    expect.objectContaining({ routineId: "routine", clientNonce: expect.any(String) }),
  );
  expect(mock.push).toHaveBeenCalledWith({ pathname: "/thread", params: { botId: "bot" } });
  await act(async () => view.unmount());
});
it("opens the bot picker for a routines link with no bot context", async () => {
  mock.params = {};
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Routines));
  });
  expect(mock.rpc).not.toHaveBeenCalled();
  expect(button(view, "New routine")).toBeUndefined();
  await act(async () => {
    button(view, "Choose a bot").props.onPress();
  });
  expect(mock.replace).toHaveBeenCalledWith({
    pathname: "/settings",
    params: { area: "workspace", tool: "routines" },
  });
  await act(async () => view.unmount());
});

it("does not navigate after a manual run finishes on a screen the user left", async () => {
  let finish!: (value: unknown) => void;
  mock.rpc.mockImplementation(async (path: string) =>
    path === "routines/testRun"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : [paused],
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Routines));
  });
  await act(async () => {
    button(view, "Run Once now").props.onPress();
  });
  expect(button(view, "Edit Once").props.disabled).toBe(true);
  await act(async () => view.unmount());
  await act(async () => finish({}));
  expect(mock.push).not.toHaveBeenCalled();
});
it("keeps custom schedules and survives invalid next-run metadata", async () => {
  mock.rpc.mockResolvedValue([
    { ...paused, active: true, crons: ["0 9 * * 2"], nextRunAt: "invalid", timezone: "invalid" },
  ]);
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Routines));
  });
  const text = JSON.stringify(view.toJSON());
  expect(text).toContain("0 9 * * 2");
  expect(text).not.toContain("Next:");
  await act(async () => view.unmount());
});
