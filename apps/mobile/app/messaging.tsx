import type {
  ExternalConversation,
  MessagingAgentConnection,
  MessagingChannelMembership,
  MessagingStatus,
  SpaceNavigation,
} from "@rakazo/contracts";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import {
  confirmRemoval,
  SettingsButton,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import type { MobileBot } from "../lib/api";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function Messaging() {
  const { t } = useI18n();
  const router = useRouter();
  const action = useSettingsAction();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const resource = useSettingsResource(
    useCallback(async () => {
      const [status, channels, connections, bots, spaces] = await Promise.all([
        rpc<MessagingStatus>("messaging/status"),
        rpc<MessagingChannelMembership[]>("messaging/channels/list"),
        rpc<MessagingAgentConnection[]>("messaging/connections/list"),
        rpc<MobileBot[]>("bots/list"),
        rpc<SpaceNavigation>("spaces/list"),
      ]);
      return {
        status,
        channels,
        connections,
        bots,
        conversations: spaces.current.externalConversations,
      };
    }, []),
    "messaging",
  );
  const mutate = (path: string, input: Record<string, unknown>) =>
    action.run(async () => {
      await rpc(path, input);
      await resource.reload();
    });
  return (
    <SettingsPage
      title={t("Messaging")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      {resource.data && !resource.data.status.enabled ? (
        <SettingsText>{t("Messaging is not configured on this server.")}</SettingsText>
      ) : null}
      {code ? (
        <>
          <SettingsText>{`${code.code} · ${t("Expires")} ${new Date(code.expiresAt).toLocaleTimeString()}`}</SettingsText>
          <SettingsButton
            label={t("Copy link code")}
            onPress={() => void Clipboard.setStringAsync(code.code)}
          />
        </>
      ) : null}
      {resource.data?.status.enabled ? (
        <>
          <SettingsText>{t("Link a chat app to a bot")}</SettingsText>
          {resource.data.bots
            .filter((bot) => !bot.archivedAt)
            .map((bot) => (
              <SettingsButton
                key={bot.id}
                label={bot.name}
                disabled={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    setCode(await rpc("messaging/link/start", { botId: bot.id }));
                  })
                }
              />
            ))}
        </>
      ) : null}
      {resource.data?.status.identities.map((identity) => (
        <View key={identity.id} style={{ gap: 8 }}>
          <SettingsText>{`${identity.provider} · ${identity.address} · ${identity.botName}`}</SettingsText>
          {resource.data?.bots
            .filter((bot) => !bot.archivedAt && bot.id !== identity.botId)
            .map((bot) => (
              <SettingsButton
                key={bot.id}
                label={t("Use {name}", { name: bot.name })}
                disabled={action.busy}
                onPress={() =>
                  void mutate("messaging/identities/setBot", {
                    identityId: identity.id,
                    botId: bot.id,
                  })
                }
              />
            ))}
          <SettingsButton
            label={t("Unlink {name}", { name: identity.provider })}
            destructive
            disabled={action.busy}
            onPress={() =>
              confirmRemoval(
                t("Unlink this identity?"),
                () => void mutate("messaging/identities/unlink", { identityId: identity.id }),
              )
            }
          />
        </View>
      ))}
      {resource.data?.channels.map((channel) => (
        <View key={channel.id} style={{ gap: 8 }}>
          <SettingsText>{`${channel.name ?? channel.provider} · ${channel.status} · ${channel.memberCount}`}</SettingsText>
          {channel.status === "invited" ? (
            <>
              <SettingsButton
                label={t("Accept invitation")}
                disabled={action.busy}
                onPress={() =>
                  void mutate("messaging/channels/respond", {
                    membershipId: channel.id,
                    accept: true,
                  })
                }
              />
              <SettingsButton
                label={t("Decline invitation")}
                disabled={action.busy}
                onPress={() =>
                  void mutate("messaging/channels/respond", {
                    membershipId: channel.id,
                    accept: false,
                  })
                }
              />
            </>
          ) : channel.status === "approved" ? (
            <SettingsButton
              label={t("Leave channel")}
              destructive
              disabled={action.busy}
              onPress={() =>
                confirmRemoval(
                  t("Leave this channel?"),
                  () => void mutate("messaging/channels/leave", { membershipId: channel.id }),
                )
              }
            />
          ) : null}
        </View>
      ))}
      {resource.data?.connections.map((connection) => (
        <View key={connection.id} style={{ gap: 8 }}>
          <SettingsText>{`${connection.peerBotName} · ${connection.peerOwnerLabel} · ${connection.status}`}</SettingsText>
          {connection.incoming && connection.status === "pending" ? (
            <>
              <SettingsButton
                label={t("Approve connection")}
                disabled={action.busy}
                onPress={() =>
                  void mutate("messaging/connections/respond", {
                    connectionId: connection.id,
                    accept: true,
                  })
                }
              />
              <SettingsButton
                label={t("Decline connection")}
                disabled={action.busy}
                onPress={() =>
                  void mutate("messaging/connections/respond", {
                    connectionId: connection.id,
                    accept: false,
                  })
                }
              />
            </>
          ) : connection.status === "approved" ? (
            <SettingsButton
              label={t("Revoke connection")}
              destructive
              disabled={action.busy}
              onPress={() =>
                confirmRemoval(
                  t("Revoke this connection?"),
                  () =>
                    void mutate("messaging/connections/revoke", { connectionId: connection.id }),
                )
              }
            />
          ) : null}
        </View>
      ))}
      {resource.data?.conversations.map((conversation: ExternalConversation) => (
        <SettingsButton
          key={conversation.id}
          label={conversation.displayName ?? conversation.provider}
          onPress={() =>
            router.push({
              pathname: "/external-conversation",
              params: { conversationId: conversation.id },
            })
          }
        />
      ))}
    </SettingsPage>
  );
}
