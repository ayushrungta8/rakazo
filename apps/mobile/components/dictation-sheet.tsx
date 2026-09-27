import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { loadDictationMode } from "../lib/dictation-preference";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { useVoiceRecognition } from "../lib/use-voice-recognition";
import { stopSpeech } from "../lib/voice";

export type DictationPhase = "idle" | "starting" | "listening" | "processing";
/** Mounted by the composer mic. Results become an editable draft, never a sent message. */
export function DictationSheet({
  onText,
  onClose,
  onPhaseChange,
  stopRequested = 0,
}: {
  onText: (text: string) => void;
  onClose: () => void;
  onPhaseChange?: (phase: DictationPhase) => void;
  stopRequested?: number;
}) {
  const recognition = useVoiceRecognition();
  const router = useRouter();
  const { t } = useI18n();
  const c = useMobileTokens();
  const [phase, setPhase] = useState<DictationPhase>("starting");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef<DictationPhase>("idle");
  const session = useRef(0);
  const callbacks = useRef({ onText, onClose, onPhaseChange });
  callbacks.current = { onText, onClose, onPhaseChange };
  const update = (next: DictationPhase) => {
    phaseRef.current = next;
    setPhase(next);
    callbacks.current.onPhaseChange?.(next);
  };
  const close = () => {
    session.current++;
    void recognition.cancel();
    callbacks.current.onClose();
  };
  const start = async () => {
    if (phaseRef.current !== "idle") return;
    const id = ++session.current;
    setError(null);
    setPartial("");
    update("starting");
    try {
      await stopSpeech();
      if (id !== session.current) return;
      const mode = await loadDictationMode();
      if (id !== session.current) return;
      await recognition.start({
        mode,
        onText: (text, final) => {
          if (id !== session.current) return;
          setPartial(text);
          if (final) {
            if (text.trim()) {
              callbacks.current.onText(text.trim());
              close();
            } else {
              update("idle");
              setError(t("No speech heard. Try again."));
              void recognition.cancel();
            }
          }
        },
        onError: (err) => {
          if (id !== session.current) return;
          update("idle");
          setError(err.message);
          void recognition.cancel();
        },
      });
      if (id !== session.current) return;
      if (AppState.currentState === "background") {
        close();
        return;
      }
      if ((phaseRef.current as DictationPhase) === "starting") update("listening");
    } catch (err) {
      if (id !== session.current) return;
      update("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const finish = async () => {
    if (phaseRef.current !== "listening") return;
    const id = session.current;
    update("processing");
    try {
      await recognition.finish();
    } catch (err) {
      if (id !== session.current) return;
      update("idle");
      setError(err instanceof Error ? err.message : String(err));
      void recognition.cancel();
    }
  };
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" && phaseRef.current !== "starting") close();
    });
    return () => {
      session.current++;
      sub.remove();
      void recognition.cancel();
    };
  }, []);
  useEffect(() => {
    if (phaseRef.current === "listening") void finish();
    else if (phaseRef.current === "idle") void start();
  }, [stopRequested]);
  return (
    <View style={{ gap: 8, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: error ? c.destructive : c.foreground,
            flex: 1,
            fontSize: 14,
            lineHeight: 20,
          }}
        >
          {error ??
            (phase === "starting"
              ? t("Starting microphone…")
              : phase === "listening"
                ? t("Listening… Tap the mic to stop.")
                : t("Turning speech into text…"))}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Cancel dictation")}
          onPress={close}
          style={{ minWidth: 48, minHeight: 48, justifyContent: "center", alignItems: "center" }}
        >
          <Text style={{ color: c.foreground, fontSize: 14 }}>{t("Cancel")}</Text>
        </Pressable>
      </View>
      {partial && !error ? (
        <Text style={{ color: c.foreground, fontSize: 15, lineHeight: 22 }}>{partial}</Text>
      ) : null}
      {error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Voice settings")}
          onPress={() => {
            close();
            router.push("/voice");
          }}
          style={{ minHeight: 48, justifyContent: "center" }}
        >
          <Text style={{ color: c.foreground, fontSize: 14 }}>{t("Voice settings")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
