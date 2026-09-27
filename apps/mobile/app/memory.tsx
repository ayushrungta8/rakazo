import type { SpaceMemoryConfig } from "@rakazo/contracts";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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

export default function Memory() {
  const router = useRouter();
  const { t } = useI18n();
  const action = useSettingsAction();
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
  return (
    <SettingsPage
      title={t("Memory")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      <SettingsButton
        label={t("Memory documents & skills")}
        onPress={() => router.push("/knowledge")}
      />
      {resource.data ? (
        <>
          <SettingsText>{`${resource.data.provider} · ${resource.data.defaultMemoryScope}`}</SettingsText>
          <SettingsButton
            label={t("Disconnect memory provider")}
            disabled={action.busy}
            onPress={() =>
              void action.run(async () => {
                await rpc("memory/disconnectProvider");
                setKey("");
                await resource.reload();
              })
            }
          />
        </>
      ) : null}
      <SettingsChoices
        label={t("Default memory scope")}
        value={scope}
        choices={[
          { value: "isolated", label: t("Isolated") },
          { value: "shared", label: t("Shared") },
        ]}
        disabled={action.busy}
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
      {!resource.data ? (
        <>
          <SettingsChoices
            label={t("Provider")}
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
              label={t("Connection")}
              value={mode}
              choices={[
                { value: "cloud", label: t("Cloud") },
                { value: "local", label: t("Local") },
              ]}
              onChange={setMode}
            />
          ) : null}
          {provider === "serenity" || mode === "local" ? (
            <SettingsField
              label={provider === "serenity" ? t("MCP endpoint") : t("Base URL")}
              value={endpoint}
              onChangeText={setEndpoint}
              keyboardType="url"
              placeholder={
                provider === "serenity" ? "https://example.com/mcp" : "http://localhost:6767"
              }
            />
          ) : null}
          <SettingsField
            label={provider === "serenity" ? t("Bearer token") : t("API key")}
            value={key}
            onChangeText={setKey}
            secureTextEntry
            editable={!action.busy}
          />
          {provider === "serenity" ? (
            <>
              <SettingsField label={t("Brain label")} value={label} onChangeText={setLabel} />
              <SettingsToggle label={t("Allow writing")} value={write} onChange={setWrite} />
            </>
          ) : null}
          <SettingsButton
            label={t("Connect")}
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
                await resource.reload();
              })
            }
          />
        </>
      ) : null}
    </SettingsPage>
  );
}
