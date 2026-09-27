import { narrateTool, speechFromBlocks } from "@rakazo/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal } from "react-native";
import type { CallMessage, CallSnapshot } from "../lib/call-input";
import { callInput, callRequiresScreen, pendingCallAsk } from "../lib/call-input";
import { t } from "../lib/i18n";
import type { RecognitionMode } from "../lib/use-voice-recognition";
import { useVoiceRecognition } from "../lib/use-voice-recognition";
import { speakText, stopSpeech } from "../lib/voice";
import { SettingsButton, SettingsChoices, SettingsPage, SettingsText } from "./settings-controls";

type Props = {
  botId: string;
  botName: string;
  snapshot: CallSnapshot | null;
  onSend: (text: string) => Promise<void>;
  onFollowUp: (text: string) => Promise<void>;
  onAnswer: (message: CallMessage, text: string) => Promise<void>;
  onClose: () => void;
};
export function VoiceCall(props: Props) {
  const recognition = useVoiceRecognition();
  const recognitionRef = useRef(recognition);
  recognitionRef.current = recognition;
  const [dispatchTick, setDispatchTick] = useState(0);
  const [phase, setPhase] = useState("paused");
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RecognitionMode>("local");
  const current = useRef(props);
  current.current = props;
  const epoch = useRef(0);
  const active = useRef(false);
  const processing = useRef(false);
  const submittedSnapshot = useRef<CallSnapshot | null>(null);
  const dispatching = useRef(false);
  const narrated = useRef(new Set<string>());
  const spoken = useRef(new Set<string>());
  const listenRef = useRef<() => Promise<void>>(async () => {});
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pause = useCallback(() => {
    active.current = false;
    epoch.current++;
    processing.current = false;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    void recognitionRef.current.cancel();
    void stopSpeech();
    setPhase("paused");
    setHeard("");
  }, []);
  useEffect(() => {
    for (const message of current.current.snapshot?.messages ?? []) spoken.current.add(message.id);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") pause();
    });
    return () => {
      sub.remove();
      pause();
    };
  }, [pause]);
  const handleTranscript = async (text: string) => {
    if (!active.current || processing.current || !text.trim()) return;
    const generation = epoch.current;
    processing.current = true;
    await recognitionRef.current.cancel();
    if (!active.current || generation !== epoch.current) return;
    const input = callInput(current.current.snapshot, text.trim());
    if (input.kind === "screen") {
      pause();
      setError(t("Hang up and answer this request on screen."));
      return;
    }
    for (const message of current.current.snapshot?.messages ?? []) spoken.current.add(message.id);
    submittedSnapshot.current = current.current.snapshot;
    dispatching.current = true;
    setHeard(text);
    setPhase("thinking");
    try {
      if (input.kind === "answer") await current.current.onAnswer(input.message, input.text);
      else if (input.kind === "followUp") await current.current.onFollowUp(input.text);
      else await current.current.onSend(input.text);
    } catch (err) {
      if (generation === epoch.current && active.current) {
        setError(err instanceof Error ? err.message : String(err));
        processing.current = false;
        await listenRef.current();
      }
    } finally {
      dispatching.current = false;
      if (generation === epoch.current && active.current) setDispatchTick((tick) => tick + 1);
    }
  };
  const listen = async () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    if (!active.current) return;
    if (callRequiresScreen(current.current.snapshot)) {
      pause();
      setError(t("Hang up and answer this request on screen."));
      return;
    }
    const generation = epoch.current;
    processing.current = false;
    setPhase("listening");
    setHeard("");
    setCaption("");
    try {
      await recognitionRef.current.start({
        mode,
        endpoint: true,
        onText: (text, final) => {
          if (generation !== epoch.current || !active.current) return;
          if (callRequiresScreen(current.current.snapshot)) {
            pause();
            return;
          }
          setHeard(text);
          if (final) {
            if (text.trim()) void handleTranscript(text);
            else
              retryTimer.current = setTimeout(() => {
                if (generation === epoch.current && active.current && !processing.current)
                  void listenRef.current();
              }, 500);
          }
        },
        onError: (err, retryable) => {
          if (generation !== epoch.current || !active.current) return;
          if (retryable)
            retryTimer.current = setTimeout(() => {
              if (generation === epoch.current && active.current && !processing.current)
                void listenRef.current();
            }, 800);
          else {
            pause();
            setError(err.message);
          }
        },
      });
    } catch (err) {
      if (generation === epoch.current) {
        pause();
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };
  listenRef.current = listen;
  useEffect(() => {
    if (!active.current) return;
    if (callRequiresScreen(props.snapshot)) {
      pause();
      setError(t("Hang up and answer this request on screen."));
      return;
    }
    if (
      !processing.current ||
      phase !== "thinking" ||
      dispatching.current ||
      props.snapshot === submittedSnapshot.current
    )
      return;
    const snapshot = props.snapshot;
    const running = snapshot?.run && ["running", "queued", "leased"].includes(snapshot.run.status);
    if (running) {
      const phrases: string[] = [];
      for (const item of (snapshot?.messages ?? []).filter(
        (message) => message.runId === snapshot?.run?.id,
      ))
        for (const block of item.blocks) {
          if (block.kind !== "progress" && block.kind !== "subagent") continue;
          const detail = block.kind === "subagent" ? block.status : block.text;
          const key = `${item.id}:${block.kind}:${detail}`;
          if (narrated.current.has(key)) continue;
          narrated.current.add(key);
          const phrase =
            block.kind === "subagent"
              ? narrateTool("run_subagent")
              : (narrateTool(block.text.split(/\s+/)[0] ?? "") ??
                (block.text.length <= 80 ? block.text.trim() : null));
          if (phrase) phrases.push(phrase);
        }
      if (phrases.length) {
        const generation = epoch.current;
        setCaption(phrases.join(". "));
        setPhase("speaking");
        void speakText(phrases.join(". "), { botId: props.botId })
          .then(() => {
            if (generation === epoch.current && active.current) setPhase("thinking");
          })
          .catch((err: unknown) => {
            if (generation === epoch.current) {
              pause();
              setError(err instanceof Error ? err.message : String(err));
            }
          });
      }
      return;
    }
    const message = [...(snapshot?.messages ?? [])]
      .reverse()
      .find((item) => item.role === "bot" && !spoken.current.has(item.id));
    if (!message) {
      processing.current = false;
      void listenRef.current();
      return;
    }
    spoken.current.add(message.id);
    const baseText = speechFromBlocks(message.blocks);
    const text =
      pendingCallAsk(snapshot)?.id === message.id
        ? `${baseText}. ${t("Say yes or no, or answer in a sentence.")}`
        : baseText;
    if (!text) {
      processing.current = false;
      void listenRef.current();
      return;
    }
    const generation = epoch.current;
    setCaption(text);
    setPhase("speaking");
    void speakText(text, { botId: props.botId })
      .then((played) => {
        if (generation !== epoch.current || !active.current) return;
        if (!played) {
          pause();
          setError(t("Choose a voice provider or enable device voice in Account."));
          return;
        }
        void listenRef.current();
      })
      .catch((err: unknown) => {
        if (generation === epoch.current) {
          pause();
          setError(err instanceof Error ? err.message : String(err));
        }
      });
  }, [props.snapshot, props.botId, phase, pause, dispatchTick]);
  const resume = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    setError(null);
    epoch.current++;
    active.current = true;
    const generation = epoch.current;
    void stopSpeech()
      .then(async () => {
        if (generation !== epoch.current || !active.current) return;
        const snapshot = current.current.snapshot;
        const ask = pendingCallAsk(snapshot);
        if (ask && !callRequiresScreen(snapshot)) {
          const text = `${speechFromBlocks(ask.blocks)}. ${t("Say yes or no, or answer in a sentence.")}`;
          setCaption(text);
          setPhase("speaking");
          spoken.current.add(ask.id);
          const played = await speakText(text, { botId: current.current.botId });
          if (generation !== epoch.current || !active.current) return;
          if (!played) {
            pause();
            setError(t("Choose a voice provider or enable device voice in Account."));
            return;
          }
        }
        await listenRef.current();
      })
      .catch((err: unknown) => {
        if (generation === epoch.current) {
          pause();
          setError(err instanceof Error ? err.message : String(err));
        }
      });
  };
  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        pause();
        props.onClose();
      }}
    >
      <SettingsPage modal title={`${t("Call")} · ${props.botName}`} error={error}>
        <SettingsText>
          {phase === "listening"
            ? t("Listening…")
            : phase === "thinking"
              ? t("Working…")
              : phase === "speaking"
                ? t("Speaking…")
                : t("Call paused")}
        </SettingsText>
        <SettingsText>
          {phase === "listening"
            ? heard || t("Say something. Silence sends it.")
            : caption || heard}
        </SettingsText>
        {phase === "paused" ? (
          <>
            <SettingsChoices
              label={t("Recognition")}
              value={mode}
              onChange={setMode}
              choices={[
                { value: "local", label: t("On device only") },
                { value: "device", label: t("Device speech") },
                { value: "provider", label: t("Voice provider") },
              ]}
            />
            {mode === "device" ? (
              <SettingsText>
                {t("Your phone’s speech service may send audio to its provider.")}
              </SettingsText>
            ) : null}
            {mode === "provider" ? (
              <SettingsText>{t("Audio is sent to your configured voice provider.")}</SettingsText>
            ) : null}
            <SettingsButton label={t("Start listening")} primary onPress={resume} />
          </>
        ) : (
          <>
            {phase === "listening" ? (
              <SettingsButton
                label={t("Finish speaking")}
                onPress={() =>
                  void recognitionRef.current.finish().catch((err: Error) => {
                    pause();
                    setError(err.message);
                  })
                }
              />
            ) : null}
            <SettingsButton label={t("Interrupt")} onPress={resume} />
            <SettingsButton label={t("Pause call")} onPress={pause} />
          </>
        )}
        <SettingsButton
          label={t("Hang up")}
          destructive
          onPress={() => {
            pause();
            props.onClose();
          }}
        />
      </SettingsPage>
    </Modal>
  );
}
