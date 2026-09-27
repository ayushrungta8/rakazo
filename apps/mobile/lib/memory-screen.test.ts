import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import Memory from "../app/memory";

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

async function render(config: unknown = null) {
  mock.rpc.mockImplementation(async (method: string) =>
    method === "memory/providerConfig" ? config : { ok: true },
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Memory));
  });
  return view;
}
const config = {
  provider: "supermemory",
  defaultMemoryScope: "isolated",
  settings: { mode: "cloud" },
};
it("keeps setup fields hidden until deliberately connecting, and cancellation clears credentials", async () => {
  const view = await render();
  expect(view.root.findAllByType("TextInput" as ElementType)).toHaveLength(0);
  expect(mock.rpc.mock.calls).toEqual([["memory/providerConfig"]]);
  await act(async () => button(view, "Connect a memory service").props.onPress());
  const field = view.root.findByType("TextInput" as ElementType);
  await act(async () => field.props.onChangeText("test-secret-key"));
  await act(async () => button(view, "Cancel setup").props.onPress());
  await act(async () => button(view, "Connect a memory service").props.onPress());
  expect(view.root.findByType("TextInput" as ElementType).props.value).toBe("");
});
it("preserves provider connection payload and never connects on field edits", async () => {
  const view = await render();
  await act(async () => button(view, "Connect a memory service").props.onPress());
  await act(async () =>
    view.root.findByType("TextInput" as ElementType).props.onChangeText("test-secret-key"),
  );
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  await act(async () => button(view, "Connect memory service").props.onPress());
  expect(mock.rpc).toHaveBeenCalledWith("memory/connectProvider", {
    provider: "supermemory",
    defaultMemoryScope: "isolated",
    settings: { mode: "cloud" },
    credentials: { apiKey: "test-secret-key" },
  });
});
it("does not display a failed scope change as saved", async () => {
  const view = await render(config);
  mock.rpc.mockImplementation(async (method: string) => {
    if (method === "memory/setDefaultScope") throw Error("Denied");
    return config;
  });
  await act(async () => button(view, "Across the workspace").props.onPress());
  expect(button(view, "Each bot separately").props.accessibilityState.checked).toBe(true);
  expect(mock.rpc).toHaveBeenCalledWith("memory/setDefaultScope", { defaultMemoryScope: "shared" });
});
it("requires explicit confirmation to disconnect", async () => {
  const view = await render(config);
  await act(async () => button(view, "Disconnect memory service").props.onPress());
  expect(mock.rpc).not.toHaveBeenCalledWith("memory/disconnectProvider");
  const options = mock.alert.mock.calls[0]![2];
  expect(options[0].style).toBe("cancel");
  await act(async () => options[1].onPress());
  expect(mock.rpc).toHaveBeenCalledWith("memory/disconnectProvider");
});
