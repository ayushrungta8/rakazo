import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Text, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import type { RecognitionMode } from "../lib/use-voice-recognition";
import { useVoiceRecognition } from "../lib/use-voice-recognition";
import {
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
} from "./settings-controls";

type Phase = "idle" | "starting" | "listening" | "processing";
export function DictationSheet({
  onText,
  onClose,
}: {
  onText: (text: string) => void;
  onClose: () => void;
}) {
  const recognition = useVoiceRecognition();
  const router = useRouter();
  const { t } = useI18n();
  const c = useMobileTokens();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const session = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RecognitionMode>("device");
  const [methodsOpen, setMethodsOpen] = useState(false);
  const busy = phase !== "idle";
  const updatePhase = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const cancel = () => {
    session.current++;
    void recognition.cancel();
    updatePhase("idle");
  };
  const close = () => {
    cancel();
    onClose();
  };
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" && phaseRef.current !== "starting") {
        session.current++;
        void recognition.cancel();
        updatePhase("idle");
      }
    });
    return () => {
      session.current++;
      sub.remove();
      void recognition.cancel();
    };
  }, []);
  const start = async () => {
    if (phaseRef.current !== "idle") return;
    const id = ++session.current;
    const prefix = text.trim();
    setError(null);
    updatePhase("starting");
    try {
      await recognition.start({
        mode,
        onText: (value, final) => {
          if (id !== session.current) return;
          setText([prefix, value.trim()].filter(Boolean).join(" "));
          if (final) {
            updatePhase("idle");
            void recognition.cancel();
          }
        },
        onError: (err) => {
          if (id !== session.current) return;
          setError(err.message);
          updatePhase("idle");
          void recognition.cancel();
        },
      });
      if (id !== session.current) return;
      if (AppState.currentState === "background") {
        cancel();
        return;
      }
      if ((phaseRef.current as Phase) === "starting") updatePhase("listening");
    } catch (err) {
      if (id !== session.current) return;
      updatePhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const finish = async () => {
    if (phaseRef.current !== "listening") return;
    const id = session.current;
    updatePhase("processing");
    try {
      await recognition.finish();
    } catch (err) {
      if (id !== session.current) return;
      updatePhase("idle");
      setError(err instanceof Error ? err.message : String(err));
      void recognition.cancel();
    }
  };
  const method =
    mode === "local"
      ? t("Offline only")
      : mode === "device"
        ? t("Phone speech service")
        : t("Connected voice service");
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SettingsPage modal title={t("Type with your voice")} error={error}>
        <SettingsText>
          {t("Speak, review the text, then add it to your message. Nothing is sent automatically.")}
        </SettingsText>
        <View style={{ alignItems: "center", gap: 12, paddingVertical: 24 }}>
          <Ionicons
            name={busy ? "mic" : "mic-outline"}
            size={36}
            color={c.foreground}
            accessible={false}
          />
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: c.foreground, fontSize: 20, fontWeight: "600" }}
          >
            {phase === "starting"
              ? t("Starting microphone…")
              : phase === "listening"
                ? t("Listening…")
                : phase === "processing"
                  ? t("Turning speech into text…")
                  : text
                    ? t("Review your text")
                    : t("Ready to listen")}
          </Text>
        </View>
        {text || busy ? (
          <SettingsField
            label={t("Your message")}
            value={text}
            onChangeText={setText}
            multiline
            editable={!busy}
            placeholder={t("Your words will appear here")}
          />
        ) : null}
        <SettingsButton
          label={
            phase === "listening"
              ? t("Stop & review")
              : phase === "starting"
                ? t("Starting microphone…")
                : phase === "processing"
                  ? t("Turning speech into text…")
                  : text
                    ? t("Dictate more")
                    : t("Start dictation")
          }
          primary={!text || busy}
          disabled={phase === "starting" || phase === "processing"}
          onPress={() => (phase === "listening" ? void finish() : void start())}
        />
        {text && !busy ? (
          <SettingsButton
            label={t("Insert into message")}
            primary
            onPress={() => {
              onText(text.trim());
              close();
            }}
            disabled={!text.trim()}
          />
        ) : null}
        {!busy ? (
          <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 16, gap: 12 }}>
            <SettingsButton
              label={methodsOpen ? t("Hide speech methods") : t("Change speech method")}
              onPress={() => setMethodsOpen(!methodsOpen)}
            />
            {methodsOpen ? (
              <SettingsChoices
                label={t("Speech method")}
                value={mode}
                choices={[
                  { value: "device", label: t("Phone speech service") },
                  { value: "local", label: t("Offline only") },
                  { value: "provider", label: t("Connected voice service") },
                ]}
                onChange={(next) => {
                  setMode(next);
                  setError(null);
                }}
              />
            ) : (
              <Text style={{ color: c.mutedForeground, fontSize: 14 }}>{method}</Text>
            )}
            <SettingsText>
              {mode === "device"
                ? t("Uses Android’s speech service. It may send audio to its provider.")
                : mode === "local"
                  ? t(
                      "Audio stays on this phone. Requires an installed offline speech model for your language.",
                    )
                  : t(
                      "Sends audio to the voice service connected in Settings. A transcription service must be connected first.",
                    )}
            </SettingsText>
            {mode === "provider" ? (
              <SettingsButton
                label={t("Set up voice service")}
                onPress={() => {
                  close();
                  router.push("/voice");
                }}
              />
            ) : null}
          </View>
        ) : null}
        <SettingsButton label={t("Cancel dictation")} onPress={close} />
      </SettingsPage>
    </Modal>
  );
}
