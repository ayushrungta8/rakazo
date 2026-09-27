import type { AvatarStyle } from "@rakazo/contracts";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAvatarStyle } from "../components/avatar-style";
import { BotAvatar } from "../components/bot-avatar";
import { SettingsButton } from "../components/settings-controls";
import type { MobileBot, MobileMe } from "../lib/api";
import {
  currentApiBase,
  deleteAccount,
  loadSessionToken,
  rpc,
  selectedSpaceId,
  signOut,
} from "../lib/api";
import {
  getCachedAppearancePreference,
  mobileTokens,
  setAppearancePreference,
} from "../lib/appearance";
import { explicitSignInRoute } from "../lib/auth-routing";
import { confirmDeleteBot } from "../lib/bot-lifecycle";
import { setUiLocale, useI18n } from "../lib/i18n";
import type { LiveNotificationSettings } from "../lib/live-notifications";
import {
  canPostPromotedNotifications,
  DEFAULT_LIVE_NOTIFICATION_SETTINGS,
  getLiveNotificationSettings,
  openLiveNotificationSettings,
  openPromotedNotificationSettings,
  setLiveNotificationSettings,
} from "../lib/live-notifications";
import { presentMessageActionSheet } from "../lib/message-action-sheet";
import { native, useResolvedAppearance, useThemedStyles } from "../lib/native";
import { registerPushToken } from "../lib/push";
import {
  getCachedResponseStreamingEnabled,
  setResponseStreamingPreference,
  subscribeResponseStreaming,
} from "../lib/response-streaming";
import type { AccountUiLocale } from "../lib/ui-locale";
import { ACCOUNT_UI_LOCALES, UI_LOCALE_LABELS } from "../lib/ui-locale";

/** Render account settings, including the entry point for voice configuration. */
export default function Account() {
  const { t, locale } = useI18n();
  const colorScheme = useResolvedAppearance();
  const router = useRouter();
  const { focus, section: requestedSection } = useLocalSearchParams<{
    focus?: string;
    section?: string;
  }>();
  const section = focus === "usage" ? "usage" : (requestedSection ?? "profile");
  const titles: Record<string, string> = {
    profile: t("Account"),
    preferences: t("App preferences"),
    notifications: t("Notifications"),
    usage: t("Usage"),
    archived: t("Archived bots"),
    advanced: t("Advanced"),
    security: t("Delete account"),
  };
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [me, setMe] = useState<MobileMe | null>(null);
  const [password, setPassword] = useState("");
  const [localeSaving, setLocaleSaving] = useState(false);
  const [localeError, setLocaleError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<LiveNotificationSettings>(
    DEFAULT_LIVE_NOTIFICATION_SETTINGS,
  );
  const [notificationsReady, setNotificationsReady] = useState(Platform.OS !== "android");
  const [notificationPending, setNotificationPending] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archivedBots, setArchivedBots] = useState<MobileBot[]>([]);
  const [usage, setUsage] = useState<{
    runs: number;
    inputTokens: number;
    outputTokens: number;
  } | null>(null);
  const { avatarStyle, updateAvatarStyle } = useAvatarStyle();
  const appearance = getCachedAppearancePreference();
  const streamReplies = useSyncExternalStore(
    subscribeResponseStreaming,
    getCachedResponseStreamingEnabled,
    () => false,
  );
  const styles = useThemedStyles(createAccountStyles);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    setLoading(true);
    void (async () => {
      if (section === "profile") {
        const account = await rpc<MobileMe>("me");
        if (active) setMe(account);
      } else if (section === "archived") {
        const archived = await rpc<MobileBot[]>("bots/listArchived");
        if (active) setArchivedBots(archived);
      } else if (section === "usage") {
        const summary = await rpc<{ runs: number; inputTokens: number; outputTokens: number }>(
          "usage/summary",
        );
        if (active) setUsage(summary);
      } else if (section === "notifications" && Platform.OS === "android") {
        const settings = await getLiveNotificationSettings();
        if (active) {
          setNotifications(settings);
          setNotificationsReady(true);
        }
      }
    })()
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : t("Try again."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [section, reload, t]);

  const usageBlock = (
    <View accessibilityLabel={t("Usage")} style={styles.profile}>
      <Text style={styles.settingsTitle}>{t("Usage")}</Text>
      {usage ? (
        <Text style={styles.email}>
          {t("{runs} runs · {tokens} tokens", {
            runs: usage.runs,
            tokens: usage.inputTokens + usage.outputTokens,
          })}
        </Text>
      ) : null}
    </View>
  );

  async function restoreBot(botId: string) {
    try {
      await rpc("bots/restore", { botId });
      setArchivedBots((bots) => bots.filter((bot) => bot.id !== botId));
    } catch (restoreError) {
      Alert.alert(
        t("Could not restore bot"),
        restoreError instanceof Error ? restoreError.message : t("Try again."),
      );
    }
  }

  async function selectAvatarStyle(next: AvatarStyle) {
    if (next === avatarStyle) return;
    setAvatarPending(true);
    setAvatarError(null);
    try {
      await updateAvatarStyle(next);
    } catch {
      setAvatarError(t("Couldn't update avatars"));
    } finally {
      setAvatarPending(false);
    }
  }

  async function handleSignOut() {
    setPending(true);
    setError(null);
    try {
      await signOut();
      router.dismissAll();
      router.replace(explicitSignInRoute);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not sign out"));
      setPending(false);
    }
  }

  async function updateNotifications(next: LiveNotificationSettings) {
    const previous = notifications;
    setNotifications(next);
    setNotificationPending(true);
    setNotificationError(null);
    try {
      await setLiveNotificationSettings(
        next,
        currentApiBase(),
        await loadSessionToken(),
        selectedSpaceId() ?? "",
      );
      if (next.liveConnection && !(await canPostPromotedNotifications())) {
        await openPromotedNotificationSettings();
      }
      await registerPushToken();
    } catch (cause) {
      setNotifications(previous);
      setNotificationError(
        cause instanceof Error ? cause.message : t("Could not update notifications"),
      );
    } finally {
      setNotificationPending(false);
    }
  }

  function confirmDeletion() {
    setError(null);
    Alert.alert(
      t("Delete your account?"),
      t(
        "This permanently deletes your account, bots, conversations, memories, files, and saved connections. This cannot be undone.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Delete account"),
          style: "destructive",
          onPress: () => void handleDeletion(),
        },
      ],
    );
  }

  function applyLocale(code: AccountUiLocale) {
    if (code === locale || localeSaving) return;
    setLocaleSaving(true);
    setLocaleError(null);
    void setUiLocale(code)
      .catch(() => {
        setLocaleError(t("Could not change language"));
      })
      .finally(() => setLocaleSaving(false));
  }

  function openLanguagePicker() {
    if (localeSaving) return;
    presentMessageActionSheet({
      title: t("Language"),
      actions: ACCOUNT_UI_LOCALES.map((code) => ({
        text: UI_LOCALE_LABELS[code],
        selected: code === locale,
        onPress: () => applyLocale(code),
      })),
      colorScheme,
      cancel: t("Cancel"),
    });
  }

  async function handleDeletion() {
    setPending(true);
    setError(null);
    try {
      await deleteAccount(password);
      router.dismissAll();
      router.replace("/sign-in");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not delete account"));
    } finally {
      setPending(false);
    }
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <Stack.Screen options={{ title: titles[section] ?? t("Account") }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loading ? (
          <ActivityIndicator color={native.label} accessibilityLabel={t("Loading")} />
        ) : null}
        {loadError ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.error}>{loadError}</Text>
            <SettingsButton label={t("Retry")} onPress={() => setReload((value) => value + 1)} />
          </View>
        ) : null}
        {section === "profile" ? (
          <>
            <View style={styles.profile}>
              <Text style={styles.name}>{me?.name || t("Your account")}</Text>
              {me?.email ? <Text style={styles.email}>{me.email}</Text> : null}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/change-password")}
              style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}
            >
              <Text style={styles.settingsTitle}>{t("Change password")}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={() => void handleSignOut()}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            >
              <Text style={styles.buttonLabel}>{t("Sign out")}</Text>
            </Pressable>

            <SettingsButton
              label={t("Delete account")}
              destructive
              onPress={() => router.push({ pathname: "/account", params: { section: "security" } })}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : null}
        {section === "preferences" ? (
          <>
            <View accessibilityLabel={t("Appearance")} style={styles.avatarSection}>
              <Text style={styles.settingsTitle}>{t("Appearance")}</Text>
              <View style={styles.appearanceOptions}>
                {(
                  [
                    ["system", "System"],
                    ["light", "Light"],
                    ["dark", "Dark"],
                  ] as const
                ).map(([value, label]) => {
                  const selected = appearance === value;
                  const translated = t(label);
                  return (
                    <Pressable
                      key={value}
                      accessibilityLabel={translated}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => void setAppearancePreference(value)}
                      style={({ pressed }) => [
                        styles.appearanceOption,
                        selected && styles.appearanceOptionSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.appearanceLabel}>{translated}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View accessibilityLabel={t("Avatar style")} style={styles.avatarSection}>
              <Text style={styles.settingsTitle}>{t("Avatars")}</Text>
              <View style={styles.avatarOptions}>
                {(["robot", "organic"] as const).map((style) => {
                  const selected = avatarStyle === style;
                  const styleLabel = style === "robot" ? t("Robot") : t("Organic");
                  return (
                    <Pressable
                      key={style}
                      accessibilityLabel={t("{style} avatars", { style: styleLabel })}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: avatarPending }}
                      disabled={avatarPending}
                      onPress={() => void selectAvatarStyle(style)}
                      style={({ pressed }) => [
                        styles.avatarOption,
                        selected && styles.avatarOptionSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <BotAvatar
                        color={style === "robot" ? "#8B5CF6" : "#D62F8B"}
                        identity="avatar-preview"
                        size={42}
                        variant={style}
                      />
                      <Text style={styles.avatarLabel}>{styleLabel}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {avatarError ? <Text style={styles.error}>{avatarError}</Text> : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Language")}
              accessibilityValue={{ text: UI_LOCALE_LABELS[locale] }}
              accessibilityState={{ disabled: localeSaving }}
              disabled={localeSaving}
              onPress={openLanguagePicker}
              style={({ pressed }) => [
                styles.settingsButton,
                pressed && styles.pressed,
                localeSaving && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.settingsTitle}>{t("Language")}</Text>
              <View style={styles.settingsTrailing}>
                <Text style={styles.settingsValue}>{UI_LOCALE_LABELS[locale]}</Text>
                <Text style={styles.chevron}>›</Text>
              </View>
            </Pressable>
            {localeError ? <Text style={styles.error}>{localeError}</Text> : null}
          </>
        ) : null}
        {section === "notifications" ? (
          Platform.OS === "android" ? (
            <View accessibilityLabel={t("Notifications")} style={styles.profile}>
              <Text style={styles.settingsTitle}>{t("Notifications")}</Text>
              <NotificationSwitch
                label={t("Live working status")}
                detail={t("While agents are working")}
                value={notifications.liveConnection}
                disabled={notificationPending || !notificationsReady}
                onChange={(liveConnection) =>
                  void updateNotifications({ ...notifications, liveConnection })
                }
              />
              <NotificationSwitch
                label={t("Agent messages")}
                detail={t("Replies and completed work")}
                value={notifications.messages}
                disabled={notificationPending || !notificationsReady}
                onChange={(messages) => void updateNotifications({ ...notifications, messages })}
              />
              <NotificationSwitch
                label={t("Scheduled tasks")}
                detail={t("Alerts from routines")}
                value={notifications.scheduledTasks}
                disabled={notificationPending || !notificationsReady}
                onChange={(scheduledTasks) =>
                  void updateNotifications({ ...notifications, scheduledTasks })
                }
              />
              <NotificationSwitch
                label={t("Needs attention")}
                detail={t("Questions, approvals, takeover")}
                value={notifications.needsAttention}
                disabled={notificationPending || !notificationsReady}
                onChange={(needsAttention) =>
                  void updateNotifications({ ...notifications, needsAttention })
                }
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => void openPromotedNotificationSettings()}
                style={{ minHeight: 48, justifyContent: "center" }}
              >
                <Text style={{ color: native.label, fontSize: 14 }}>
                  {t("Live update settings")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void openLiveNotificationSettings()}
                style={{ minHeight: 48, justifyContent: "center" }}
              >
                <Text style={{ color: native.label, fontSize: 14 }}>
                  {t("Notification settings")}
                </Text>
              </Pressable>
              {notificationError ? <Text style={styles.error}>{notificationError}</Text> : null}
            </View>
          ) : null
        ) : null}
        {section === "usage" ? usageBlock : null}
        {section === "advanced" ? (
          <View style={styles.avatarSection}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t("Stream replies")}</Text>
              <Switch
                accessibilityLabel={t("Stream replies")}
                value={streamReplies}
                onValueChange={(checked) =>
                  void setResponseStreamingPreference(checked ? "on" : "off")
                }
              />
            </View>
          </View>
        ) : null}
        {section === "archived" && !loading && !loadError ? (
          archivedBots.length > 0 ? (
            <View style={styles.archivedSection}>
              <Text style={styles.sectionTitle}>{t("Archived bots")}</Text>
              {archivedBots.map((bot) => (
                <View key={bot.id} style={styles.archivedRow}>
                  <Text numberOfLines={1} style={styles.archivedName}>
                    {bot.name}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Restore {name}", { name: bot.name })}
                    onPress={() => void restoreBot(bot.id)}
                    style={{ minWidth: 48, minHeight: 48, justifyContent: "center" }}
                  >
                    <Text style={styles.restoreLabel}>{t("Restore")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      confirmDeleteBot(bot, () =>
                        setArchivedBots((bots) => bots.filter((item) => item.id !== bot.id)),
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={t("Delete {name}?", { name: bot.name })}
                    style={{ minWidth: 48, minHeight: 48, justifyContent: "center" }}
                  >
                    <Text style={styles.archivedDeleteLabel}>{t("Delete")}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.email}>{t("No archived bots")}</Text>
          )
        ) : null}
        {section === "security" ? (
          <View style={styles.dangerZone}>
            <Text style={styles.dangerTitle}>{t("Delete account")}</Text>
            <TextInput
              accessibilityLabel={t("Current password")}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!pending}
              onChangeText={(value) => {
                setPassword(value);
                setError(null);
              }}
              placeholder={t("Current password")}
              placeholderTextColor={native.tertiaryLabel}
              secureTextEntry
              style={styles.password}
              textContentType="password"
              value={password}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={pending || !password}
              onPress={confirmDeletion}
              style={({ pressed }) => [
                styles.deleteButton,
                (pending || !password) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {pending ? (
                <ActivityIndicator color={mobileTokens().destructiveForeground} />
              ) : (
                <Text style={styles.deleteLabel}>{t("Delete account")}</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function NotificationSwitch({
  label,
  detail,
  value,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View
      style={{
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: native.label, fontSize: 15 }}>{label}</Text>
        <Text style={{ color: native.secondaryLabel, fontSize: 12.5, marginTop: 2 }}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={detail}
        disabled={disabled}
        value={value}
        onValueChange={onChange}
      />
    </View>
  );
}

function createAccountStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: native.page,
    },
    content: {
      flexGrow: 1,
      padding: 20,
      gap: 16,
    },
    profile: {
      borderRadius: 16,
      backgroundColor: native.fill,
      padding: 16,
      gap: 4,
    },
    name: {
      color: native.label,
      fontSize: 20,
      fontWeight: "600",
    },
    email: {
      color: native.secondaryLabel,
      fontSize: 15,
    },
    button: {
      minHeight: 50,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: native.fill,
    },
    buttonLabel: {
      color: native.label,
      fontSize: 17,
      fontWeight: "600",
    },
    archivedSection: {
      borderRadius: 16,
      backgroundColor: native.fill,
      padding: 16,
      gap: 14,
    },
    sectionTitle: {
      color: native.secondaryLabel,
      fontSize: 14,
      fontWeight: "600",
    },
    archivedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    archivedName: {
      flex: 1,
      color: native.label,
      fontSize: 16,
    },
    restoreLabel: {
      color: native.label,
      fontSize: 14,
      fontWeight: "600",
    },
    archivedDeleteLabel: {
      color: tokens.destructive,
      fontSize: 14,
    },
    settingsButton: {
      minHeight: 62,
      borderRadius: 14,
      backgroundColor: native.fill,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    avatarSection: {
      borderRadius: 16,
      backgroundColor: native.fill,
      padding: 16,
      gap: 14,
    },
    appearanceOptions: {
      flexDirection: "row",
      gap: 8,
    },
    appearanceOption: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: native.tertiaryLabel,
      alignItems: "center",
      justifyContent: "center",
    },
    appearanceOptionSelected: {
      borderColor: native.label,
      backgroundColor: native.fillPressed,
    },
    appearanceLabel: {
      color: native.label,
      fontSize: 14,
      fontWeight: "600",
    },
    avatarOptions: {
      flexDirection: "row",
      gap: 12,
    },
    avatarOption: {
      flex: 1,
      minHeight: 86,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: native.tertiaryLabel,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    avatarOptionSelected: {
      borderColor: native.label,
      backgroundColor: native.fillPressed,
    },
    avatarLabel: {
      color: native.label,
      fontSize: 14,
      fontWeight: "600",
    },
    settingsTitle: {
      color: native.label,
      fontSize: 17,
      fontWeight: "600",
    },
    switchRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    switchLabel: {
      flex: 1,
      color: native.label,
      fontSize: 15,
    },
    settingsTrailing: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minWidth: 0,
    },
    settingsValue: {
      color: native.secondaryLabel,
      fontSize: 15,
    },
    chevron: {
      color: native.secondaryLabel,
      fontSize: 28,
      fontWeight: "300",
    },
    dangerZone: {
      marginTop: 12,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.destructive,
      padding: 16,
    },
    dangerTitle: {
      color: tokens.destructive,
      fontSize: 17,
      fontWeight: "600",
    },
    password: {
      height: 48,
      borderRadius: 12,
      backgroundColor: native.fill,
      color: native.label,
      paddingHorizontal: 14,
      marginTop: 16,
      fontSize: 16,
    },
    error: {
      color: tokens.destructive,
      fontSize: 14,
      marginTop: 10,
    },
    deleteButton: {
      minHeight: 50,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.destructive,
      marginTop: 14,
    },
    deleteLabel: {
      color: tokens.destructiveForeground,
      fontSize: 16,
      fontWeight: "700",
    },
    disabled: {
      opacity: 0.45,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
