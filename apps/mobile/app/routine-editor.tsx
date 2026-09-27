import type { Bot, Routine } from "@rakazo/contracts";
import { ONCE_ROUTINE_CRON } from "@rakazo/core";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
  SettingsToggle,
  useSettingsAction,
} from "../components/settings-controls";
import { currentApiBase, rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { oneShotRunAt, routineInput } from "../lib/routine-draft";

export default function RoutineEditor() {
  const {
    botId,
    routineId,
    name: initialName,
    prompt: initialPrompt,
    activate,
  } = useLocalSearchParams<{
    botId: string;
    routineId?: string;
    name?: string;
    prompt?: string;
    activate?: string;
  }>();
  const router = useRouter();
  const { t } = useI18n();
  const action = useSettingsAction();
  const [existing, setExisting] = useState<Routine>();
  const [loading, setLoading] = useState(!!routineId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(initialName ?? "");
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [schedules, setSchedules] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [active, setActive] = useState(false);
  const [notify, setNotify] = useState(true);
  const [webhook, setWebhook] = useState(false);
  const [github, setGithub] = useState(false);
  const [provider, setProvider] = useState("");
  const [runAt, setRunAt] = useState("");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [savedWithNewSecret, setSavedWithNewSecret] = useState(false);
  useEffect(() => {
    if (!routineId) return;
    let live = true;
    void rpc<Routine[]>("routines/list", { botId })
      .then((list) => {
        if (!live) return;
        const r = list.find((r) => r.id === routineId);
        if (!r) throw new Error(t("Routine not found"));
        setExisting(r);
        setName(r.name);
        setPrompt(r.prompt);
        setSchedules(r.crons.join("\n"));
        setTimezone(r.timezone);
        setActive(r.active || (activate === "true" && !r.lastRunAt));
        setNotify(r.notify);
        setWebhook(r.webhookEnabled);
        setGithub(r.githubEnabled);
        setProvider(r.messageProvider ?? "");
      })
      .catch((err) => {
        if (live) setLoadError(String(err.message ?? err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [botId, routineId, activate, t]);
  const save = () =>
    action.run(async () => {
      const input = routineInput(botId, {
        name,
        prompt,
        schedules,
        timezone,
        active,
        notify,
        webhookEnabled: webhook,
        githubEnabled: github,
        messageProvider: provider,
      });
      const armed = oneShotRunAt(input.crons, runAt, existing, input.active);
      let generatedSecret = false;
      if ((webhook || github) && !webhookSecret) {
        const bot = await rpc<Pick<Bot, "webhookConfigured">>("bots/get", { botId });
        if (!bot.webhookConfigured) {
          const response = await rpc<{ secret: string }>("bots/rotateWebhookSecret", { botId });
          setWebhookSecret(response.secret);
          generatedSecret = true;
        }
      }
      if (routineId || existing?.id)
        await rpc("routines/update", {
          routineId: routineId ?? existing?.id,
          ...input,
          ...(armed ? { runAt: armed } : {}),
        });
      else {
        const created = await rpc<Routine>("routines/create", {
          ...input,
          active: armed ? false : input.active,
        });
        setExisting(created);
        if (armed)
          await rpc("routines/update", {
            routineId: created.id,
            runAt: armed,
            active: input.active,
          });
      }
      if (generatedSecret) setSavedWithNewSecret(true);
      else router.back();
    });
  return (
    <SettingsPage
      title={routineId ? t("Edit routine") : t("New routine")}
      loading={loading}
      error={action.error ?? loadError}
    >
      {savedWithNewSecret ? (
        <>
          <SettingsText>{t("Routine saved. Copy the webhook secret before leaving.")}</SettingsText>
          <SettingsButton
            label={t("Copy webhook secret")}
            onPress={() => void Clipboard.setStringAsync(webhookSecret!)}
          />
          <SettingsButton label={t("Done")} primary onPress={() => router.back()} />
        </>
      ) : !loading && !loadError ? (
        <>
          <SettingsField
            label={t("Name")}
            value={name}
            onChangeText={setName}
            maxLength={80}
            editable={!action.busy}
          />
          <SettingsField
            label={t("Prompt")}
            value={prompt}
            onChangeText={setPrompt}
            multiline
            editable={!action.busy}
          />
          <SettingsChoices
            label={t("Schedule")}
            value={schedules}
            choices={[
              { value: "0 9 * * *", label: t("Daily at 9") },
              { value: "0 9 * * 1-5", label: t("Weekdays at 9") },
              { value: "0 * * * *", label: t("Hourly") },
              { value: ONCE_ROUTINE_CRON, label: t("One time") },
              { value: "", label: t("Triggers only") },
            ]}
            onChange={setSchedules}
            disabled={action.busy}
          />
          <SettingsField
            label={t("Cron schedules (one per line)")}
            value={schedules}
            onChangeText={setSchedules}
            multiline
            editable={!action.busy}
          />
          {active &&
          schedules.trim() === ONCE_ROUTINE_CRON &&
          !existing?.lastRunAt &&
          !existing?.nextRunAt ? (
            <SettingsField
              label={t("Run at (local date and time)")}
              placeholder="2026-10-01T09:00"
              value={runAt}
              onChangeText={setRunAt}
            />
          ) : null}
          <SettingsField
            label={t("Timezone")}
            value={timezone}
            onChangeText={setTimezone}
            placeholder="Asia/Bangkok"
          />
          <SettingsToggle
            label={t("Active")}
            value={active}
            onChange={setActive}
            disabled={action.busy}
          />
          <SettingsToggle
            label={t("Notify on completion")}
            value={notify}
            onChange={setNotify}
            disabled={action.busy}
          />
          <SettingsToggle
            label={t("Webhook trigger")}
            value={webhook}
            onChange={setWebhook}
            disabled={action.busy}
          />
          <SettingsToggle
            label={t("GitHub trigger")}
            value={github}
            onChange={setGithub}
            disabled={action.busy}
          />
          <SettingsField
            label={t("Message provider (optional)")}
            value={provider}
            onChangeText={setProvider}
            placeholder="slack"
          />
          <SettingsButton
            label={action.busy ? t("Saving…") : t("Save")}
            primary
            disabled={action.busy || !name.trim() || !prompt.trim()}
            onPress={() => void save()}
          />
          {webhook || github ? (
            <>
              {webhook ? (
                <SettingsText>{`${t("Webhook URL")}: ${currentApiBase()}/api/v1/bots/${botId}/webhook`}</SettingsText>
              ) : null}
              {github ? (
                <SettingsText>{`${t("GitHub URL")}: ${currentApiBase()}/api/v1/bots/${botId}/github`}</SettingsText>
              ) : null}
              <SettingsButton
                label={t("Generate new webhook secret")}
                disabled={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    const response = await rpc<{ secret: string }>("bots/rotateWebhookSecret", {
                      botId,
                    });
                    setWebhookSecret(response.secret);
                  })
                }
              />
              {webhookSecret ? (
                <SettingsButton
                  label={t("Copy webhook secret")}
                  onPress={() => void Clipboard.setStringAsync(webhookSecret)}
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </SettingsPage>
  );
}
