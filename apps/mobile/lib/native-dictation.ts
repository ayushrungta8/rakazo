import { requestRecordingPermissionsAsync } from "expo-audio";
import { requireOptionalNativeModule } from "expo-modules-core";
import { dateLocaleForUi, t } from "./i18n";

type Subscription = { remove: () => void };
type Transcript = { sessionId: number; text: string; final: boolean };
type RecognitionError = { sessionId: number; code: number };
type RecognitionModule = {
  available: () => Promise<{ available: boolean; onDevice: boolean }>;
  start: (id: number, locale: string, onDevice: boolean) => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  addListener: ((event: "transcript", listener: (value: Transcript) => void) => Subscription) &
    ((event: "error", listener: (value: RecognitionError) => void) => Subscription);
};
const native = requireOptionalNativeModule<RecognitionModule>("RakazoVoice");
let generation = 0;
let cleanup: (() => void) | null = null;
let finishSession: (() => void) | null = null;
export const RECOGNITION_TIMEOUT_MS = 60_000;
export const RECOGNITION_FINISH_TIMEOUT_MS = 8_000;

function recognitionError(code: number, local: boolean): string {
  switch (code) {
    case 1:
    case 2:
      return t("Speech service could not connect. Check your connection and try again.");
    case 3:
      return t("Microphone is busy or unavailable. Close other recording apps and try again.");
    case 8:
      return t("Speech service is busy. Wait a moment and try again.");
    case 9:
      return t("Allow microphone access in Android Settings, then try again.");
    case 12:
      return local
        ? t(
            "The offline speech engine does not support this language. Use phone dictation instead.",
          )
        : t(
            "The phone’s speech service does not support this language. Check its language settings.",
          );
    case 13:
      return t(
        "The offline speech language is not downloaded. Download it in Android speech settings or use phone dictation.",
      );
    default:
      return t("Speech recognition failed ({code}).", { code });
  }
}

export async function recognitionStatus() {
  return native ? native.available() : { available: false, onDevice: false };
}
export async function cancelDictation(canceledGeneration = ++generation): Promise<void> {
  if (canceledGeneration !== generation) return;
  cleanup?.();
  cleanup = null;
  finishSession = null;
  await native?.cancel();
}
export async function finishDictation(): Promise<void> {
  finishSession?.();
  await native?.stop();
}
export async function listenNative({
  onText,
  onError,
  allowNetwork = false,
}: {
  onText: (text: string, final: boolean) => void;
  onError: (error: Error, retryable: boolean) => void;
  allowNetwork?: boolean;
}): Promise<void> {
  const id = ++generation;
  await cancelDictation(id);
  if (id !== generation) return;
  if (!native) throw new Error(t("Dictation needs the updated Android app."));
  const status = await native.available();
  if (id !== generation) return;
  if (allowNetwork && !status.available)
    throw new Error(
      t(
        "No phone speech service is available. Enable a speech recognition service in Android Settings.",
      ),
    );
  if (!status.onDevice && !allowNetwork)
    throw new Error(
      t(
        "On-device recognition is unavailable. Choose device speech to use the phone’s configured speech service.",
      ),
    );
  const permission = await requestRecordingPermissionsAsync();
  if (id !== generation) return;
  if (!permission.granted) throw new Error(t("Microphone permission is required."));
  const useOnDevice = !allowNetwork;
  let completed = false;
  let finishing = false;
  let partial = "";
  let timer: ReturnType<typeof setTimeout>;
  const current = () => id === generation && !completed;
  const complete = () => {
    completed = true;
    clearTimeout(timer);
  };
  const timeout = () => {
    if (!current()) return;
    complete();
    if (finishing && partial.trim()) onText(partial, true);
    else
      onError(
        new Error(
          t(
            "The speech service did not return a transcript. Try phone dictation or check Android speech settings.",
          ),
        ),
        false,
      );
  };
  timer = setTimeout(timeout, RECOGNITION_TIMEOUT_MS);
  finishSession = () => {
    if (!current()) return;
    finishing = true;
    clearTimeout(timer);
    timer = setTimeout(timeout, RECOGNITION_FINISH_TIMEOUT_MS);
  };
  const transcript = native.addListener("transcript", (value) => {
    if (value.sessionId !== id || !current()) return;
    partial = value.text;
    if (value.final) complete();
    onText(value.text, value.final);
  });
  const error = native.addListener("error", (value) => {
    if (value.sessionId !== id || !current()) return;
    const retryable = value.code === 6 || value.code === 7;
    complete();
    if (finishing && retryable && partial.trim()) {
      onText(partial, true);
      return;
    }
    onError(
      new Error(
        retryable ? t("No speech heard. Try again.") : recognitionError(value.code, useOnDevice),
      ),
      retryable,
    );
  });
  cleanup = () => {
    complete();
    transcript.remove();
    error.remove();
  };
  try {
    await native.start(id, dateLocaleForUi(), useOnDevice);
  } catch (error) {
    if (id === generation) await cancelDictation();
    throw error;
  }
}
