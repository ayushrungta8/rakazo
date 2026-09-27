import { ensureAiDataConsent, readBoundedResponseBytes } from "@rakazo/core";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef } from "react";
import { promptAiConsent } from "./ai-consent";
import type { ApiRequestContext } from "./api";
import { captureApiRequestContext, rpc } from "./api";
import { t } from "./i18n";
import { cancelDictation, finishDictation, listenNative } from "./native-dictation";

export type RecognitionMode = "local" | "device" | "provider";
type Options = {
  mode: RecognitionMode;
  endpoint?: boolean;
  onText: (text: string, final: boolean) => void;
  onError: (error: Error, retryable: boolean) => void;
};
const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
/** Provider recordings stay in cache and are discarded on cancellation. */
export function useVoiceRecognition() {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const epoch = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const request = useRef<AbortController | null>(null);
  const contextRef = useRef<ApiRequestContext | null>(null);
  const finishPending = useRef<Promise<void> | null>(null);
  const recorded = useRef(false);
  const recordingMode = useRef(false);
  const finishing = useRef(false);
  const options = useRef<Options | null>(null);
  const lifecycle = useRef<Promise<unknown>>(Promise.resolve());
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = lifecycle.current.then(operation, operation);
    lifecycle.current = next.catch(() => undefined);
    return next;
  };
  const discard = () => {
    if (recorder.uri) {
      try {
        new File(recorder.uri).delete();
      } catch {
        /* Already removed. */
      }
    }
  };
  const restorePlaybackMode = async () => {
    if (!recordingMode.current) return;
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    });
    recordingMode.current = false;
  };
  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const cancel = async (canceledGeneration = ++epoch.current) => {
    clearTimer();
    request.current?.abort();
    request.current = null;
    try {
      await cancelDictation();
    } catch {
      /* The native recognizer may already be disposed. */
    }
    await serial(async () => {
      if (epoch.current !== canceledGeneration) return;
      if (!recorded.current) {
        await restorePlaybackMode();
        return;
      }
      recorded.current = false;
      const uri = recorder.uri;
      try {
        await recorder.stop();
      } catch {
        /* Already stopped. */
      } finally {
        try {
          await restorePlaybackMode();
        } catch {
          /* Audio session already disposed. */
        }
        if (uri) {
          try {
            new File(uri).delete();
          } catch {
            /* Already removed. */
          }
        }
      }
    });
    await finishPending.current;
    if (epoch.current === canceledGeneration) options.current = null;
  };
  useEffect(
    () => () => {
      void cancel();
    },
    [],
  );
  const finishImpl = async () => {
    if (!recorded.current) {
      await finishDictation();
      return;
    }
    if (finishing.current) return;
    finishing.current = true;
    const generation = epoch.current;
    const opts = options.current;
    let recordingUri: string | null = null;
    clearTimer();
    try {
      recordingUri = await serial(async () => {
        if (generation !== epoch.current || !recorded.current) return null;
        const uri = recorder.uri;
        recorded.current = false;
        recordingUri = uri;
        try {
          await recorder.stop();
        } finally {
          await restorePlaybackMode();
        }
        return uri;
      });
      if (generation !== epoch.current || !opts) return;
      if (!recordingUri) throw new Error(t("Recording is unavailable."));
      const file = new File(recordingUri);
      if (file.size > MAX_RECORDING_BYTES)
        throw new Error(t("Recording is too large. Try a shorter message."));
      const audioBase64 = await file.base64();
      if (generation !== epoch.current) return;
      const context = contextRef.current;
      if (!context) throw new Error(t("Recording session expired."));
      if (generation !== epoch.current) return;
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 70_000);
      try {
        const response = await abortable(
          fetch(`${context.apiBase}/api/voice/transcribe`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "rakazo://",
              ...context.headers,
            },
            body: JSON.stringify({ audioBase64, mimeType: "audio/mp4" }),
            signal: controller.signal,
          }),
          controller.signal,
        );
        // Transcription responses are short JSON, unlike synthesized audio.
        const bytes = await readBoundedResponseBytes(response, {
          maxBytes: 64 * 1024,
          tooLargeMessage: "Transcription response is too large.",
          read: (operation) => abortable(operation(), controller.signal),
        });
        const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
          text?: string;
          error?: string;
        };
        if (generation !== epoch.current) return;
        if (!response.ok) throw new Error(payload.error ?? t("Transcription failed."));
        opts.onText(String(payload.text ?? ""), true);
      } finally {
        clearTimeout(timeout);
        request.current = null;
      }
    } catch (error) {
      if (generation === epoch.current)
        opts?.onError(error instanceof Error ? error : new Error(String(error)), false);
    } finally {
      if (recordingUri) {
        try {
          new File(recordingUri).delete();
        } catch {
          /* Already removed. */
        }
      }
      finishing.current = false;
    }
  };
  const finish = () => {
    if (finishPending.current) return finishPending.current;
    const task = finishImpl();
    finishPending.current = task;
    const clear = () => {
      if (finishPending.current === task) finishPending.current = null;
    };
    void task.then(clear, clear);
    return task;
  };
  const start = async (opts: Options) => {
    const generation = ++epoch.current;
    await cancel(generation);
    if (generation !== epoch.current) return;
    options.current = opts;
    if (opts.mode !== "provider") {
      await listenNative({ ...opts, allowNetwork: opts.mode === "device" });
      return;
    }
    const requestContext = await captureApiRequestContext();
    if (generation !== epoch.current) return;
    contextRef.current = requestContext;
    const status = await rpc<{ transcribe: boolean }>("voice/status", {}, { requestContext });
    if (generation !== epoch.current) return;
    if (!status.transcribe)
      throw new Error(t("Your voice provider does not support transcription."));
    await ensureAiDataConsent({
      uses: ["voice"],
      status: () => rpc("aiConsent/status", { uses: ["voice"] }, { requestContext }),
      prompt: promptAiConsent,
      allow: (input) => rpc("aiConsent/allow", input, { requestContext }),
    });
    if (generation !== epoch.current) return;
    const permission = await requestRecordingPermissionsAsync();
    if (generation !== epoch.current) return;
    if (!permission.granted) throw new Error(t("Microphone permission is required."));
    await serial(async () => {
      if (generation !== epoch.current) return;
      recordingMode.current = true;
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      if (generation !== epoch.current) {
        await restorePlaybackMode();
        return;
      }
      try {
        await recorder.prepareToRecordAsync();
      } catch (error) {
        await restorePlaybackMode();
        throw error;
      }
      if (generation !== epoch.current) {
        discard();
        await restorePlaybackMode();
        return;
      }
      recorder.record();
      recorded.current = true;
    });
    if (generation !== epoch.current) return;
    const started = Date.now();
    let lastSpeech = started;
    let heardSpeech = false;
    timer.current = setInterval(() => {
      if (generation !== epoch.current) return;
      const state = recorder.getStatus();
      if ((state.metering ?? -160) > -38) {
        heardSpeech = true;
        lastSpeech = Date.now();
      }
      if (
        Date.now() - started > 60_000 ||
        (opts.endpoint && heardSpeech && Date.now() - lastSpeech > 1_500)
      )
        void finish();
    }, 200);
  };
  return { start, finish, cancel };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Transcription canceled."));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Transcription canceled."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
