import type { ActionApprovalRule, ActionAutoReviewSettings } from "@rakazo/contracts";
import { useCallback, useState } from "react";
import { View } from "react-native";
import {
  confirmRemoval,
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
  SettingsToggle,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";

export default function Approvals() {
  const { t } = useI18n();
  const action = useSettingsAction();
  const resource = useSettingsResource(
    useCallback(async () => {
      const [rules, review] = await Promise.all([
        rpc<ActionApprovalRule[]>("approvalRules/list"),
        rpc<ActionAutoReviewSettings>("autoReview/get"),
      ]);
      return { rules, review };
    }, []),
  );
  const [kind, setKind] = useState<ActionApprovalRule["matchKind"]>("category");
  const [effect, setEffect] = useState<ActionApprovalRule["effect"]>("require_approval");
  const [value, setValue] = useState("");
  const setRule = (matchValue: string) =>
    action.run(async () => {
      await rpc("approvalRules/set", { matchKind: kind, effect, matchValue });
      setValue("");
      await resource.reload();
    });
  return (
    <SettingsPage
      title={t("Action confirmations")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      <SettingsText>
        {t(
          "Bots act without asking by default. Rules let you require approval or allow matching actions.",
        )}
      </SettingsText>
      <SettingsToggle
        label={t("Flag unexpected actions")}
        value={resource.data?.review.enabled ?? false}
        disabled={action.busy || !resource.data}
        onChange={(enabled) =>
          void action.run(async () => {
            await rpc("autoReview/set", { enabled });
            await resource.reload();
          })
        }
      />
      {resource.data?.review.enabled && !resource.data.review.checkerAvailable ? (
        <SettingsText>{t("The review checker is unavailable. Rules still apply.")}</SettingsText>
      ) : null}
      <SettingsChoices
        label={t("Match")}
        value={kind}
        choices={[
          { value: "category", label: t("Category") },
          { value: "tool", label: t("Tool") },
          { value: "connector", label: t("Connector") },
        ]}
        onChange={setKind}
        disabled={action.busy}
      />
      <SettingsChoices
        label={t("Action")}
        value={effect}
        choices={[
          { value: "require_approval", label: t("Ask first") },
          { value: "always_allow", label: t("Always allow") },
        ]}
        onChange={setEffect}
        disabled={action.busy}
      />
      <SettingsField
        label={t("Matching value")}
        placeholder={kind === "category" ? "email" : kind === "tool" ? "send_email" : "gmail"}
        value={value}
        onChangeText={setValue}
        editable={!action.busy}
      />
      <SettingsButton
        label={t("Add rule")}
        primary
        disabled={action.busy || !value.trim() || !resource.data}
        onPress={() => void setRule(value.trim())}
      />
      {resource.data?.rules.map((rule) => (
        <View key={rule.id} style={{ gap: 8 }}>
          <SettingsText>{`${rule.effect === "require_approval" ? t("Ask first") : t("Always allow")} · ${t(rule.matchKind)} · ${rule.matchValue}`}</SettingsText>
          <SettingsButton
            label={t("Remove rule for {name}", { name: rule.matchValue })}
            destructive
            disabled={action.busy}
            onPress={() =>
              confirmRemoval(
                t("Remove this rule?"),
                () =>
                  void action.run(async () => {
                    await rpc("approvalRules/remove", { id: rule.id });
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
