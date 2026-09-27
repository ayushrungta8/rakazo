import type { ComputerStatus, TaughtSkill } from "@rakazo/contracts";
import { computerInputForDomKey, mapTeachPointer } from "@rakazo/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, PanResponder, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import {
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsText,
  useSettingsAction,
} from "../components/settings-controls";
import { currentApiBase, rpc } from "../lib/api";
import {
  COMPUTER_HEARTBEAT_MS,
  embeddableScreenUrl,
  readScreenUrl,
  retainScreenSource,
  SCREEN_URL_OPEN_ATTEMPTS,
} from "../lib/computer";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { createTeachInputQueue } from "../lib/teach-input";

export default function TeachComputer() {
  const { botId, skillId } = useLocalSearchParams<{ botId: string; skillId: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const c = useMobileTokens();
  const action = useSettingsAction();
  const [skill, setSkill] = useState<TaughtSkill | null>(null);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [screenLoaded, setScreenLoaded] = useState(false);
  const viewer = useRef<WebView>(null);
  const sourceUrl = useRef<string | null>(null);
  if (url) sourceUrl.current = sourceUrl.current ? retainScreenSource(sourceUrl.current, url) : url;
  const [error, setError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [synced, setSynced] = useState(false);
  const [text, setText] = useState("");
  const [button, setButton] = useState<"left" | "right">("left");
  const alive = useRef(true);
  const generation = useRef(0);
  const pointer = useRef<{ x: number; y: number; button: "left" | "right" } | null>(null);
  const enabledRef = useRef(false);
  const rect = useRef({ left: 0, top: 0, width: 1, height: 1 });
  const dimensions = useRef({ width: 1280, height: 800 });
  const inputQueue = useMemo(
    () =>
      createTeachInputQueue(
        (input) => rpc("computer/input", { botId, ...input }),
        async (err) => {
          enabledRef.current = false;
          const held = pointer.current;
          pointer.current = null;
          if (alive.current)
            setError(
              err instanceof Error
                ? err.message
                : t("Input failed. Reopen the recording to continue."),
            );
          // A failed response may follow an applied down action. Releasing a held button is safe compensation.
          if (held)
            await rpc("computer/input", {
              botId,
              kind: "pointer",
              payload: { ...held, type: "up" },
            }).catch(() => undefined);
        },
      ),
    [botId, t],
  );
  const releasePointer = useCallback(() => {
    if (!pointer.current) return;
    inputQueue.push({ kind: "pointer", payload: { ...pointer.current, type: "up" } });
    pointer.current = null;
  }, [inputQueue]);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setSynced(false);
    enabledRef.current = false;
    releasePointer();
    try {
      await inputQueue.drain().catch(() => undefined);
      if (!alive.current || generation.current !== id) return;
      inputQueue.reset();
      const [nextSkill, nextComputer, screen] = await Promise.all([
        rpc<TaughtSkill>("skills/get", { skillId }),
        rpc<ComputerStatus>("computer/status", { botId }),
        readScreenUrl(() => rpc<{ url: string | null }>("computer/screenUrl", { botId }), {
          attempts: SCREEN_URL_OPEN_ATTEMPTS,
        }),
      ]);
      if (!alive.current || generation.current !== id) return;
      if (nextSkill.botId !== botId) throw new Error(t("Recording belongs to another chat."));
      setSkill(nextSkill);
      setComputer(nextComputer);
      setUrl(embeddableScreenUrl(screen, currentApiBase()));
      dimensions.current = { width: nextComputer.screenWidth, height: nextComputer.screenHeight };
      setError(null);
      setSynced(true);
    } catch (err) {
      if (alive.current && generation.current === id)
        setError(err instanceof Error ? err.message : t("Could not open recording"));
    }
  }, [botId, skillId, t, releasePointer, inputQueue]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(
      () => undefined,
    );
    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      enabledRef.current = false;
      releasePointer();
      setForeground(active);
      if (active) void refresh();
      else {
        generation.current++;
        setSynced(false);
      }
    });
    return () => {
      alive.current = false;
      enabledRef.current = false;
      generation.current++;
      releasePointer();
      inputQueue.close();
      subscription.remove();
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => undefined,
      );
    };
  }, [refresh, releasePointer, inputQueue]);
  const ownsControl =
    computer?.state === "running" &&
    computer.controlHolder === "user" &&
    computer.controlBotId === botId;
  const enabled =
    foreground &&
    synced &&
    ownsControl &&
    skill?.status === "recording" &&
    !action.busy &&
    !error &&
    !!url &&
    screenLoaded;
  enabledRef.current = !!enabled;
  useEffect(() => {
    if (!foreground || !synced || !ownsControl || skill?.status !== "recording") return;
    let pinging = false;
    const ping = async () => {
      if (pinging) return;
      pinging = true;
      try {
        await rpc("computer/heartbeat", { botId });
      } catch (err) {
        enabledRef.current = false;
        releasePointer();
        if (alive.current)
          setError(
            err instanceof Error ? err.message : t("Control expired. Reopen the recording."),
          );
      } finally {
        pinging = false;
      }
    };
    void ping();
    const timer = setInterval(() => void ping(), COMPUTER_HEARTBEAT_MS);
    // Recording expiry is owned by the server. Refresh discovers expiry/control changes.
    const statusTimer = setInterval(() => {
      if (!pointer.current) void refresh();
    }, 30_000);
    return () => {
      clearInterval(timer);
      clearInterval(statusTimer);
    };
  }, [botId, foreground, synced, ownsControl, skill?.status, refresh, releasePointer, t]);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => enabledRef.current,
        onMoveShouldSetPanResponder: () => enabledRef.current,
        onPanResponderGrant: (event) => {
          if (!enabledRef.current) return;
          const point = mapTeachPointer(
            event.nativeEvent.locationX,
            event.nativeEvent.locationY,
            rect.current,
            dimensions.current,
          );
          pointer.current = { ...point, button };
          inputQueue.push({ kind: "pointer", payload: { ...pointer.current, type: "down" } });
        },
        onPanResponderMove: (event) => {
          if (!pointer.current || !enabledRef.current) return;
          const point = mapTeachPointer(
            event.nativeEvent.locationX,
            event.nativeEvent.locationY,
            rect.current,
            dimensions.current,
          );
          pointer.current = { ...pointer.current, ...point };
          inputQueue.push({ kind: "pointer", payload: { ...pointer.current, type: "move" } });
        },
        onPanResponderRelease: (event) => {
          if (pointer.current) {
            const point = mapTeachPointer(
              event.nativeEvent.locationX,
              event.nativeEvent.locationY,
              rect.current,
              dimensions.current,
            );
            pointer.current = { ...pointer.current, ...point };
            inputQueue.push({ kind: "pointer", payload: { ...pointer.current, type: "move" } });
          }
          releasePointer();
        },
        onPanResponderTerminate: releasePointer,
        onPanResponderTerminationRequest: () => false,
      }),
    [button, inputQueue, releasePointer],
  );
  async function stop() {
    enabledRef.current = false;
    releasePointer();
    await inputQueue.drain().catch(() => undefined);
    await rpc("skills/stop", { skillId }, { timeoutMs: 120_000 });
    router.replace({ pathname: "/teaching", params: { botId, skillId } });
  }
  function key(name: string) {
    if (!enabledRef.current) return;
    const input = computerInputForDomKey(name);
    inputQueue.push({
      kind: input.kind,
      payload: input.kind === "key" ? { key: input.key } : { text: input.text },
    });
  }
  return (
    <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: t("Recording task") }} />
      <View
        style={{ flex: 1, minHeight: 100, position: "relative" }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          rect.current = { left: 0, top: 0, width, height };
        }}
      >
        {url ? (
          <View pointerEvents="none" style={{ flex: 1 }}>
            <WebView
              ref={viewer}
              onLoad={() => setScreenLoaded(true)}
              onHttpError={() => {
                setScreenLoaded(false);
                setError(t("Computer view disconnected"));
                enabledRef.current = false;
                releasePointer();
              }}
              key={sourceUrl.current}
              source={{ uri: sourceUrl.current ?? url }}
              javaScriptEnabled
              domStorageEnabled
              mixedContentMode="always"
              setSupportMultipleWindows={false}
              scrollEnabled={false}
              onError={() => {
                setError(t("Computer view disconnected"));
                enabledRef.current = false;
                releasePointer();
              }}
              style={{ flex: 1 }}
            />
          </View>
        ) : (
          <View style={{ padding: 20 }}>
            <SettingsText>{t("Opening computer…")}</SettingsText>
          </View>
        )}
        <View
          accessibilityLabel={t("Computer teaching touch surface")}
          {...responder.panHandlers}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </View>
      <ScrollView
        style={{ maxHeight: 290, flexShrink: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 10 }}
      >
        {error || action.error ? <SettingsText>{error ?? action.error}</SettingsText> : null}
        {!enabled && skill && !error ? (
          <SettingsText>
            {skill.status !== "recording"
              ? t("Recording finished")
              : !ownsControl
                ? t("Computer control is unavailable. Return to taught tasks to recover.")
                : t("Refreshing recording…")}
          </SettingsText>
        ) : null}
        <SettingsChoices
          label={t("Mouse button")}
          value={button}
          choices={[
            { value: "left", label: t("Left") },
            { value: "right", label: t("Right") },
          ]}
          onChange={setButton}
          disabled={!enabled}
        />
        <SettingsField
          label={t("Text to type")}
          value={text}
          onChangeText={setText}
          editable={!!enabled}
        />
        <SettingsButton
          label={t("Type text")}
          disabled={!enabled || !text}
          onPress={() => {
            inputQueue.push({ kind: "clipboard", payload: { text } });
            setText("");
          }}
        />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {[
            "Enter",
            "Tab",
            "Backspace",
            "Escape",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          ].map((name) => (
            <SettingsButton key={name} label={name} disabled={!enabled} onPress={() => key(name)} />
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["up", "down"] as const).map((direction) => (
            <SettingsButton
              key={direction}
              label={direction === "up" ? t("Scroll up") : t("Scroll down")}
              disabled={!enabled}
              onPress={() => inputQueue.push({ kind: "scroll", payload: { direction, amount: 3 } })}
            />
          ))}
        </View>
        <SettingsButton
          label={t("Capture checkpoint")}
          disabled={!enabled}
          onPress={() =>
            void action.run(async () => {
              releasePointer();
              await inputQueue.drain();
              const next = await rpc<TaughtSkill>("skills/snapshot", { skillId });
              if (alive.current) setSkill(next);
            })
          }
        />
        <SettingsButton
          label={t("Stop teaching")}
          primary
          disabled={action.busy || skill?.status !== "recording"}
          onPress={() => void action.run(stop)}
        />
        <SettingsButton
          label={t("Refresh")}
          disabled={action.busy}
          onPress={() => {
            setScreenLoaded(false);
            viewer.current?.reload();
            void refresh();
          }}
        />
        <SettingsButton
          label={t("Taught tasks")}
          onPress={() => router.replace({ pathname: "/teaching", params: { botId, skillId } })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
