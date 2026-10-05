import type { Routine } from "@rakazo/contracts";
import { isOneShotRoutineCron, isOneShotRoutineCrons, presetFromCron } from "@rakazo/core";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  confirmRemoval,
  SettingsButton,
  SettingsPage,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { dateLocaleForUi, useI18n } from "../lib/i18n";
import { presentMessageActionSheet } from "../lib/message-action-sheet";
import { useMobileTokens, useResolvedAppearance } from "../lib/native";

export default function Routines() {
  const { botId } = useLocalSearchParams<{ botId?: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const c = useMobileTokens();
  const colorScheme = useResolvedAppearance();
  const [botName, setBotName] = useState<string | null>(null);
  const resource = useSettingsResource(
    useCallback(
      () => (botId ? rpc<Routine[]>("routines/list", { botId }) : Promise.resolve([])),
      [botId],
    ),
    `routines:${botId ?? ""}`,
  );
  const action = useSettingsAction();
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  useEffect(() => {
    let active = true;
    setBotName(null);
    if (botId)
      void rpc<{ name: string }>("bots/get", { botId })
        .then((bot) => {
          if (active) setBotName(bot.name);
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [botId]);

  const edit = (routine?: Routine, activate = false) => {
    if (action.busy || !botId) return;
    router.push({
      pathname: "/routine-editor",
      params: {
        botId,
        ...(routine ? { routineId: routine.id } : {}),
        ...(activate ? { activate: "true" } : {}),
      },
    });
  };
  const completed = (routine: Routine) =>
    !routine.active && !!routine.lastRunAt && isOneShotRoutineCrons(routine.crons);
  const changeStatus = (routine: Routine) => {
    if (action.busy || completed(routine)) return;
    if (!routine.active && isOneShotRoutineCrons(routine.crons)) {
      edit(routine, true);
      return;
    }
    void action.run(async () => {
      await rpc("routines/update", { routineId: routine.id, active: !routine.active });
      await resource.reload();
    });
  };
  const openActions = (routine: Routine) =>
    presentMessageActionSheet({
      title: routine.name,
      cancel: t("Cancel"),
      colorScheme,
      actions: [
        { text: t("Edit"), onPress: () => edit(routine) },
        ...(!completed(routine)
          ? [
              {
                text: routine.active ? t("Pause") : t("Resume"),
                onPress: () => changeStatus(routine),
              },
            ]
          : []),
        {
          text: t("Delete"),
          onPress: () =>
            confirmRemoval(
              t("Delete {name}?", { name: routine.name }),
              () =>
                void action.run(async () => {
                  await rpc("routines/remove", { routineId: routine.id });
                  await resource.reload();
                }),
            ),
        },
      ],
    });
  const scheduleLabel = (cron: string) => {
    if (isOneShotRoutineCron(cron)) return t("One time");
    const preset = presetFromCron(cron);
    if (preset.freq === "Advanced") return preset.cron;
    if (preset.freq === "Every hour") return t("Hourly");
    if (preset.freq === "Interval") {
      if (preset.unit === "minutes")
        return preset.n === 1 ? t("Every minute") : t("Every {count} minutes", { count: preset.n });
      if (preset.unit === "hours")
        return preset.n === 1 ? t("Hourly") : t("Every {count} hours", { count: preset.n });
      return preset.n === 1 ? t("Every day") : t("Every {count} days", { count: preset.n });
    }
    const [minute, hour] = cron.trim().split(/\s+/);
    if (Number(hour) > 23 || Number(minute) > 59) return cron;
    const time = new Intl.DateTimeFormat(dateLocaleForUi(), {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2000, 0, 1, Number(hour), Number(minute))));
    if (preset.freq === "Weekdays") return t("Weekdays at {time}", { time });
    if (preset.freq === "Every week") return t("Mondays at {time}", { time });
    if (preset.freq === "Every month") return t("On the 1st at {time}", { time });
    return t("Every day at {time}", { time });
  };
  const nextRun = (routine: Routine) => {
    if (!routine.active || !routine.nextRunAt) return null;
    const date = new Date(routine.nextRunAt);
    if (!Number.isFinite(date.getTime())) return null;
    try {
      return new Intl.DateTimeFormat(dateLocaleForUi(), {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: routine.timezone,
      }).format(date);
    } catch {
      return null;
    }
  };

  return (
    <SettingsPage
      title={t("Routines")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      <Stack.Screen
        options={{
          headerRight:
            botId && resource.data?.length
              ? () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("New routine")}
                    disabled={action.busy}
                    accessibilityState={{ disabled: action.busy }}
                    onPress={() => edit()}
                    style={styles.iconButton}
                  >
                    <Ionicons name="add" size={24} color={c.foreground} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      {!botId ? (
        <SettingsButton
          label={t("Choose a bot")}
          onPress={() =>
            router.replace({
              pathname: "/settings",
              params: { area: "workspace", tool: "routines" },
            })
          }
        />
      ) : null}
      {botName ? (
        <Text style={[styles.context, { color: c.mutedForeground }]}>
          {t("Routines for {name}", { name: botName })}
        </Text>
      ) : null}
      {botId && !resource.loading && !resource.error && resource.data?.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={40} color={c.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: c.foreground }]}>{t("No routines yet")}</Text>
          <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
            {t("Schedule recurring work or trigger it from an event.")}
          </Text>
          <View style={styles.emptyAction}>
            <SettingsButton
              label={t("New routine")}
              primary
              disabled={action.busy}
              onPress={() => edit()}
            />
          </View>
        </View>
      ) : null}
      {resource.data?.map((routine) => {
        const isCompleted = completed(routine);
        const status = isCompleted ? t("Completed") : routine.active ? t("Active") : t("Paused");
        const upcoming = nextRun(routine);
        const triggers = [
          ...routine.crons.map(scheduleLabel),
          routine.webhookEnabled ? t("Webhook") : null,
          routine.githubEnabled ? t("Git event") : null,
          routine.messageProvider,
        ].filter(Boolean);
        return (
          <View
            key={routine.id}
            style={[styles.routine, { backgroundColor: c.card, borderColor: c.border }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Edit {name}", { name: routine.name })}
              disabled={action.busy}
              accessibilityState={{ disabled: action.busy }}
              onPress={() => edit(routine)}
              style={({ pressed }) => [
                styles.routineContent,
                { backgroundColor: pressed ? c.accent : c.card },
              ]}
            >
              <View style={styles.titleRow}>
                <Text style={[styles.name, { color: c.foreground }]}>{routine.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
              </View>
              {triggers.map((trigger, index) => (
                <Text
                  key={`${index}:${trigger}`}
                  style={[styles.schedule, { color: c.foreground }]}
                >
                  {trigger}
                </Text>
              ))}
              {upcoming ? (
                <Text style={[styles.detail, { color: c.mutedForeground }]}>
                  {t("Next: {time}", { time: upcoming })}
                </Text>
              ) : null}
              <Text style={[styles.detail, { color: c.mutedForeground }]}>{routine.timezone}</Text>
            </Pressable>
            <View style={[styles.actions, { borderTopColor: c.border }]}>
              <View style={styles.status}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: routine.active ? c.success : c.mutedForeground },
                  ]}
                />
                <Text style={[styles.statusLabel, { color: c.foreground }]}>{status}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Run {name} now", { name: routine.name })}
                accessibilityState={{ disabled: action.busy }}
                disabled={action.busy}
                style={({ pressed }) => [
                  styles.run,
                  {
                    backgroundColor: pressed ? c.accent : c.muted,
                    opacity: action.busy ? 0.45 : 1,
                  },
                ]}
                onPress={() =>
                  void action.run(async () => {
                    await rpc("routines/testRun", {
                      routineId: routine.id,
                      clientNonce: `mobile:${Date.now()}:${routine.id}`,
                    });
                    if (focused.current) router.push({ pathname: "/thread", params: { botId } });
                  })
                }
              >
                <Ionicons name="play-outline" size={16} color={c.foreground} />
                <Text style={[styles.actionLabel, { color: c.foreground }]}>{t("Run now")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("More actions for {name}", { name: routine.name })}
                accessibilityState={{ disabled: action.busy }}
                disabled={action.busy}
                onPress={() => openActions(routine)}
                style={({ pressed }) => [
                  styles.iconButton,
                  { backgroundColor: pressed ? c.accent : c.card, opacity: action.busy ? 0.45 : 1 },
                ]}
              >
                <Ionicons name="ellipsis-horizontal" size={22} color={c.foreground} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  context: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  routine: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: "hidden" },
  routineContent: { minHeight: 48, padding: 16, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  name: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: "600" },
  schedule: { fontSize: 14, lineHeight: 20 },
  detail: { fontSize: 13, lineHeight: 18 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  status: {
    flex: 1,
    minWidth: 88,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    paddingLeft: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 13, lineHeight: 18 },
  run: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  actionLabel: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
  },
  empty: { paddingVertical: 48, alignItems: "center", gap: 16 },
  emptyTitle: { fontSize: 20, lineHeight: 26, fontWeight: "600" },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 280 },
  emptyAction: { marginTop: 8, minWidth: 160 },
});
