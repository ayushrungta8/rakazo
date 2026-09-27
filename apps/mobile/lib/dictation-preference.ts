import * as SecureStore from "expo-secure-store";
import { t } from "./i18n";
import type { RecognitionMode } from "./use-voice-recognition";

export const DICTATION_MODE_KEY = "rakazo.dictation-mode";
const isMode = (value: unknown): value is RecognitionMode =>
  value === "device" || value === "local" || value === "provider";

/** A missing preference uses phone dictation; unreadable/invalid storage never opts into uploads. */
export async function loadDictationMode(): Promise<RecognitionMode> {
  const value = await SecureStore.getItemAsync(DICTATION_MODE_KEY);
  if (value === null) return "device";
  if (!isMode(value))
    throw new Error(t("Could not read the dictation method. Choose it again in Voice settings."));
  return value;
}
export async function saveDictationMode(mode: RecognitionMode): Promise<void> {
  if (!isMode(mode)) throw new Error(t("Invalid dictation method."));
  await SecureStore.setItemAsync(DICTATION_MODE_KEY, mode);
}
