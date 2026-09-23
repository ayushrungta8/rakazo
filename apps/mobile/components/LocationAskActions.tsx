import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { requestDeviceLocation } from "../lib/device-location";
import { useI18n } from "../lib/i18n";

export function LocationAskActions({ onAnswer }: { onAnswer: (answer: string) => Promise<void> }) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const operation = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<"permission" | "locating" | "sending" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      return () => {
        operation.current?.abort();
      };
    }, []),
  );

  async function answer(share: boolean) {
    if (operation.current) {
      if (share || pending === "sending") return;
      operation.current.abort();
    }
    const controller = new AbortController();
    operation.current = controller;
    setError(null);
    setPending(share ? "permission" : "sending");
    try {
      const value = share
        ? await requestDeviceLocation(controller.signal, setPending)
        : "location-declined";
      if (controller.signal.aborted) return;
      setPending("sending");
      await onAnswer(value);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : t("Could not share location. Please try again."),
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(null);
      }
    }
  }

  return (
    <View style={{ marginTop: 12, gap: 10 }}>
      <Text style={{ color: tokens.mutedForeground, fontSize: 13, lineHeight: 19 }}>
        {t("Shared with this bot and its AI provider. Saved in this conversation.")}
      </Text>
      {[true, false].map((share) => (
        <Pressable
          key={String(share)}
          accessibilityRole="button"
          disabled={pending === "sending" || (share && pending !== null)}
          onPress={() => void answer(share)}
          style={{
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderWidth: 1,
            borderColor: tokens.border,
            backgroundColor: share ? tokens.muted : "transparent",
            opacity: pending ? 0.5 : 1,
          }}
        >
          <Text
            style={{ color: tokens.foreground, fontSize: 15, fontWeight: share ? "600" : "400" }}
          >
            {share
              ? pending === "permission"
                ? t("Checking permission…")
                : pending === "locating"
                  ? t("Finding location…")
                  : pending === "sending"
                    ? t("Sending…")
                    : t("Share current location")
              : t("Not now")}
          </Text>
        </Pressable>
      ))}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: tokens.destructive, fontSize: 13, lineHeight: 19 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
