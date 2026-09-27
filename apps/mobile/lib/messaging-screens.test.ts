import type { ElementType } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  params: {} as Record<string, string>,
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
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));
vi.mock("../lib/api", () => ({ rpc: mock.rpc }));
vi.mock("../lib/native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("../lib/i18n", () => ({ t: mock.t, useI18n: () => ({ t: mock.t }) }));

import ExternalConversationSettings from "../app/external-conversation";
import Messaging from "../app/messaging";

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.params = {};
  mock.rpc.mockReset();
});
function button(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType("Pressable" as ElementType)
    .find((node) => node.props.accessibilityLabel === label)!;
}
it("loads messaging without mutations, then reassigns an identity to the selected bot", async () => {
  mock.rpc.mockImplementation(async (path: string) =>
    path === "messaging/status"
      ? {
          enabled: true,
          identities: [
            { id: "identity", botId: "first", botName: "First", address: "fake", provider: "test" },
          ],
        }
      : path === "bots/list"
        ? [
            { id: "first", name: "First", archivedAt: null },
            { id: "second", name: "Second", archivedAt: null },
          ]
        : path === "spaces/list"
          ? { current: { externalConversations: [] } }
          : [],
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(Messaging));
  });
  expect(mock.rpc.mock.calls.map((call) => call[0])).toEqual([
    "messaging/status",
    "messaging/channels/list",
    "messaging/connections/list",
    "bots/list",
    "spaces/list",
  ]);
  await act(async () => {
    button(view, "Use {name}").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("messaging/identities/setBot", {
    identityId: "identity",
    botId: "second",
  });
  await act(async () => view.unmount());
});
it("preserves inherited policies on save and sends an explicit false for mentions-only", async () => {
  mock.params = { conversationId: "room" };
  mock.rpc.mockImplementation(async (path: string) =>
    path === "spaces/list"
      ? {
          current: {
            externalConversations: [
              {
                id: "room",
                displayName: "Room",
                teamChatAmbientEnabled: null,
                teamChatRules: null,
                automatedSenderPolicies: {},
                automatedSenders: [],
                participantNames: [],
              },
            ],
          },
        }
      : {},
  );
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(ExternalConversationSettings));
  });
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  await act(async () => {
    button(view, "Save").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("externalConversations/updatePolicy", {
    externalConversationId: "room",
    teamChatAmbientEnabled: null,
    teamChatRules: null,
    automatedSenderPolicies: {},
  });
  await act(async () => {
    button(view, "Mentions only").props.onPress();
  });
  await act(async () => {
    button(view, "Save").props.onPress();
  });
  expect(mock.rpc).toHaveBeenCalledWith("externalConversations/updatePolicy", {
    externalConversationId: "room",
    teamChatAmbientEnabled: false,
    teamChatRules: null,
    automatedSenderPolicies: {},
  });
  await act(async () => view.unmount());
});
it("rejects invalid sender rollup frequency before an RPC mutation", async () => {
  mock.params = { conversationId: "room" };
  mock.rpc.mockImplementation(async () => ({
    current: {
      externalConversations: [
        {
          id: "room",
          displayName: "Room",
          teamChatAmbientEnabled: null,
          teamChatRules: null,
          automatedSenderPolicies: {
            automation: { name: "Automation", mode: "rollup", rollupHours: 6 },
          },
          automatedSenders: [],
          participantNames: [],
        },
      ],
    },
  }));
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(ExternalConversationSettings));
  });
  await act(async () => {
    view.root
      .findAllByType("TextInput" as ElementType)
      .find((node) => node.props.keyboardType === "numeric")!
      .props.onChangeText("0");
  });
  await act(async () => {
    button(view, "Save").props.onPress();
  });
  expect(mock.rpc).not.toHaveBeenCalledWith(
    "externalConversations/updatePolicy",
    expect.anything(),
  );
  await act(async () => view.unmount());
});
