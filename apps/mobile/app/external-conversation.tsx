import type {
  AutomatedSenderPolicies,
  AutomatedSenderPolicyMode,
  SpaceNavigation,
} from "@rakazo/contracts";
import { UpdateExternalConversationPolicyInput } from "@rakazo/contracts";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function ExternalConversationSettings() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { t } = useI18n();
  const action = useSettingsAction();
  const resource = useSettingsResource(
    useCallback(async () => {
      const navigation = await rpc<SpaceNavigation>("spaces/list");
      const conversation = navigation.current.externalConversations.find(
        (c) => c.id === conversationId,
      );
      if (!conversation) throw new Error(t("Conversation not found"));
      return conversation;
    }, [conversationId, t]),
  );
  const [mode, setMode] = useState("inherit");
  const [rules, setRules] = useState<string | null>(null);
  const [policies, setPolicies] = useState<AutomatedSenderPolicies>({});
  useEffect(() => {
    if (resource.data) {
      setMode(
        resource.data.teamChatAmbientEnabled === null
          ? "inherit"
          : resource.data.teamChatAmbientEnabled
            ? "listen"
            : "mentions",
      );
      setRules(resource.data.teamChatRules);
      setPolicies(resource.data.automatedSenderPolicies);
    }
  }, [resource.data]);
  const senders = [
    ...new Map([
      ...(resource.data?.automatedSenders ?? []).map((s) => [s.id, s] as const),
      ...Object.entries(policies).map(([id, p]) => [id, { id, name: p.name }] as const),
    ]).values(),
  ];
  return (
    <SettingsPage
      title={resource.data?.displayName ?? t("Conversation settings")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      {resource.data ? (
        <>
          <SettingsChoices
            label={t("Listening")}
            value={mode}
            onChange={setMode}
            choices={[
              { value: "inherit", label: t("Bot default") },
              { value: "listen", label: t("Listen") },
              { value: "mentions", label: t("Mentions only") },
            ]}
          />
          <SettingsField
            label={t("Room guidance")}
            value={rules ?? ""}
            onChangeText={setRules}
            multiline
          />
          <SettingsButton label={t("Use bot guidance")} onPress={() => setRules(null)} />
          {senders.map((sender) => (
            <SettingsChoices
              key={sender.id}
              label={sender.name}
              value={policies[sender.id]?.mode ?? "ignore"}
              choices={[
                { value: "ignore", label: t("Ignore") },
                { value: "rollup", label: t("Group updates") },
                { value: "action", label: t("Always act") },
                { value: "user", label: t("Treat like a person") },
              ]}
              onChange={(next: AutomatedSenderPolicyMode) =>
                setPolicies((current) => ({
                  ...current,
                  [sender.id]: {
                    name: sender.name,
                    mode: next,
                    ...(next === "rollup"
                      ? { rollupHours: current[sender.id]?.rollupHours ?? 6 }
                      : {}),
                  },
                }))
              }
            />
          ))}
          {senders
            .filter((s) => policies[s.id]?.mode === "rollup")
            .map((sender) => (
              <SettingsField
                key={sender.id}
                label={t("Group update hours for {name}", { name: sender.name })}
                keyboardType="numeric"
                value={String(policies[sender.id]?.rollupHours ?? 6)}
                onChangeText={(text) =>
                  setPolicies((current) => ({
                    ...current,
                    [sender.id]: { ...current[sender.id]!, rollupHours: Number(text) },
                  }))
                }
              />
            ))}
          <SettingsButton
            label={t("Save")}
            primary
            disabled={action.busy}
            onPress={() =>
              void action.run(async () => {
                await rpc(
                  "externalConversations/updatePolicy",
                  UpdateExternalConversationPolicyInput.parse({
                    externalConversationId: conversationId,
                    teamChatAmbientEnabled: mode === "inherit" ? null : mode === "listen",
                    teamChatRules: rules,
                    automatedSenderPolicies: policies,
                  }),
                );
                await resource.reload();
              })
            }
          />
          <SettingsButton
            label={t("Reset to bot defaults")}
            disabled={action.busy}
            onPress={() => {
              setMode("inherit");
              setRules(null);
              setPolicies({});
            }}
          />
          <SettingsText>{resource.data.participantNames.join(", ")}</SettingsText>
        </>
      ) : null}
    </SettingsPage>
  );
}
