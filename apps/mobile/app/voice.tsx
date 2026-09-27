import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { loadDeviceVoiceEnabled, saveDeviceVoiceEnabled } from "../lib/device-voice";
import { loadDictationMode, saveDictationMode } from "../lib/dictation-preference";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import type { RecognitionMode } from "../lib/use-voice-recognition";
import { speakText } from "../lib/voice";

type VoiceCatalogEntry = {
  id: string;
  name: string;
  description: string;
  transcribe: boolean;
};
type VoiceCredential = {
  id: string;
  provider: string;
  voiceId: string;
};
type VoiceStatus = {
  configured: boolean;
  transcribe: boolean;
  ready: boolean;
  provider: string | null;
  voiceId: string;
};
type VoiceInfo = { id: string; label: string; description?: string };

export default function VoiceSettings() {
  const styles = useThemedStyles(createVoiceStyles);
  const { t } = useI18n();
  const [dictationMode, setDictationMode] = useState<RecognitionMode | null>(null);
  const inputRevision = useRef(0);
  const inputSaveInFlight = useRef(false);
  const [catalog, setCatalog] = useState<VoiceCatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<VoiceCredential[]>([]);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [deviceVoice, setDeviceVoice] = useState(false);
  const [deviceVoiceReady, setDeviceVoiceReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<
    "connect" | "disconnect" | "voice" | "test" | "device-voice" | "dictation" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deviceVoiceRevision = useRef(0);
  const deviceVoiceSaveInFlight = useRef(false);

  const load = useCallback(async (nextProvider?: string) => {
    const [nextCatalog, nextCredentials, nextStatus] = await Promise.all([
      rpc<VoiceCatalogEntry[]>("voice/catalog"),
      rpc<VoiceCredential[]>("voice/credentials"),
      rpc<VoiceStatus>("voice/status"),
    ]);
    const selected = nextProvider || nextStatus.provider || nextCatalog[0]?.id || "";
    setCatalog(nextCatalog);
    setCredentials(nextCredentials);
    setStatus(nextStatus);
    setProvider(selected);
    const cred = nextCredentials.find((entry) => entry.provider === selected);
    setVoiceId(cred?.voiceId ?? "");
    if (cred) {
      setVoices(await rpc<VoiceInfo[]>("voice/voices", { provider: selected }));
    } else {
      setVoices([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      const inputLoadRevision = ++inputRevision.current;
      void loadDictationMode()
        .then((mode) => {
          if (inputRevision.current === inputLoadRevision && !inputSaveInFlight.current)
            setDictationMode(mode);
        })
        .catch((err: unknown) => {
          if (inputRevision.current === inputLoadRevision && !inputSaveInFlight.current) {
            setDictationMode(null);
            setError(err instanceof Error ? err.message : t("Could not load voice settings"));
          }
        });
      const revision = ++deviceVoiceRevision.current;
      void loadDeviceVoiceEnabled()
        .then((value) => {
          if (deviceVoiceSaveInFlight.current) return;
          if (deviceVoiceRevision.current !== revision) return;
          setDeviceVoice(value);
          setDeviceVoiceReady(true);
        })
        .catch((err: unknown) => {
          if (deviceVoiceSaveInFlight.current) return;
          if (deviceVoiceRevision.current !== revision) return;
          setDeviceVoiceReady(true);
          setError(err instanceof Error ? err.message : t("Could not load voice settings"));
        });
      void load()
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : t("Could not load voice settings")),
        )
        .finally(() => setLoading(false));
      return () => {
        inputRevision.current++;
      };
    }, [load, t]),
  );

  async function chooseDictationMode(mode: RecognitionMode) {
    if (pending !== null || inputSaveInFlight.current) return;
    inputSaveInFlight.current = true;
    inputRevision.current++;
    setPending("dictation");
    setError(null);
    try {
      await saveDictationMode(mode);
      setDictationMode(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not save that preference"));
    } finally {
      inputSaveInFlight.current = false;
      inputRevision.current++;
      setPending(null);
    }
  }

  async function toggleDeviceVoice() {
    if (pending !== null || !deviceVoiceReady) return;
    const next = !deviceVoice;
    deviceVoiceSaveInFlight.current = true;
    deviceVoiceRevision.current++;
    setDeviceVoice(next);
    setPending("device-voice");
    setError(null);
    try {
      await saveDeviceVoiceEnabled(next);
    } catch {
      setDeviceVoice(!next);
      setError(t("Could not save that preference"));
    } finally {
      deviceVoiceSaveInFlight.current = false;
      deviceVoiceRevision.current++;
      setPending(null);
    }
  }

  const selected = catalog.find((entry) => entry.id === provider);
  const credential = credentials.find((entry) => entry.provider === provider);

  async function connect() {
    if (!selected || apiKey.trim().length < 8) return;
    setPending("connect");
    setError(null);
    try {
      await rpc("voice/connect", {
        provider: selected.id,
        apiKey: apiKey.trim(),
        voiceId: voiceId || undefined,
      });
      setApiKey("");
      await load(selected.id);
      setNotice(t("Connected {name}.", { name: selected.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not connect"));
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    if (!credential) return;
    setPending("disconnect");
    setError(null);
    setNotice(null);
    try {
      await rpc("voice/disconnect", { provider: credential.provider });
      setApiKey("");
      await load(credential.provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not disconnect"));
    } finally {
      setPending(null);
    }
  }

  async function chooseVoice(nextVoiceId: string) {
    setVoiceId(nextVoiceId);
    setPending("voice");
    try {
      await rpc("voice/setVoice", { voiceId: nextVoiceId, provider: selected?.id });
      await load(selected?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not save that voice"));
    } finally {
      setPending(null);
    }
  }

  async function testVoice() {
    setPending("test");
    setError(null);
    try {
      const ready = await speakText(t("Hi, this is how I'll sound when I read replies out loud."));
      if (!ready) {
        throw new Error(t("Connect a voice provider first."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not play a sample"));
    } finally {
      setPending(null);
    }
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator color={native.secondaryLabel} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t("Voice input")}
        </Text>
        {(
          [
            {
              mode: "device",
              title: t("Phone dictation"),
              detail: t("Uses your phone’s speech service. It may send audio to its provider."),
            },
            {
              mode: "local",
              title: t("Offline dictation"),
              detail: t(
                "Keeps audio on your phone. Requires an installed offline speech language.",
              ),
            },
            {
              mode: "provider",
              title: t("Voice provider"),
              detail: t("Sends audio to your configured voice provider for transcription."),
            },
          ] as const
        ).map((choice) => (
          <Pressable
            key={choice.mode}
            accessibilityRole="radio"
            accessibilityLabel={choice.title}
            accessibilityState={{
              checked: dictationMode === choice.mode,
              disabled: pending !== null,
            }}
            disabled={pending !== null}
            onPress={() => void chooseDictationMode(choice.mode)}
            style={[
              styles.card,
              dictationMode === choice.mode && styles.cardActive,
              pending !== null && styles.disabled,
            ]}
          >
            <View style={styles.methodTitle}>
              <Text style={styles.cardTitle}>{choice.title}</Text>
              {dictationMode === choice.mode ? <Text style={styles.check}>✓</Text> : null}
            </View>
            <Text style={styles.cardMeta}>{choice.detail}</Text>
          </Pressable>
        ))}
        {dictationMode === "provider" && !status?.transcribe ? (
          <Text style={styles.cardMeta}>
            {t("Connect a voice provider that supports transcription below.")}
          </Text>
        ) : null}
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t("Read replies aloud")}
        </Text>
        <Pressable
          disabled={pending !== null || !deviceVoiceReady}
          onPress={() => void toggleDeviceVoice()}
          style={[
            styles.card,
            deviceVoice && styles.cardActive,
            (pending !== null || !deviceVoiceReady) && styles.disabled,
          ]}
        >
          <Text style={styles.cardTitle}>{t("This device")}</Text>
          <Text style={styles.cardMeta}>
            {deviceVoice
              ? t("On · Free, works offline")
              : t("Your phone's built-in voice. Free, no account needed")}
          </Text>
        </Pressable>
        {catalog.map((entry) => {
          const connected = credentials.some((cred) => cred.provider === entry.id);
          return (
            <Pressable
              key={entry.id}
              disabled={pending !== null}
              onPress={() => {
                setProvider(entry.id);
                setPending("voice");
                void load(entry.id)
                  .catch((err: unknown) =>
                    setError(
                      err instanceof Error ? err.message : t("Could not load voice settings"),
                    ),
                  )
                  .finally(() => setPending(null));
              }}
              style={[
                styles.card,
                provider === entry.id && styles.cardActive,
                pending !== null && styles.disabled,
              ]}
            >
              <Text style={styles.cardTitle}>{entry.name}</Text>
              <Text style={styles.cardMeta}>
                {connected
                  ? t("Connected")
                  : entry.transcribe
                    ? t("Speak + transcribe")
                    : t("Speak only")}
              </Text>
            </Pressable>
          );
        })}
        {selected ? (
          <>
            <TextInput
              accessibilityLabel={t("API key")}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              importantForAutofill="no"
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={credential ? t("Paste a replacement key") : t("Paste your API key")}
              placeholderTextColor={native.tertiaryLabel}
              secureTextEntry
              style={styles.input}
              textContentType="none"
            />
            <Pressable
              disabled={pending !== null || apiKey.trim().length < 8}
              onPress={() => void connect()}
              style={[
                styles.button,
                (pending !== null || apiKey.trim().length < 8) && styles.disabled,
              ]}
            >
              <Text style={styles.buttonLabel}>{credential ? t("Replace key") : t("Connect")}</Text>
            </Pressable>
            {credential ? (
              <Pressable
                disabled={pending !== null}
                onPress={() => void disconnect()}
                style={[styles.secondary, pending !== null && styles.disabled]}
              >
                <Text style={styles.secondaryLabel}>
                  {pending === "disconnect" ? t("Disconnecting…") : t("Disconnect")}
                </Text>
              </Pressable>
            ) : null}
            {voices.length ? (
              <View style={styles.voices}>
                {voices.map((voice) => (
                  <Pressable
                    key={voice.id}
                    disabled={pending !== null}
                    onPress={() => void chooseVoice(voice.id)}
                    style={[styles.voiceRow, pending !== null && styles.disabled]}
                  >
                    <Text style={styles.voiceLabel}>{voice.label}</Text>
                    {voiceId === voice.id ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        {deviceVoice || status?.ready ? (
          <Pressable
            disabled={pending !== null}
            onPress={() => void testVoice()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryLabel}>{t("Hear a sample")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createVoiceStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { padding: 20, gap: 10 },
    error: { color: tokens.destructive, marginBottom: 8 },
    notice: { color: tokens.success, marginBottom: 8 },
    sectionTitle: {
      color: native.label,
      fontSize: 20,
      fontWeight: "600",
      marginTop: 12,
      marginBottom: 4,
    },
    methodTitle: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    card: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tokens.border,
      padding: 14,
      backgroundColor: tokens.card,
    },
    cardActive: { borderColor: tokens.ring, backgroundColor: tokens.muted },
    cardTitle: { color: native.label, fontSize: 16 },
    cardMeta: { color: native.tertiaryLabel, marginTop: 4, fontSize: 12 },
    input: {
      marginTop: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tokens.border,
      color: native.label,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    button: {
      marginTop: 8,
      backgroundColor: tokens.primary,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
    },
    disabled: { opacity: 0.4 },
    buttonLabel: { color: tokens.primaryForeground, fontWeight: "600" },
    voices: { marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: tokens.border },
    voiceRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: tokens.border,
    },
    voiceLabel: { color: native.label },
    check: { color: tokens.success },
    secondary: { marginTop: 16, alignItems: "center" },
    secondaryLabel: { color: native.secondaryLabel, fontSize: 15 },
  });
}
