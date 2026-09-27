import type { Routine } from "@rakazo/contracts";
import { formatCron, isOneShotRoutineCrons } from "@rakazo/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import {
  confirmRemoval,
  SettingsButton,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function Routines() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const resource = useSettingsResource(
    useCallback(() => rpc<Routine[]>("routines/list", { botId }), [botId]),
  );
  const action = useSettingsAction();
  return (
    <SettingsPage
      title={t("Routines")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      <SettingsButton
        label={t("New routine")}
        primary
        onPress={() => router.push({ pathname: "/routine-editor", params: { botId } })}
      />
      {!resource.loading && resource.data?.length === 0 ? (
        <SettingsText>{t("Create a routine to schedule work.")}</SettingsText>
      ) : null}
      {resource.data?.map((routine) => (
        <View key={routine.id} style={{ gap: 8 }}>
          <SettingsButton
            label={routine.name}
            onPress={() =>
              router.push({ pathname: "/routine-editor", params: { botId, routineId: routine.id } })
            }
          />
          <SettingsText>
            {[
              routine.active ? t("Active") : t("Paused"),
              ...routine.crons.map(formatCron),
              routine.webhookEnabled ? t("Webhook") : "",
              routine.githubEnabled ? t("Git event") : "",
              routine.messageProvider ?? "",
              routine.timezone,
            ]
              .filter(Boolean)
              .join(" · ")}
          </SettingsText>
          <SettingsButton
            label={
              routine.active
                ? t("Pause")
                : routine.lastRunAt && isOneShotRoutineCrons(routine.crons)
                  ? t("Completed")
                  : t("Resume")
            }
            disabled={
              action.busy ||
              (!routine.active && !!routine.lastRunAt && isOneShotRoutineCrons(routine.crons))
            }
            onPress={() => {
              if (!routine.active && isOneShotRoutineCrons(routine.crons)) {
                router.push({
                  pathname: "/routine-editor",
                  params: { botId, routineId: routine.id, activate: "true" },
                });
                return;
              }
              void action.run(async () => {
                await rpc("routines/update", { routineId: routine.id, active: !routine.active });
                await resource.reload();
              });
            }}
          />
          <SettingsButton
            label={t("Run now")}
            disabled={action.busy}
            onPress={() =>
              void action.run(async () => {
                await rpc("routines/testRun", {
                  routineId: routine.id,
                  clientNonce: `mobile:${Date.now()}:${routine.id}`,
                });
                router.push({ pathname: "/thread", params: { botId } });
              })
            }
          />
          <SettingsButton
            label={t("Delete {name}", { name: routine.name })}
            destructive
            disabled={action.busy}
            onPress={() =>
              confirmRemoval(
                t("Delete {name}?", { name: routine.name }),
                () =>
                  void action.run(async () => {
                    await rpc("routines/remove", { routineId: routine.id });
                    await resource.reload();
                  }),
              )
            }
          />
        </View>
      ))}
    </SettingsPage>
  );
}
