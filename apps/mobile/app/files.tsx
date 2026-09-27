import type { Artifact } from "@rakazo/contracts";
import type { CalendarDateFilter } from "@rakazo/core";
import { matchesCalendarDateFilter } from "@rakazo/core";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
  confirmRemoval,
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import type { MobileBot } from "../lib/api";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";

type FilePage = { items: (Artifact & { versionCount: number })[]; nextCursor: string | null };
type ScopedPage = FilePage & { botId: string };
export default function Files() {
  const router = useRouter();
  const { t } = useI18n();
  const action = useSettingsAction();
  const [botId, setBotId] = useState("");
  const generation = useRef(0);
  const resource = useSettingsResource(
    useCallback(async (): Promise<ScopedPage> => {
      generation.current++;
      const page = await rpc<FilePage>("artifacts/listSpace", {
        limit: 60,
        ...(botId ? { botId } : {}),
      });
      return { ...page, botId };
    }, [botId]),
  );
  const bots = useSettingsResource(useCallback(() => rpc<MobileBot[]>("bots/list"), []));
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [date, setDate] = useState<CalendarDateFilter>("all");
  const page = resource.data?.botId === botId ? resource.data : null;
  const matches = page?.items.filter(
    (item) =>
      `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (kind === "all" ||
        (kind === "image"
          ? item.mimeType.startsWith("image/")
          : kind === "pdf"
            ? item.mimeType === "application/pdf"
            : item.mimeType.startsWith("text/") || item.mimeType === "application/json")) &&
      matchesCalendarDateFilter(item.createdAt, date, new Date()),
  );
  return (
    <SettingsPage
      title={t("Files")}
      loading={resource.loading}
      error={action.error ?? resource.error ?? bots.error}
      retry={() => {
        void resource.reload();
        void bots.reload();
      }}
    >
      <SettingsField label={t("Search files")} value={query} onChangeText={setQuery} />
      <SettingsChoices
        label={t("Bot")}
        value={botId}
        choices={[
          { value: "", label: t("All bots") },
          ...(bots.data ?? []).map((bot) => ({ value: bot.id, label: bot.name })),
        ]}
        onChange={(next) => {
          if (next === botId) return;
          generation.current++;
          resource.setData(null);
          setBotId(next);
        }}
      />
      <SettingsChoices
        label={t("Type")}
        value={kind}
        choices={[
          { value: "all", label: t("All") },
          { value: "image", label: t("Images") },
          { value: "pdf", label: "PDF" },
          { value: "text", label: t("Text") },
        ]}
        onChange={setKind}
      />
      <SettingsChoices
        label={t("Date")}
        value={date}
        choices={[
          { value: "all", label: t("All time") },
          { value: "today", label: t("Today") },
          { value: "week", label: t("This week") },
          { value: "month", label: t("This month") },
        ]}
        onChange={setDate}
      />
      {matches?.length === 0 ? (
        <SettingsText>
          {page?.nextCursor
            ? t("No matches in loaded files. Load more to continue searching.")
            : t("No files found.")}
        </SettingsText>
      ) : null}
      {matches?.map((file) => (
        <View key={file.id} style={{ gap: 8 }}>
          <SettingsButton
            label={file.name}
            onPress={() =>
              router.push({ pathname: "/file-preview", params: { artifactId: file.id } })
            }
          />
          <SettingsText>{`${file.mimeType} · ${Math.ceil(file.size / 1024)} KB · ${file.versionCount} ${t("versions")} · ${new Date(file.createdAt).toLocaleDateString()}`}</SettingsText>
          <SettingsButton
            label={t("Delete {name}", { name: file.name })}
            destructive
            disabled={action.busy}
            onPress={() =>
              confirmRemoval(
                t("Delete {name}?", { name: file.name }),
                () =>
                  void action.run(async () => {
                    const requestedGeneration = generation.current;
                    await rpc("artifacts/remove", { artifactId: file.id });
                    if (requestedGeneration !== generation.current) return;
                    resource.setData((current) =>
                      current
                        ? { ...current, items: current.items.filter((f) => f.id !== file.id) }
                        : current,
                    );
                  }),
              )
            }
          />
        </View>
      ))}
      {page?.nextCursor ? (
        <SettingsButton
          label={t("Load more")}
          disabled={action.busy || resource.loading}
          onPress={() =>
            void action.run(async () => {
              const requestedGeneration = generation.current;
              const next = await rpc<FilePage>("artifacts/listSpace", {
                limit: 60,
                cursor: page.nextCursor,
                ...(botId ? { botId } : {}),
              });
              if (requestedGeneration !== generation.current) return;
              resource.setData((current) =>
                current?.botId === botId
                  ? {
                      ...current,
                      items: [
                        ...current.items,
                        ...next.items.filter((f) => !current.items.some((old) => old.id === f.id)),
                      ],
                      nextCursor: next.nextCursor,
                    }
                  : current,
              );
            })
          }
        />
      ) : null}
    </SettingsPage>
  );
}
