import { Stack, useFocusEffect } from "expo-router";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
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
import { mobileResourceCache } from "../lib/resource-cache";

const resourceScope = () => mobileResourceCache.scope();

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
export function useSettingsResource<T>(load: () => Promise<T>, cacheKey?: string) {
  const scope = useSyncExternalStore(mobileResourceCache.subscribe, resourceScope, resourceScope);
  const key = `${scope}|screen:${cacheKey ?? "local"}`;
  const cached = (): T | null => (cacheKey ? (mobileResourceCache.peek<T>(key) ?? null) : null);
  const initial = () => ({
    key,
    data: cached(),
    loaded: !!cacheKey && mobileResourceCache.peek<T>(key) !== undefined,
    updatedAt: mobileResourceCache.writtenAt(key) ?? 0,
    error: null as string | null,
    refreshing: false,
  });
  const [state, setState] = useState(initial);
  const current = state.key === key ? state : initial();
  const stateRef = useRef(current);
  stateRef.current = current;
  const epoch = useRef(0);
  const setData: Dispatch<SetStateAction<T | null>> = useCallback(
    (update) => {
      if (scope !== resourceScope()) return;
      setState((previous) => {
        const value = previous.key === key ? previous.data : cached();
        const data =
          typeof update === "function" ? (update as (value: T | null) => T | null)(value) : update;
        if (cacheKey && data !== null) mobileResourceCache.write(key, data);
        return { key, data, loaded: true, updatedAt: Date.now(), error: null, refreshing: false };
      });
    },
    [key, scope, cacheKey],
  );
  const reload = useCallback(async () => {
    const id = ++epoch.current;
    const revision = mobileResourceCache.version();
    setState({ ...stateRef.current, key, error: null, refreshing: true });
    try {
      const next = cacheKey ? await mobileResourceCache.fetch(key, load) : await load();
      if (
        id === epoch.current &&
        scope === resourceScope() &&
        revision === mobileResourceCache.version()
      ) {
        setState({
          key,
          data: next,
          loaded: true,
          updatedAt: Date.now(),
          error: null,
          refreshing: false,
        });
      }
    } catch (err) {
      if (id === epoch.current && scope === resourceScope()) {
        const inaccessible =
          err instanceof Error && "status" in err && [401, 403, 404].includes(Number(err.status));
        if (inaccessible) mobileResourceCache.remove(key);
        const expired = Date.now() - stateRef.current.updatedAt > 5 * 60_000;
        setState({
          key,
          data: inaccessible || expired ? null : stateRef.current.data,
          loaded: true,
          updatedAt: stateRef.current.updatedAt,
          error: err instanceof Error ? err.message : t("Could not load settings"),
          refreshing: false,
        });
      }
    } finally {
      if (id === epoch.current && scope === resourceScope()) {
        setState((previous) =>
          previous.key === key ? { ...previous, refreshing: false } : previous,
        );
      }
    }
  }, [load, key, scope, cacheKey]);
  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        epoch.current++;
      };
    }, [reload]),
  );
  return {
    data: current.data,
    setData,
    loading: !current.loaded && (!current.error || current.refreshing),
    refreshing: current.refreshing,
    error: current.error,
    reload,
  };
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
