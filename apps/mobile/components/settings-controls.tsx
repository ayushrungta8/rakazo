import { Stack, useFocusEffect } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import type { TextInputProps } from "react-native";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { t, useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export function SettingsPage({
  title,
  children,
  loading,
  error,
  retry,
  modal,
}: {
  title: string;
  children: ReactNode;
  loading?: boolean;
  error?: string | null;
  retry?: () => void;
  modal?: boolean;
}) {
  const c = useMobileTokens();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const content = (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        padding: 20,
        paddingBottom: Math.max(24, insets.bottom + 20),
        gap: 16,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {modal ? (
        <Text
          accessibilityRole="header"
          style={{ color: c.foreground, fontSize: 20, fontWeight: "600" }}
        >
          {title}
        </Text>
      ) : null}
      {loading ? (
        <ActivityIndicator accessibilityLabel={t("Loading")} color={c.foreground} />
      ) : null}
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text style={{ color: c.destructive }}>{error}</Text>
          {retry ? <SettingsButton label={t("Retry")} onPress={retry} /> : null}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
  return modal ? (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.background }}
      edges={["top", "left", "right"]}
    >
      {content}
    </SafeAreaView>
  ) : (
    <>
      <Stack.Screen options={{ title }} />
      {content}
    </>
  );
}
export function SettingsButton({
  label,
  onPress,
  disabled,
  primary,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  destructive?: boolean;
}) {
  const c = useMobileTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        justifyContent: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: primary ? c.primary : pressed ? c.accent : c.muted,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 15,
          fontWeight: "500",
          color: destructive ? c.destructive : primary ? c.primaryForeground : c.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function SettingsField({ label, ...props }: TextInputProps & { label: string }) {
  const c = useMobileTokens();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.foreground, fontSize: 14 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={c.mutedForeground}
        {...props}
        style={[
          {
            color: c.foreground,
            backgroundColor: c.muted,
            minHeight: 48,
            borderRadius: 12,
            padding: 14,
            fontSize: 15,
            textAlignVertical: props.multiline ? "top" : "center",
          },
          props.multiline && { minHeight: 120 },
          props.style,
        ]}
      />
    </View>
  );
}
export function SettingsToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const c = useMobileTokens();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}>
      <Text style={{ color: c.foreground, flex: 1, fontSize: 15 }}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      />
    </View>
  );
}
export function SettingsChoices<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const c = useMobileTokens();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.foreground, fontSize: 14 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {choices.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityLabel={choice.label}
            accessibilityState={{ checked: value === choice.value, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange(choice.value)}
            style={{
              minHeight: 48,
              justifyContent: "center",
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: choice.value === value ? c.primary : c.muted,
              opacity: disabled ? 0.45 : 1,
            }}
          >
            <Text style={{ color: choice.value === value ? c.primaryForeground : c.foreground }}>
              {choice.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function SettingsText({ children }: { children: ReactNode }) {
  const c = useMobileTokens();
  return (
    <Text selectable style={{ color: c.foreground, fontSize: 15, lineHeight: 23 }}>
      {children}
    </Text>
  );
}
export function confirmRemoval(label: string, action: () => void) {
  Alert.alert(label, undefined, [
    { text: t("Cancel"), style: "cancel" },
    { text: t("Delete"), style: "destructive", onPress: action },
  ]);
}

/** Reload on return from an editor, and ignore loads from a previous screen. */
export function useSettingsResource<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const reload = useCallback(async () => {
    const id = ++epoch.current;
    setLoading(true);
    setError(null);
    try {
      const next = await load();
      if (id === epoch.current) setData(next);
    } catch (err) {
      if (id === epoch.current)
        setError(err instanceof Error ? err.message : "Could not load settings");
    } finally {
      if (id === epoch.current) setLoading(false);
    }
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        epoch.current++;
      };
    }, [reload]),
  );
  return { data, setData, loading, error, reload };
}
export function useSettingsAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}
