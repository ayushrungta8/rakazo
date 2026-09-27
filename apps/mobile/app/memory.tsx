import type { SpaceMemoryConfig } from "@rakazo/contracts";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
  SettingsToggle,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export default function Memory() {
  const router = useRouter();
  const { t } = useI18n();
  const action = useSettingsAction();
  const c = useMobileTokens();
  const [connecting, setConnecting] = useState(false);
  const resource = useSettingsResource(
    useCallback(() => rpc<SpaceMemoryConfig | null>("memory/providerConfig"), []),
  );
  const [provider, setProvider] = useState("supermemory");
  const [mode, setMode] = useState("cloud");
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [write, setWrite] = useState(false);
  const [scope, setScope] = useState<"isolated" | "shared">("isolated");
  useEffect(() => {
    const config = resource.data;
    if (config) {
      setProvider(config.provider);
      setScope(config.defaultMemoryScope);
      setMode(config.settings.mode ?? "cloud");
      setEndpoint(config.settings.endpoint ?? config.settings.baseUrl ?? "");
      setLabel(config.settings.brainLabel ?? "");
      setWrite(config.settings.allowWrites === "true");
    }
  }, [resource.data]);
  const accessControls = (
    <>
      <SettingsChoices
        label={t("Default access to memories")}
        value={scope}
        choices={[
          { value: "isolated", label: t("Each bot separately") },
          { value: "shared", label: t("Across the workspace") },
        ]}
        disabled={action.busy || resource.loading}
        onChange={(next) => {
          if (!resource.data) setScope(next);
          else
            void action.run(async () => {
              await rpc("memory/setDefaultScope", { defaultMemoryScope: next });
              setScope(next);
              await resource.reload();
            });
        }}
      />
      <SettingsText>
        {scope === "isolated"
          ? t("Bots search only memories saved for that bot.")
          : t("Bots can search shared workspace memories as well as their own.")}
      </SettingsText>
      {resource.data ? (
        <SettingsText>
          {t("Individual bots can override this default in their settings.")}
        </SettingsText>
      ) : null}
    </>
  );
  return (
    <SettingsPage
      title={t("Memory service")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      {!resource.loading && !resource.error ? (
        <View style={{ gap: 8 }}>
          <Text
            accessibilityRole="header"
            style={{ color: c.foreground, fontSize: 22, fontWeight: "600" }}
          >
            {resource.data
              ? t("Connected to {service}", {
                  service: resource.data.provider === "serenity" ? "Serenity" : "Supermemory",
                })
              : t("No memory service connected")}
          </Text>
          <SettingsText>
            {t(
              "An optional service that lets bots save and recall information across conversations.",
            )}
          </SettingsText>
        </View>
      ) : null}
      {!resource.loading && !resource.error && (resource.data || connecting) ? (
        <>
          {resource.data ? accessControls : null}
          {!resource.data ? (
            <>
              <SettingsChoices
                label={t("Choose a memory service")}
                value={provider}
                choices={[
                  { value: "supermemory", label: "Supermemory" },
                  { value: "serenity", label: "Serenity" },
                ]}
                onChange={(next) => {
                  setProvider(next);
                  setEndpoint("");
                  setKey("");
                }}
                disabled={action.busy}
              />
              {provider === "supermemory" ? (
                <SettingsChoices
                  label={t("Where is Supermemory running?")}
                  value={mode}
                  choices={[
                    { value: "cloud", label: t("Hosted service") },
                    { value: "local", label: t("Self-hosted server") },
                  ]}
                  onChange={setMode}
                  disabled={action.busy}
                />
              ) : null}
              <SettingsText>
                {provider === "serenity"
                  ? t("Enter the connection details from your Serenity administrator.")
                  : mode === "local"
                    ? t("Enter the server address and API key from your Supermemory administrator.")
                    : t(
                        "Enter the API key from your Supermemory account. Connecting lets bots send information to this service.",
                      )}
              </SettingsText>
              {provider === "serenity" || mode === "local" ? (
                <SettingsField
                  label={
                    provider === "serenity"
                      ? t("Serenity server address")
                      : t("Supermemory server address")
                  }
                  value={endpoint}
                  onChangeText={setEndpoint}
                  keyboardType="url"
                  editable={!action.busy}
                  placeholder={
                    provider === "serenity" ? "https://example.com/mcp" : "http://localhost:6767"
                  }
                />
              ) : null}
              <SettingsField
                label={
                  provider === "serenity" ? t("Serenity access token") : t("Supermemory API key")
                }
                value={key}
                onChangeText={setKey}
                secureTextEntry
                editable={!action.busy}
              />
              {provider === "serenity" ? (
                <>
                  <SettingsField
                    editable={!action.busy}
                    label={t("Memory collection name (optional)")}
                    value={label}
                    onChangeText={setLabel}
                  />
                  <SettingsToggle
                    label={t("Let bots save new memories")}
                    value={write}
                    onChange={setWrite}
                    disabled={action.busy}
                  />
                  <SettingsText>
                    {t(
                      "When off, bots can search existing memories but cannot save new ones to Serenity.",
                    )}
                  </SettingsText>
                </>
              ) : null}
              {accessControls}
              <SettingsButton
                label={action.busy ? t("Connecting…") : t("Connect memory service")}
                primary
                disabled={
                  action.busy ||
                  resource.loading ||
                  key.trim().length < 8 ||
                  ((provider === "serenity" || mode === "local") && !endpoint.trim())
                }
                onPress={() =>
                  void action.run(async () => {
                    await rpc("memory/connectProvider", {
                      provider,
                      defaultMemoryScope: scope,
                      settings:
                        provider === "serenity"
                          ? {
                              endpoint: endpoint.trim(),
                              brainLabel: label.trim(),
                              allowWrites: String(write),
                            }
                          : { mode, ...(mode === "local" ? { baseUrl: endpoint.trim() } : {}) },
                      credentials:
                        provider === "serenity" ? { token: key.trim() } : { apiKey: key.trim() },
                    });
                    setKey("");
                    setConnecting(false);
                    await resource.reload();
                  })
                }
              />
            </>
          ) : null}
        </>
      ) : null}
      {!resource.loading && !resource.error && !resource.data ? (
        <SettingsButton
          label={connecting ? t("Cancel setup") : t("Connect a memory service")}
          disabled={action.busy}
          primary={!connecting}
          onPress={() => {
            setConnecting(!connecting);
            setKey("");
          }}
        />
      ) : null}
      <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 20, gap: 8 }}>
        <SettingsButton
          label={t("Saved knowledge & skills")}
          onPress={() => router.push("/knowledge")}
        />
        <SettingsText>
          {t(
            "View and edit saved documents and bot instructions. Managed separately from the memory service.",
          )}
        </SettingsText>
      </View>
      {resource.data ? (
        <SettingsButton
          label={t("Disconnect memory service")}
          destructive
          disabled={action.busy || resource.loading}
          onPress={() =>
            Alert.alert(
              t("Disconnect memory service?"),
              t(
                "Bots will stop using this service. Memories stored in the service will not be deleted.",
              ),
              [
                { text: t("Cancel"), style: "cancel" },
                {
                  text: t("Disconnect"),
                  style: "destructive",
                  onPress: () =>
                    void action.run(async () => {
                      await rpc("memory/disconnectProvider");
                      setKey("");
                      setConnecting(false);
                      await resource.reload();
                    }),
                },
              ],
            )
          }
        />
      ) : null}
    </SettingsPage>
  );
}
