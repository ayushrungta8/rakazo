import { ChatMarkdown } from "@rakazo/chat-ui/native";
import type { ThreadMessage, ThreadMessagePage } from "@rakazo/contracts";
import { peerConversations } from "@rakazo/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import {
  SettingsButton,
  SettingsPage,
  SettingsText,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function PeerMessages() {
  const { botId, peerBotId, peerName } = useLocalSearchParams<{
    botId: string;
    peerBotId: string;
    peerName?: string;
  }>();
  const { t } = useI18n();
  const router = useRouter();
  const resource = useSettingsResource(
    useCallback(async () => {
      let before: number | undefined;
      let messages: ThreadMessage[] = [];
      const started = Date.now();
      const seen = new Set<number>();
      do {
        if (Date.now() - started > 60000) throw new Error(t("History took too long to load"));
        const page = await rpc<ThreadMessagePage>(
          "threads/messages",
          { botId, before, includePeerRuns: true },
          { timeoutMs: 15000 },
        );
        messages = [...page.messages, ...messages];
        before = page.olderCursor ?? undefined;
        if (before !== undefined && seen.has(before))
          throw new Error(t("History cursor did not advance"));
        if (before !== undefined) seen.add(before);
      } while (before !== undefined);
      return peerConversations(messages);
    }, [botId, peerBotId, t]),
  );
  const conversation = resource.data?.find((item) => item.peerBotId === peerBotId);
  return (
    <SettingsPage
      title={
        peerBotId
          ? (conversation?.peerBotName ?? peerName ?? t("Peer conversation"))
          : t("Team activity")
      }
      loading={resource.loading}
      error={resource.error}
      retry={() => void resource.reload()}
    >
      {!peerBotId
        ? resource.data?.map((item) => (
            <SettingsButton
              key={item.peerBotId}
              label={item.peerBotName}
              onPress={() =>
                router.push({
                  pathname: "/peer-messages",
                  params: { botId, peerBotId: item.peerBotId, peerName: item.peerBotName },
                })
              }
            />
          ))
        : null}
      {conversation?.messages.map((message, index) => (
        <View key={`${message.messageId}:${index}`} style={{ gap: 8 }}>
          <SettingsText>{`${message.direction === "sent" ? t("Sent") : t("Received")} · ${new Date(message.createdAt).toLocaleString()}`}</SettingsText>
          <ChatMarkdown>{message.text}</ChatMarkdown>
        </View>
      ))}
      {!resource.loading &&
      (!peerBotId ? !resource.data?.length : !conversation) &&
      !resource.error ? (
        <SettingsText>{t("No messages with this bot yet.")}</SettingsText>
      ) : null}
    </SettingsPage>
  );
}
