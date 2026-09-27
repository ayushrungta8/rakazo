import Ionicons from "@react-native-vector-icons/ionicons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MobileBot, MobileMe } from "../lib/api";
import { rpc } from "../lib/api";
import { getAppVersionInfo } from "../lib/app-version";
import { getCachedAppearancePreference } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { UI_LOCALE_LABELS } from "../lib/ui-locale";

type IconName = ComponentProps<typeof Ionicons>["name"];

export default function Settings() {
  const { area: requestedArea, tool } = useLocalSearchParams<{ area?: string; tool?: string }>();
  const area =
    requestedArea && ["workspace", "ai", "app"].includes(requestedArea) ? requestedArea : undefined;
  const router = useRouter();
  const { t, locale } = useI18n();
  const c = useMobileTokens();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<MobileMe | null>(null);
  const [bots, setBots] = useState<MobileBot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const selectingBot = area === "workspace" && tool === "routines";
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError(null);
      if (selectingBot) setBots(null);
      void (async () => {
        const account = await rpc<MobileMe>("me");
        if (active) setMe(account);
        if (selectingBot) {
          const roster = await rpc<MobileBot[]>("bots/list");
          if (active) setBots(roster.filter((bot) => !bot.archivedAt));
        }
      })().catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : t("Try again."));
      });
      return () => {
        active = false;
      };
    }, [selectingBot, reload, t]),
  );

  const titles: Record<string, string> = {
    workspace: t("Workspace"),
    ai: t("AI & connections"),
    app: t("Account & app"),
  };
  const appearance = getCachedAppearancePreference();
  const appearanceLabel =
    appearance === "system" ? t("System") : appearance === "light" ? t("Light") : t("Dark");
  const preferences = `${appearanceLabel} · ${UI_LOCALE_LABELS[locale]}`;
  const row = (
    label: string,
    icon: IconName,
    onPress: () => void,
    detail?: string,
    category = false,
    key = label,
  ) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        category && styles.categoryRow,
        { backgroundColor: pressed ? c.accent : c.background },
      ]}
    >
      <Ionicons name={icon} size={category ? 24 : 20} color={c.foreground} accessible={false} />
      <View style={styles.rowText}>
        <Text style={[category ? styles.categoryLabel : styles.label, { color: c.foreground }]}>
          {label}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: c.mutedForeground }]}>{detail}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} accessible={false} />
    </Pressable>
  );
  const accountPage = (section: string) =>
    router.push({ pathname: "/account", params: { section } });
  const category = (next: string) => router.push({ pathname: "/settings", params: { area: next } });
  const divider = <View style={[styles.divider, { backgroundColor: c.border }]} />;

  return (
    <>
      <Stack.Screen
        options={{ title: selectingBot ? t("Routines") : (titles[area ?? ""] ?? t("Settings")) }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(24, insets.bottom + 16) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View style={styles.error}>
            <Text accessibilityLiveRegion="polite" style={{ color: c.destructive }}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setReload((value) => value + 1)}
              style={styles.retry}
            >
              <Text style={{ color: c.foreground }}>{t("Retry")}</Text>
            </Pressable>
          </View>
        ) : null}
        {!area ? (
          <>
            <View style={styles.identity}>
              <Text style={[styles.name, { color: c.foreground }]}>
                {me?.name ?? t("Your account")}
              </Text>
              {me?.email ? (
                <Text style={[styles.detail, { color: c.mutedForeground }]}>{me.email}</Text>
              ) : null}
            </View>
            {row(
              t("Workspace"),
              "layers-outline",
              () => category("workspace"),
              t("Chats, routines, saved knowledge and files"),
              true,
            )}
            {divider}
            {row(
              t("AI & connections"),
              "options-outline",
              () => category("ai"),
              t("Models, voice and connected apps"),
              true,
            )}
            {divider}
            {row(
              t("Account & app"),
              "person-circle-outline",
              () => category("app"),
              t("Profile, appearance and notifications"),
              true,
            )}
            <Text style={[styles.version, { color: c.mutedForeground }]}>
              {getAppVersionInfo().nativeLabel}
            </Text>
          </>
        ) : null}
        {area === "workspace" && !selectingBot ? (
          <>
            {row(t("Manage chats"), "chatbubbles-outline", () => router.push("/chat-management"))}
            {row(t("Routines"), "calendar-outline", () =>
              router.push({
                pathname: "/settings",
                params: { area: "workspace", tool: "routines" },
              }),
            )}
            {row(
              t("Saved knowledge & skills"),
              "book-outline",
              () => router.push("/knowledge"),
              t("Saved documents and bot instructions"),
            )}
            {row(
              t("Files"),
              "document-outline",
              () => router.push("/files"),
              t("Browse files created or uploaded in chats"),
            )}
            {row(
              t("Action confirmations"),
              "shield-checkmark-outline",
              () => router.push("/approvals"),
              t("Choose which bot actions need your approval"),
            )}
            {divider}
            {row(t("Archived bots"), "archive-outline", () => accountPage("archived"))}
          </>
        ) : null}
        {selectingBot ? (
          <>
            <Text style={[styles.context, { color: c.mutedForeground }]}>{t("Choose a bot")}</Text>
            {!bots && !error ? (
              <ActivityIndicator color={c.foreground} accessibilityLabel={t("Loading")} />
            ) : null}
            {bots?.map((bot) =>
              row(
                bot.name,
                "calendar-outline",
                () => router.push({ pathname: "/routines", params: { botId: bot.id } }),
                bot.title || undefined,
                false,
                bot.id,
              ),
            )}
            {bots?.length === 0 ? (
              <Text style={[styles.detail, { color: c.mutedForeground }]}>
                {t("Create a bot to add routines.")}
              </Text>
            ) : null}
          </>
        ) : null}
        {area === "ai" ? (
          <>
            {row(
              t("Models"),
              "hardware-chip-outline",
              () => router.push("/models"),
              me?.defaultModel ?? undefined,
            )}
            {row(t("Voice"), "mic-outline", () => router.push("/voice"))}
            {row(
              t("Memory service"),
              "albums-outline",
              () => router.push("/memory"),
              t("Connect a service for remembering across chats"),
            )}
            {divider}
            {row(
              t("Integrations"),
              "link-outline",
              () => router.push("/integrations"),
              t("Connect external apps and services"),
            )}
            {row(
              t("Messaging"),
              "paper-plane-outline",
              () => router.push("/messaging"),
              t("Connect bots to messaging channels"),
            )}
            {row(
              t("Tool servers (MCP)"),
              "server-outline",
              () => router.push("/mcp-servers"),
              t("Give bots tools from connected servers"),
            )}
            {divider}
            {row(
              t("AI data sharing"),
              "lock-closed-outline",
              () => router.push("/ai-data-sharing"),
              t("Control what connected AI services can receive"),
            )}
            {me?.isDeploymentOwner
              ? row(t("Server integrations"), "construct-outline", () =>
                  router.push("/integration-setup"),
                )
              : null}
          </>
        ) : null}
        {area === "app" ? (
          <>
            {row(
              t("Account"),
              "person-outline",
              () => accountPage("profile"),
              me?.email ?? undefined,
            )}
            {row(
              t("App preferences"),
              "color-palette-outline",
              () => accountPage("preferences"),
              preferences,
            )}
            {Platform.OS === "android"
              ? row(t("Notifications"), "notifications-outline", () => accountPage("notifications"))
              : null}
            {row(t("Usage"), "stats-chart-outline", () => accountPage("usage"))}
            {divider}
            {row(t("Advanced"), "code-slash-outline", () => accountPage("advanced"))}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  identity: { gap: 4, paddingVertical: 16, paddingHorizontal: 4, marginBottom: 16 },
  name: { fontSize: 20, fontWeight: "600" },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 4,
    paddingVertical: 16,
  },
  categoryRow: { minHeight: 96, paddingVertical: 24 },
  rowText: { flex: 1, gap: 4 },
  label: { fontSize: 16, lineHeight: 22 },
  categoryLabel: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  detail: { fontSize: 14, lineHeight: 20 },
  context: { fontSize: 14, lineHeight: 20, marginBottom: 16, paddingHorizontal: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  version: { fontSize: 12, lineHeight: 18, paddingHorizontal: 4, marginTop: 32 },
  error: { gap: 8 },
  retry: { minHeight: 48, justifyContent: "center" },
});
