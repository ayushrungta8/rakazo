import { useEffect, useState } from "react";
import { AppState, Modal } from "react-native";
import { t } from "../lib/i18n";
import type { RecognitionMode } from "../lib/use-voice-recognition";
import { useVoiceRecognition } from "../lib/use-voice-recognition";
import {
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
} from "./settings-controls";

export function DictationSheet({
  onText,
  onClose,
}: {
  onText: (text: string) => void;
  onClose: () => void;
}) {
  const recognition = useVoiceRecognition();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RecognitionMode>("local");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        void recognition.cancel();
        setListening(false);
      }
    });
    return () => {
      sub.remove();
      void recognition.cancel();
    };
  }, []);
  const start = async () => {
    setError(null);
    setListening(true);
    try {
      await recognition.start({
        mode,
        onText: (value, final) => {
          setText(value);
          if (final) {
            setListening(false);
            void recognition.cancel();
          }
        },
        onError: (err) => {
          setError(err.message);
          setListening(false);
          void recognition.cancel();
        },
      });
    } catch (err) {
      setListening(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SettingsPage modal title={t("Dictation")} error={error}>
        <SettingsChoices
          label={t("Recognition")}
          value={mode}
          choices={[
            { value: "local", label: t("On device only") },
            { value: "device", label: t("Device speech") },
            { value: "provider", label: t("Voice provider") },
          ]}
          onChange={setMode}
          disabled={listening}
        />
        {mode === "device" ? (
          <SettingsText>
            {t("Your phone’s speech service may send audio to its provider.")}
          </SettingsText>
        ) : null}
        {mode === "provider" ? (
          <SettingsText>{t("Audio is sent to your configured voice provider.")}</SettingsText>
        ) : null}
        <SettingsField
          label={t("Transcript")}
          value={text}
          onChangeText={setText}
          multiline
          editable={!listening}
        />
        <SettingsButton
          label={listening ? t("Finish listening") : t("Start listening")}
          onPress={() =>
            listening
              ? void recognition.finish().catch((err: Error) => {
                  setListening(false);
                  setError(err.message);
                  void recognition.cancel();
                })
              : void start()
          }
        />
        <SettingsButton
          label={t("Use transcript")}
          disabled={!text.trim() || listening}
          primary
          onPress={() => {
            onText(text.trim());
            onClose();
          }}
        />
        <SettingsButton label={t("Cancel")} onPress={onClose} />
      </SettingsPage>
    </Modal>
  );
}
