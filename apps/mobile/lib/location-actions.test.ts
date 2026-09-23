import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  currentState: "active",
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  AppState: {
    get currentState() {
      return app.currentState;
    },
    addEventListener: (_: string, fn: (state: string) => void) => {
      app.listeners.add(fn);
      return { remove: () => app.listeners.delete(fn) };
    },
  },
}));
vi.mock("expo-router", () => ({
  useFocusEffect: (effect: () => () => void) => useEffect(effect, [effect]),
}));
vi.mock("../lib/appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("../lib/i18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: vi.fn(),
  hasServicesEnabledAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
}));

import * as Location from "expo-location";
import { LocationAskActions } from "../components/LocationAskActions";

function state(value: string) {
  app.currentState = value;
  for (const fn of [...app.listeners]) fn(value);
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  app.currentState = "active";
  app.listeners.clear();
  vi.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  vi.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
    coords: { latitude: 12, longitude: 34, accuracy: 8 },
    timestamp: Date.now(),
  } as never);
});
afterEach(() => {
  vi.useRealTimers();
});

it("shares exactly once after a button press and Android permission activity returns", async () => {
  let permission!: (value: never) => void;
  vi.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(() => {
    state("background");
    return new Promise((resolve) => {
      permission = resolve;
    });
  });
  const onAnswer = vi.fn().mockResolvedValue(undefined);
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(createElement(LocationAskActions, { onAnswer }));
  });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => {
    view.root.findAllByType("Pressable" as never)[0]!.props.onPress();
  });
  await act(async () => {
    permission({ granted: true } as never);
  });
  expect(onAnswer).not.toHaveBeenCalled();
  await act(async () => {
    state("active");
  });
  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(JSON.parse(onAnswer.mock.calls[0]![0]).kind).toBe("device-location");
  await act(async () => view.unmount());
});

it("lets Not now cancel a permission request without late sharing", async () => {
  let permission!: (value: never) => void;
  vi.mocked(Location.requestForegroundPermissionsAsync).mockReturnValue(
    new Promise((resolve) => {
      permission = resolve;
    }),
  );
  const onAnswer = vi.fn().mockResolvedValue(undefined);
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(createElement(LocationAskActions, { onAnswer }));
  });
  await act(async () => {
    view.root.findAllByType("Pressable" as never)[0]!.props.onPress();
  });
  await act(async () => {
    view.root.findAllByType("Pressable" as never)[1]!.props.onPress();
  });
  await act(async () => {
    permission({ granted: true } as never);
  });
  expect(onAnswer).toHaveBeenCalledExactlyOnceWith("location-declined");
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});
