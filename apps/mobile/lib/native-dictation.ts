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

export async function recognitionStatus() {
  return native ? native.available() : { available: false, onDevice: false };
}
export async function cancelDictation(canceledGeneration = ++generation): Promise<void> {
  if (canceledGeneration !== generation) return;
  cleanup?.();
  cleanup = null;
  await native?.cancel();
}
export async function finishDictation(): Promise<void> {
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
  if (!status.available && !status.onDevice)
    throw new Error(t("Speech recognition is unavailable on this device."));
  if (!status.onDevice && !allowNetwork)
    throw new Error(
      t(
        "On-device recognition is unavailable. Choose device speech to use the phone’s configured speech service.",
      ),
    );
  const permission = await requestRecordingPermissionsAsync();
  if (id !== generation) return;
  if (!permission.granted) throw new Error(t("Microphone permission is required."));
  const transcript = native.addListener("transcript", (value) => {
    if (value.sessionId === id && id === generation) onText(value.text, value.final);
  });
  const error = native.addListener("error", (value) => {
    if (value.sessionId !== id || id !== generation) return;
    const retryable = value.code === 6 || value.code === 7;
    onError(
      new Error(
        retryable
          ? t("No speech heard. Try again.")
          : t("Speech recognition failed ({code}).", { code: value.code }),
      ),
      retryable,
    );
  });
  cleanup = () => {
    transcript.remove();
    error.remove();
  };
  try {
    await native.start(id, dateLocaleForUi(), status.onDevice);
  } catch (error) {
    if (id === generation) await cancelDictation();
    throw error;
  }
}
