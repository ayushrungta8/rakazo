import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSettingsResource } from "../components/settings-controls";
import { mobileResourceCache } from "./resource-cache";

vi.mock("expo-router", () => ({
  Stack: { Screen: "Screen" },
  useFocusEffect: (callback: () => () => void) => useEffect(callback, [callback]),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "Spinner",
  Alert: {},
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Switch: "Switch",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeArea",
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("./native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("./i18n", () => ({
  t: (text: string) => text,
  useI18n: () => ({ t: (text: string) => text }),
}));

const views: ReactTestRenderer[] = [];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mobileResourceCache.resetIdentity();
});
afterEach(async () => {
  await act(async () => {
    for (const view of views.splice(0)) view.unmount();
  });
});

function Probe({ load }: { load: () => Promise<string | null> }) {
  const resource = useSettingsResource(load, "settings-test");
  return createElement("state", {
    data: resource.data,
    loading: resource.loading,
    error: resource.error,
  });
}
async function render(load: () => Promise<string | null>) {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Probe, { load }));
  });
  views.push(view);
  return view;
}

it("renders a warm snapshot while refreshing and retains it on a temporary failure", async () => {
  mobileResourceCache.write(`${mobileResourceCache.scope()}|screen:settings-test`, "saved");
  let reject!: (error: Error) => void;
  const view = await render(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  expect(view.root.findByType("state" as ElementType).props).toMatchObject({
    data: "saved",
    loading: false,
  });
  await act(async () => {
    reject(new Error("offline"));
  });
  expect(view.root.findByType("state" as ElementType).props).toMatchObject({
    data: "saved",
    loading: false,
    error: "offline",
  });
});

it("treats a successful empty configuration as loaded", async () => {
  const view = await render(() => Promise.resolve(null));
  expect(view.root.findByType("state" as ElementType).props).toMatchObject({
    data: null,
    loading: false,
    error: null,
  });
});

it("never flashes previous-account content after a scope change or late response", async () => {
  mobileResourceCache.write(`${mobileResourceCache.scope()}|screen:settings-test`, "account A");
  const resolvers: Array<(value: string) => void> = [];
  const view = await render(() => new Promise<string>((resolve) => resolvers.push(resolve)));
  await act(async () => mobileResourceCache.resetIdentity());
  expect(view.root.findByType("state" as ElementType).props.data).toBeNull();
  await act(async () => resolvers[0]?.("late account A"));
  expect(view.root.findByType("state" as ElementType).props.data).toBeNull();
  await act(async () => resolvers[1]?.("account B"));
  expect(view.root.findByType("state" as ElementType).props.data).toBe("account B");
});

it("purges a forbidden snapshot so reopening cannot show deleted content", async () => {
  const key = `${mobileResourceCache.scope()}|screen:settings-test`;
  mobileResourceCache.write(key, "deleted");
  const error = Object.assign(new Error("Forbidden"), { status: 403 });
  const view = await render(() => Promise.reject(error));
  expect(view.root.findByType("state" as ElementType).props.data).toBeNull();
  expect(mobileResourceCache.peek(key)).toBeUndefined();
});
