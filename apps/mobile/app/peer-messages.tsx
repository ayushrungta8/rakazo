import { ChatMarkdown } from "@rakazo/chat-ui/native";
import type { PeerConversationPage, PeerMessagePage } from "@rakazo/contracts";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsButton, useSettingsResource } from "../components/settings-controls";
import { apiCacheRevision, apiCacheScope, rpc } from "../lib/api";
import { dateLocaleForUi, useI18n } from "../lib/i18n";
import { formatThreadTime } from "../lib/inbox";
import { useMobileTokens } from "../lib/native";
import { mergePeerConversationPage, mergePeerMessagePage } from "../lib/peer-activity";

export default function PeerMessages() {
  const { botId, peerBotId, peerName } = useLocalSearchParams<{
    botId: string;
    peerBotId?: string;
    peerName?: string;
  }>();
  return peerBotId ? (
    <PeerDetail
      key={`${botId}:${peerBotId}`}
      botId={botId}
      peerBotId={peerBotId}
      peerName={peerName}
    />
  ) : (
    <PeerList key={botId} botId={botId} />
  );
}

function PeerList({ botId }: { botId: string }) {
  const { t } = useI18n();
  const c = useMobileTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const latest = useRef<PeerConversationPage | null>(null);
  const resource = useSettingsResource(
    useCallback(async () => {
      const page = await rpc<PeerConversationPage>("threads/peerConversations", { botId });
      return mergePeerConversationPage(latest.current, page);
    }, [botId]),
    `peer-list:${botId}`,
  );
  latest.current = resource.data;
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const moreRunning = useRef(false);
  const loadMore = async () => {
    const after = resource.data?.nextCursor;
    if (!after || moreRunning.current) return;
    const scope = apiCacheScope();
    const revision = apiCacheRevision();
    moreRunning.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await rpc<PeerConversationPage>("threads/peerConversations", { botId, after });
      if (scope === apiCacheScope() && revision === apiCacheRevision())
        resource.setData((current) => mergePeerConversationPage(current, page, true));
    } catch (error) {
      if (scope === apiCacheScope() && revision === apiCacheRevision())
        setMoreError(error instanceof Error ? error.message : t("Error"));
    } finally {
      moreRunning.current = false;
      setLoadingMore(false);
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: t("Team activity") }} />
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      <FlatList
        data={resource.data?.conversations ?? []}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void resource.reload().finally(() => setRefreshing(false));
        }}
        keyExtractor={(item) => item.peerBotId}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: Math.max(24, insets.bottom + 20),
        }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.border }} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.peerBotName}
            onPress={() =>
              router.push({
                pathname: "/peer-messages",
                params: { botId, peerBotId: item.peerBotId, peerName: item.peerBotName },
              })
            }
            style={({ pressed }) => ({
              paddingVertical: 16,
              gap: 7,
              backgroundColor: pressed ? c.accent : c.background,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
              <Text
                numberOfLines={1}
                style={{ flex: 1, color: c.foreground, fontSize: 16, fontWeight: "600" }}
              >
                {item.peerBotName}
              </Text>
              <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
                {formatThreadTime(item.lastAt)}
              </Text>
            </View>
            <Text
              numberOfLines={2}
              style={{ color: c.mutedForeground, fontSize: 14, lineHeight: 20 }}
            >
              {item.lastText.replace(/\s+/g, " ").trim()}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={!resource.loading && !resource.error ? <EmptyState /> : null}
        ListFooterComponent={
          <View style={{ gap: 12, paddingTop: 16 }}>
            <LoadState error={moreError} retry={() => void loadMore()} />
            {resource.data?.nextCursor ? (
              <SettingsButton
                label={t("Load more")}
                disabled={loadingMore}
                onPress={() => void loadMore()}
              />
            ) : null}
            {loadingMore ? (
              <ActivityIndicator color={c.foreground} accessibilityLabel={t("Loading")} />
            ) : null}
          </View>
        }
      />
    </View>
  );
}

function PeerDetail({
  botId,
  peerBotId,
  peerName,
}: {
  botId: string;
  peerBotId: string;
  peerName?: string;
}) {
  const { t } = useI18n();
  const c = useMobileTokens();
  const insets = useSafeAreaInsets();
  const latest = useRef<PeerMessagePage | null>(null);
  const resource = useSettingsResource(
    useCallback(async () => {
      const page = await rpc<PeerMessagePage>("threads/peerMessages", { botId, peerBotId });
      return mergePeerMessagePage(latest.current, page);
    }, [botId, peerBotId]),
    `peer-detail:${botId}:${peerBotId}`,
  );
  latest.current = resource.data;
  const messages = useMemo(() => [...(resource.data?.messages ?? [])].reverse(), [resource.data]);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const moreRunning = useRef(false);
  const loadMore = async () => {
    const before = resource.data?.olderCursor;
    if (!before || moreRunning.current) return;
    const scope = apiCacheScope();
    const revision = apiCacheRevision();
    moreRunning.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await rpc<PeerMessagePage>("threads/peerMessages", { botId, peerBotId, before });
      if (scope === apiCacheScope() && revision === apiCacheRevision())
        resource.setData((current) => mergePeerMessagePage(current, page, true));
    } catch (error) {
      if (scope === apiCacheScope() && revision === apiCacheRevision())
        setMoreError(error instanceof Error ? error.message : t("Error"));
    } finally {
      moreRunning.current = false;
      setLoadingMore(false);
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{ title: messages[0]?.peerBotName ?? peerName ?? t("Peer conversation") }}
      />
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={() => void resource.reload()}
      />
      <FlatList
        inverted
        data={messages}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void resource.reload().finally(() => setRefreshing(false));
        }}
        keyExtractor={(message) => `${message.messageId}:${message.blockIndex}`}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={7}
        contentContainerStyle={{ padding: 20, paddingTop: Math.max(20, insets.bottom + 12) }}
        ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
        renderItem={({ item }) => {
          const sent = item.direction === "sent";
          return (
            <View style={{ alignSelf: sent ? "flex-end" : "flex-start", maxWidth: "94%", gap: 8 }}>
              <Text style={{ color: c.mutedForeground, fontSize: 12 }}>
                {`${sent ? t("Sent") : t("Received")} · ${new Date(item.createdAt).toLocaleString(dateLocaleForUi())}`}
              </Text>
              <View
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 16,
                  backgroundColor: sent ? c.accent : c.muted,
                }}
              >
                <ChatMarkdown>{item.text}</ChatMarkdown>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={!resource.loading && !resource.error ? <EmptyState /> : null}
        ListFooterComponent={
          <View style={{ gap: 12, paddingBottom: 16 }}>
            <LoadState error={moreError} retry={() => void loadMore()} />
            {resource.data?.olderCursor ? (
              <SettingsButton
                label={t("Load earlier messages")}
                disabled={loadingMore}
                onPress={() => void loadMore()}
              />
            ) : null}
            {loadingMore ? (
              <ActivityIndicator color={c.foreground} accessibilityLabel={t("Loading")} />
            ) : null}
          </View>
        }
      />
    </View>
  );
}

function EmptyState() {
  const { t } = useI18n();
  const c = useMobileTokens();
  return (
    <Text style={{ color: c.mutedForeground, paddingVertical: 24, textAlign: "center" }}>
      {t("No messages yet")}
    </Text>
  );
}

function LoadState({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: string | null;
  retry: () => void;
}) {
  const { t } = useI18n();
  const c = useMobileTokens();
  if (!loading && !error) return null;
  return (
    <View style={{ padding: 20, gap: 12 }} accessibilityLiveRegion="polite">
      {loading ? (
        <ActivityIndicator color={c.foreground} accessibilityLabel={t("Loading")} />
      ) : null}
      {error ? <Text style={{ color: c.destructive }}>{error}</Text> : null}
      {error ? <SettingsButton label={t("Retry")} onPress={retry} /> : null}
    </View>
  );
}
