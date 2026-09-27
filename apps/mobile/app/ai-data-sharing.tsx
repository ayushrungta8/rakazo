import type { AiConsentStatus, AiDataUse, AiRecipient } from "@rakazo/contracts";
import { AI_DATA_DISCLOSURES, AI_PRIVACY_URL } from "@rakazo/contracts";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SettingsButton, SettingsPage } from "../components/settings-controls";
import { promptAiConsent } from "../lib/ai-consent";
import { rpc } from "../lib/api";
import { useMobileTokens } from "../lib/native";

const categories: { use: AiDataUse; title: string }[] = [
  { use: "model", title: "AI models" },
  { use: "voice", title: "Voice" },
  { use: "memory", title: "Memory" },
];

export default function AiDataSharing() {
  const [status, setStatus] = useState<AiConsentStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<AiDataUse[]>([]);
  const busy = useRef(false);
  const c = useMobileTokens();
  const load = () => {
    setLoadError(null);
    void rpc<AiConsentStatus>("aiConsent/status")
      .then(setStatus)
      .catch((cause: unknown) =>
        setLoadError(cause instanceof Error ? cause.message : "Could not load permissions."),
      );
  };
  useEffect(load, []);

  const run = async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await action();
    } catch (cause) {
      Alert.alert(
        "AI data sharing",
        cause instanceof Error ? cause.message : "Could not update permissions.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const changePermission = (recipient: AiRecipient) => {
    if (!status) return;
    void run(async () => {
      if (recipient.allowed) {
        setStatus(await rpc("aiConsent/revoke", { key: recipient.key }));
      } else if (await promptAiConsent(recipient, status.privacyUrl)) {
        setStatus(
          await rpc("aiConsent/allow", {
            scope: status.scope,
            version: status.version,
            keys: [recipient.key],
          }),
        );
      }
    });
  };
  const openPolicy = (url: string) => {
    void Linking.openURL(url).catch(() =>
      Alert.alert("Privacy policy", "Could not open this link."),
    );
  };

  return (
    <SettingsPage
      title="AI data sharing"
      loading={!status && !loadError}
      error={loadError}
      retry={load}
    >
      <View style={styles.intro}>
        <Text style={[styles.heading, { color: c.foreground }]}>You're in control</Text>
        <Text style={[styles.body, { color: c.mutedForeground }]}>
          Choose which services can receive data from your mobile actions.
        </Text>
      </View>
      {categories.map(({ use, title }) => {
        const recipients = status?.recipients.filter((recipient) => recipient.use === use) ?? [];
        if (!recipients.length) return null;
        const isExpanded = expanded.includes(use);
        return (
          <View key={use} style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: c.foreground }]}>
              {title}
            </Text>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {recipients.map((recipient, index) => (
                <View
                  key={recipient.key}
                  style={[
                    styles.row,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: c.border,
                    },
                  ]}
                >
                  <View style={styles.service}>
                    <Text style={[styles.name, { color: c.foreground }]}>{recipient.name}</Text>
                    {recipient.detail ? (
                      <Text style={[styles.detail, { color: c.mutedForeground }]}>
                        {recipient.detail}
                      </Text>
                    ) : null}
                    <Text style={[styles.state, { color: c.mutedForeground }]}>
                      {recipient.allowed ? "Permission allowed" : "Permission off"}
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel={`Share data with ${recipient.name}${recipient.detail ? `, ${recipient.detail}` : ""}`}
                    value={recipient.allowed}
                    disabled={pending}
                    onValueChange={() => changePermission(recipient)}
                    trackColor={{ false: c.muted, true: c.primary }}
                    thumbColor={recipient.allowed ? c.primaryForeground : c.mutedForeground}
                  />
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
              onPress={() =>
                setExpanded((current) =>
                  isExpanded ? current.filter((item) => item !== use) : [...current, use],
                )
              }
              style={styles.disclosure}
            >
              <Text style={[styles.linkText, { color: c.foreground }]}>What data is shared?</Text>
              {isExpanded ? (
                <Ionicons name="chevron-up" size={18} color={c.mutedForeground} />
              ) : (
                <Ionicons name="chevron-down" size={18} color={c.mutedForeground} />
              )}
            </Pressable>
            {isExpanded ? (
              <View style={styles.explanation}>
                <Text style={[styles.body, { color: c.mutedForeground }]}>
                  {AI_DATA_DISCLOSURES[use]}
                </Text>
                {Array.from(
                  new Map(
                    recipients
                      .filter((recipient) => recipient.privacyUrl)
                      .map((recipient) => [recipient.privacyUrl!, recipient]),
                  ).values(),
                ).map((recipient) => (
                  <Pressable
                    key={recipient.privacyUrl}
                    accessibilityRole="link"
                    onPress={() => openPolicy(recipient.privacyUrl!)}
                    style={styles.policy}
                  >
                    <Text style={[styles.linkText, { color: c.foreground }]}>
                      {recipient.name} privacy policy
                    </Text>
                    <Ionicons name="open-outline" size={16} color={c.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {status?.recipients.length === 0 ? (
        <Text style={[styles.body, { color: c.mutedForeground }]}>No AI services configured.</Text>
      ) : null}
      {status ? (
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <Text style={[styles.body, { color: c.mutedForeground }]}>
            Turning permission off stops new mobile actions from sharing data. Stop existing runs
            and disable routines separately.
          </Text>
          <SettingsButton
            label="Turn off all permissions"
            destructive
            disabled={pending || !status.recipients.some((recipient) => recipient.allowed)}
            onPress={() => {
              Alert.alert(
                "Turn off all permissions?",
                "New mobile AI actions will need your permission again.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Turn off all",
                    style: "destructive",
                    onPress: () =>
                      void run(async () =>
                        setStatus(await rpc<AiConsentStatus>("aiConsent/revoke", { key: null })),
                      ),
                  },
                ],
              );
            }}
          />
          <Pressable
            accessibilityRole="link"
            style={styles.policy}
            onPress={() => openPolicy(status.privacyUrl ?? AI_PRIVACY_URL)}
          >
            <Text style={[styles.linkText, { color: c.foreground }]}>Rakazo privacy policy</Text>
            <Ionicons name="open-outline" size={16} color={c.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8, marginBottom: 8 },
  heading: { fontSize: 24, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 21 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: "hidden" },
  row: { padding: 16, flexDirection: "row", gap: 12, alignItems: "center" },
  service: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: "500" },
  detail: { fontSize: 13, lineHeight: 18 },
  state: { fontSize: 12, marginTop: 2 },
  disclosure: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  linkText: { fontSize: 14, fontWeight: "500", flexShrink: 1 },
  explanation: { gap: 8, paddingBottom: 8 },
  policy: { minHeight: 48, flexDirection: "row", gap: 8, alignItems: "center" },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 20, gap: 12, marginTop: 4 },
});
