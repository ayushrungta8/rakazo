import type { ComputerStatus, SkillPlaybook, TaughtSkill } from "@rakazo/contracts";
import { formatSkillRunPrompt } from "@rakazo/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import {
  confirmRemoval,
  SettingsButton,
  SettingsField,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { COMPUTER_LIFECYCLE_TIMEOUT_MS } from "../lib/computer";
import { useI18n } from "../lib/i18n";

export default function Teaching() {
  const { botId, skillId } = useLocalSearchParams<{ botId: string; skillId?: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const action = useSettingsAction();
  const resource = useSettingsResource(
    useCallback(async () => {
      const [skills, computer] = await Promise.all([
        rpc<TaughtSkill[]>("skills/list", { botId }),
        rpc<ComputerStatus>("computer/status", { botId }),
      ]);
      return { skills, computer };
    }, [botId]),
  );
  const [goal, setGoal] = useState("");
  const [selected, setSelected] = useState<string | null>(skillId ?? null);
  const [draft, setDraft] = useState<SkillPlaybook | null>(null);
  const [name, setName] = useState("");
  const skill = resource.data?.skills.find((item) => item.id === selected);
  const recording = resource.data?.skills.find((item) => item.status === "recording");
  useEffect(() => {
    setDraft(skill?.playbook ?? null);
    setName(skill?.name ?? "");
  }, [skill]);
  useEffect(() => {
    if (!resource.data?.skills.some((item) => item.status === "drafting")) return;
    const timer = setInterval(() => void resource.reload(), 3000);
    return () => clearInterval(timer);
  }, [resource.data, resource.reload]);
  async function persist() {
    if (!skill || !draft) return;
    await rpc("skills/updateDraft", { skillId: skill.id, name: name.trim(), playbook: draft });
  }
  const labels: Record<keyof SkillPlaybook, string> = {
    whenToUse: t("When to use"),
    inputs: t("Inputs (one per line)"),
    steps: t("Steps (one per line)"),
    howToCheck: t("How to check"),
    whatToReturn: t("What to return"),
    approvalBoundaries: t("Approval boundaries"),
    failureHandling: t("If a step fails"),
  };
  return (
    <SettingsPage
      title={t("Teach a task")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      {selected && skill ? (
        <>
          <SettingsButton label={t("All taught tasks")} onPress={() => setSelected(null)} />
          <SettingsText>{skill.goal}</SettingsText>
          {skill.status === "recording" ? (
            <SettingsButton
              label={t("Continue recording")}
              primary
              onPress={() =>
                router.push({ pathname: "/teach-computer", params: { botId, skillId: skill.id } })
              }
            />
          ) : skill.status === "drafting" ? (
            <SettingsText>{t("Preparing draft…")}</SettingsText>
          ) : draft ? (
            <>
              <SettingsField
                label={t("Name")}
                value={name}
                onChangeText={setName}
                editable={!action.busy}
                maxLength={80}
              />
              {(Object.keys(labels) as Array<keyof SkillPlaybook>).map((key) => (
                <SettingsField
                  key={key}
                  label={labels[key]}
                  value={Array.isArray(draft[key]) ? draft[key].join("\n") : draft[key]}
                  multiline
                  editable={!action.busy}
                  onChangeText={(value) =>
                    setDraft({
                      ...draft,
                      [key]: key === "inputs" || key === "steps" ? value.split("\n") : value,
                    })
                  }
                />
              ))}
              <SettingsButton
                label={t("Save task")}
                primary
                disabled={action.busy || !name.trim()}
                onPress={() =>
                  void action.run(async () => {
                    await persist();
                    await rpc("skills/save", { skillId: skill.id, name: name.trim() });
                    await resource.reload();
                  })
                }
              />
              <SettingsButton
                label={t("Test task")}
                disabled={action.busy || !name.trim()}
                onPress={() =>
                  void action.run(async () => {
                    await persist();
                    await rpc("skills/testRun", { skillId: skill.id });
                    router.push({ pathname: "/thread", params: { botId } });
                  })
                }
              />
              <SettingsButton
                label={t("Create routine")}
                disabled={action.busy || !name.trim()}
                onPress={() =>
                  void action.run(async () => {
                    await persist();
                    router.push({
                      pathname: "/routine-editor",
                      params: {
                        botId,
                        name: name.trim(),
                        prompt: formatSkillRunPrompt(name.trim(), draft),
                      },
                    });
                  })
                }
              />
            </>
          ) : null}
          <SettingsButton
            label={t("Delete task")}
            destructive
            disabled={action.busy}
            onPress={() =>
              confirmRemoval(
                t("Delete task?"),
                () =>
                  void action.run(async () => {
                    await rpc("skills/remove", { skillId: skill.id });
                    setSelected(null);
                    await resource.reload();
                  }),
              )
            }
          />
        </>
      ) : (
        <>
          {recording ? (
            <SettingsButton
              label={t("Continue recording")}
              primary
              onPress={() =>
                router.push({
                  pathname: "/teach-computer",
                  params: { botId, skillId: recording.id },
                })
              }
            />
          ) : (
            <>
              <SettingsField
                label={t("What result will you demonstrate?")}
                value={goal}
                onChangeText={setGoal}
                multiline
                maxLength={4000}
                editable={!action.busy}
              />
              <SettingsButton
                label={t("Start recording")}
                primary
                disabled={
                  action.busy ||
                  resource.loading ||
                  !!resource.error ||
                  !resource.data ||
                  resource.data.computer.kind === "desktop" ||
                  !goal.trim()
                }
                onPress={() =>
                  void action.run(async () => {
                    // Recheck immediately before boot/start: never start a second session from stale UI.
                    const skills = await rpc<TaughtSkill[]>("skills/list", { botId });
                    let current = skills.find((item) => item.status === "recording");
                    if (!current) {
                      await rpc(
                        "computer/boot",
                        { botId },
                        { timeoutMs: COMPUTER_LIFECYCLE_TIMEOUT_MS },
                      );
                      current = await rpc<TaughtSkill>("skills/start", {
                        botId,
                        goal: goal.trim(),
                      });
                    }
                    await resource.reload();
                    router.push({
                      pathname: "/teach-computer",
                      params: { botId, skillId: current.id },
                    });
                  })
                }
              />
              {resource.data?.computer.kind === "desktop" ? (
                <SettingsText>{t("Teaching needs a graphical sandbox computer.")}</SettingsText>
              ) : null}
            </>
          )}
          {resource.data?.skills.map((item) => (
            <View key={item.id} style={{ gap: 6 }}>
              <SettingsButton label={item.name || item.goal} onPress={() => setSelected(item.id)} />
              <SettingsText>
                {
                  {
                    recording: t("Recording"),
                    drafting: t("Preparing draft…"),
                    draft: t("Draft"),
                    saved: t("Saved"),
                  }[item.status]
                }
              </SettingsText>
            </View>
          ))}
        </>
      )}
    </SettingsPage>
  );
}
