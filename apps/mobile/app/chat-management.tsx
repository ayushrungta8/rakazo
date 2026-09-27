import type { ExportManifest, Group } from "@rakazo/contracts";
import { File, Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import { View } from "react-native";
import {
  SettingsButton,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import type { MobileBot } from "../lib/api";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { presentMessageActionSheet } from "../lib/message-action-sheet";
import { useResolvedAppearance } from "../lib/native";

export default function ChatManagement() {
  const { t } = useI18n();
  const router = useRouter();
  const action = useSettingsAction();
  const colorScheme = useResolvedAppearance();
  const [reordering, setReordering] = useState(false);
  const resource = useSettingsResource(
    useCallback(async () => {
      const [bots, groups, archived] = await Promise.all([
        rpc<MobileBot[]>("bots/list"),
        rpc<Group[]>("groups/list"),
        rpc<Group[]>("groups/listArchived"),
      ]);
      return { bots: bots.filter((b) => !b.archivedAt), groups, archived };
    }, []),
  );
  async function reorder(index: number, direction: -1 | 1) {
    const bots = [...(resource.data?.bots ?? [])];
    if (index + direction < 0 || index + direction >= bots.length) return;
    [bots[index], bots[index + direction]] = [bots[index + direction]!, bots[index]!];
    await rpc("bots/reorder", { botIds: bots.map((b) => b.id) });
    await resource.reload();
  }
  return (
    <SettingsPage
      title={t("Manage chats")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      <SettingsButton
        label={reordering ? t("Finish reordering") : t("Reorder bots")}
        disabled={action.busy}
        onPress={() => setReordering(!reordering)}
      />
      <SettingsText>{t("Bots")}</SettingsText>
      {resource.data?.bots.map((bot, index) => (
        <View key={bot.id} style={{ gap: 8 }}>
          <SettingsButton
            label={bot.name}
            disabled={action.busy}
            onPress={() =>
              presentMessageActionSheet({
                title: bot.name,
                cancel: t("Cancel"),
                colorScheme,
                actions: [
                  {
                    text: t("Chat settings"),
                    onPress: () =>
                      router.push({ pathname: "/bot-settings", params: { botId: bot.id } }),
                  },
                  {
                    text: t("Duplicate"),
                    onPress: () =>
                      void action.run(async () => {
                        const copy = await rpc<MobileBot>("bots/duplicate", { botId: bot.id });
                        router.push({ pathname: "/bot-settings", params: { botId: copy.id } });
                      }),
                  },
                  {
                    text: t("Export"),
                    onPress: () =>
                      void action.run(async () => {
                        if (!(await Sharing.isAvailableAsync()))
                          throw new Error(t("Sharing is unavailable"));
                        const exported = await rpc<ExportManifest>("export/bot", { botId: bot.id });
                        const file = new File(
                          Paths.cache,
                          `bot-${bot.id.replace(/[^A-Za-z0-9_-]/g, "_")}-export.json`,
                        );
                        try {
                          file.create({ overwrite: true });
                          file.write(JSON.stringify(exported, null, 2));
                          await Sharing.shareAsync(file.uri, { mimeType: "application/json" });
                        } finally {
                          try {
                            file.delete();
                          } catch {
                            /* Best effort cache cleanup. */
                          }
                        }
                      }),
                  },
                  {
                    text: t("Mark unread"),
                    onPress: () =>
                      void action.run(async () => {
                        await rpc("threads/markUnread", { botId: bot.id });
                        router.back();
                      }),
                  },
                ],
              })
            }
          />
          {reordering ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <SettingsButton
                label={t("Move up")}
                disabled={action.busy || index === 0}
                onPress={() => void action.run(() => reorder(index, -1))}
              />
              <SettingsButton
                label={t("Move down")}
                disabled={action.busy || index + 1 === resource.data?.bots.length}
                onPress={() => void action.run(() => reorder(index, 1))}
              />
            </View>
          ) : null}
        </View>
      ))}
      <SettingsText>{t("Groups")}</SettingsText>
      {resource.data?.groups.map((group) => (
        <SettingsButton
          key={group.id}
          label={group.name}
          disabled={action.busy}
          onPress={() =>
            presentMessageActionSheet({
              title: group.name,
              cancel: t("Cancel"),
              colorScheme,
              actions: [
                {
                  text: t("Group settings"),
                  onPress: () =>
                    router.push({ pathname: "/group-settings", params: { groupId: group.id } }),
                },
                {
                  text: t("Duplicate"),
                  onPress: () =>
                    void action.run(async () => {
                      const copy = await rpc<Group>("groups/duplicate", { groupId: group.id });
                      router.push({ pathname: "/group-settings", params: { groupId: copy.id } });
                    }),
                },
                {
                  text: t("Mark unread"),
                  onPress: () =>
                    void action.run(async () => {
                      await rpc("threads/markUnread", { groupId: group.id });
                      router.back();
                    }),
                },
                {
                  text: t("Archive"),
                  onPress: () =>
                    void action.run(async () => {
                      await rpc("groups/archive", { groupId: group.id });
                      await resource.reload();
                    }),
                },
              ],
            })
          }
        />
      ))}
      {resource.data?.archived.length ? <SettingsText>{t("Archived groups")}</SettingsText> : null}
      {resource.data?.archived.map((group) => (
        <SettingsButton
          key={group.id}
          label={t("Restore {name}", { name: group.name })}
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              await rpc("groups/restore", { groupId: group.id });
              await resource.reload();
            })
          }
        />
      ))}
    </SettingsPage>
  );
}
