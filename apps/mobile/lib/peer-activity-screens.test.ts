import type { PeerConversationPage, PeerMessagePage } from "@rakazo/contracts";
import type { ElementType, ReactNode } from "react";
import { createElement, useEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import PeerMessages from "../app/peer-messages";
import { mobileResourceCache } from "./resource-cache";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  params: {} as Record<string, string>,
  push: vi.fn(),
  scope: "account-space",
  t: (message: string) => message,
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "Spinner",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Switch: "Switch",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  Alert: { alert: vi.fn() },
  FlatList: (props: {
    data: unknown[];
    renderItem: (entry: { item: unknown }) => ReactNode;
    ListEmptyComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
  }) =>
    createElement(
      "FlatList",
      props,
      ...props.data.map((item) => props.renderItem({ item })),
      props.data.length ? null : props.ListEmptyComponent,
      props.ListFooterComponent,
    ),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: "StackScreen" },
  useFocusEffect: (fn: () => () => void) => useEffect(fn, [fn]),
  useLocalSearchParams: () => mock.params,
  useRouter: () => ({ push: mock.push }),
}));
vi.mock("@rakazo/chat-ui/native", () => ({ ChatMarkdown: "Markdown" }));
vi.mock("../lib/native", () => ({ useMobileTokens: () => ({}) }));
vi.mock("../lib/i18n", () => ({
  t: mock.t,
  dateLocaleForUi: () => "en-US",
  useI18n: () => ({ t: mock.t }),
}));
vi.mock("../lib/api", () => ({
  rpc: mock.rpc,
  apiCacheScope: () => mock.scope,
  apiCacheRevision: () => mobileResourceCache.version(),
  subscribeApiCacheScope: () => () => {},
  MobileRpcError: class extends Error {},
}));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.params = { botId: "chief" };
  mock.rpc.mockReset();
  mock.push.mockReset();
  mobileResourceCache.invalidate();
});
function summary(): PeerConversationPage {
  return {
    threadId: "thread",
    historyGeneration: 0,
    nextCursor: null,
    conversations: [
      {
        peerBotId: "mail",
        peerBotName: "Mail",
        lastSeq: 5,
        lastAt: "2026-01-01T00:00:00.000Z",
        lastDirection: "received",
        lastText: "Synthetic result",
      },
    ],
  };
}
function detail(seq: number, end = false): PeerMessagePage {
  return {
    threadId: "thread",
    historyGeneration: 0,
    olderCursor: end ? null : { seq, blockIndex: 0 },
    messages: [
      {
        messageId: `message-${seq}`,
        seq,
        blockIndex: 0,
        direction: "received",
        peerBotId: "mail",
        peerBotName: "Mail",
        text: `Synthetic exchange ${seq}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}
async function mount() {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(createElement(PeerMessages));
  });
  return view;
}
function button(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType("Pressable" as ElementType)
    .find((node) => node.props.accessibilityLabel === label)!;
}

it("loads a specialist summary once without downloading thread message pages", async () => {
  mock.rpc.mockResolvedValue(summary());
  const view = await mount();
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("threads/peerConversations", { botId: "chief" });
  await act(async () => {
    button(view, "Mail").props.onPress();
  });
  expect(mock.push).toHaveBeenCalledWith({
    pathname: "/peer-messages",
    params: { botId: "chief", peerBotId: "mail", peerName: "Mail" },
  });
  await act(async () => view.unmount());
});

it("renders a warm summary immediately while the refresh is pending", async () => {
  mock.rpc.mockResolvedValue(summary());
  let view = await mount();
  await act(async () => view.unmount());
  mock.rpc.mockImplementation(() => new Promise(() => {}));
  view = await mount();
  expect(button(view, "Mail")).toBeDefined();
  expect(view.root.findAllByType("Spinner" as ElementType)).toHaveLength(0);
  await act(async () => view.unmount());
});

it("opens just one specialist page and loads earlier entries only on request", async () => {
  mock.params = { botId: "chief", peerBotId: "mail", peerName: "Mail" };
  mock.rpc.mockResolvedValueOnce(detail(5)).mockResolvedValueOnce(detail(2, true));
  const view = await mount();
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("threads/peerMessages", {
    botId: "chief",
    peerBotId: "mail",
  });
  await act(async () => {
    button(view, "Load earlier messages").props.onPress();
  });
  expect(mock.rpc).toHaveBeenLastCalledWith("threads/peerMessages", {
    botId: "chief",
    peerBotId: "mail",
    before: { seq: 5, blockIndex: 0 },
  });
  expect(
    view.root.findAllByType("Markdown" as ElementType).map((node) => node.props.children),
  ).toEqual(["Synthetic exchange 5", "Synthetic exchange 2"]);
  expect(button(view, "Load earlier messages")).toBeUndefined();
  await act(async () => view.unmount());
});

it("mounts the inverted transcript with its first receipts rather than an empty footer anchor", async () => {
  mock.params = { botId: "chief", peerBotId: "mail" };
  let finish!: (page: PeerMessagePage) => void;
  mock.rpc.mockImplementationOnce(
    () =>
      new Promise<PeerMessagePage>((resolve) => {
        finish = resolve;
      }),
  );
  const view = await mount();
  expect(view.root.findAllByType("FlatList" as ElementType)).toHaveLength(0);
  await act(async () => {
    finish(detail(5));
  });
  const list = view.root.findByType("FlatList" as ElementType);
  expect(list.props.inverted).toBe(true);
  expect(list.props.data[0].seq).toBe(5);
  expect(list.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  await act(async () => view.unmount());
});

it("does not mount an empty anchored transcript after history is cleared", async () => {
  mock.params = { botId: "chief", peerBotId: "mail" };
  mock.rpc.mockResolvedValue({
    threadId: "thread",
    historyGeneration: 1,
    messages: [],
    olderCursor: null,
  });
  const view = await mount();
  expect(view.root.findAllByType("FlatList" as ElementType)).toHaveLength(0);
  expect(
    view.root
      .findAllByType("Text" as ElementType)
      .some((node) => node.props.children === "No messages yet"),
  ).toBe(true);
  await act(async () => view.unmount());
});

it("shows readable inline Markdown in a summary from an older server", async () => {
  const page = summary();
  page.conversations[0]!.lastText = "**Found it.** [Read details](https://example.test/long-url)";
  mock.rpc.mockResolvedValue(page);
  const view = await mount();
  expect(
    view.root
      .findAllByType("Text" as ElementType)
      .some((node) => node.props.children === "Found it. Read details"),
  ).toBe(true);
  await act(async () => view.unmount());
});

it("keeps a visible detail page when loading older entries fails", async () => {
  mock.params = { botId: "chief", peerBotId: "mail" };
  mock.rpc.mockResolvedValueOnce(detail(5)).mockRejectedValueOnce(new Error("Offline"));
  const view = await mount();
  await act(async () => {
    button(view, "Load earlier messages").props.onPress();
  });
  expect(view.root.findAllByType("Markdown" as ElementType)).toHaveLength(1);
  expect(button(view, "Retry")).toBeDefined();
  await act(async () => view.unmount());
});

it("keeps opened older entries when a cached detail is reopened and refreshed", async () => {
  mock.params = { botId: "chief", peerBotId: "mail" };
  mock.rpc.mockResolvedValueOnce(detail(5)).mockResolvedValueOnce(detail(2, true));
  let view = await mount();
  await act(async () => {
    button(view, "Load earlier messages").props.onPress();
  });
  await act(async () => view.unmount());
  mock.rpc.mockResolvedValueOnce(detail(6));
  view = await mount();
  expect(
    view.root.findAllByType("Markdown" as ElementType).map((node) => node.props.children),
  ).toEqual(["Synthetic exchange 6", "Synthetic exchange 5", "Synthetic exchange 2"]);
  expect(button(view, "Load earlier messages")).toBeUndefined();
  await act(async () => view.unmount());
});

it("ignores an older page that arrives after another screen clears cached history", async () => {
  mock.params = { botId: "chief", peerBotId: "mail" };
  let finish!: (page: PeerMessagePage) => void;
  mock.rpc.mockResolvedValueOnce(detail(5)).mockImplementationOnce(
    () =>
      new Promise<PeerMessagePage>((resolve) => {
        finish = resolve;
      }),
  );
  const view = await mount();
  await act(async () => {
    button(view, "Load earlier messages").props.onPress();
  });
  mobileResourceCache.invalidate();
  await act(async () => {
    finish(detail(2, true));
  });
  expect(
    view.root.findAllByType("Markdown" as ElementType).map((node) => node.props.children),
  ).toEqual(["Synthetic exchange 5"]);
  await act(async () => view.unmount());
});
