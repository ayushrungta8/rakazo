import type { BotMcpServer, McpServer } from "@rakazo/contracts";
import { McpServerConfigInput } from "@rakazo/contracts";
import * as Linking from "expo-linking";
import { useCallback, useState } from "react";
import { Modal, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  confirmRemoval,
  SettingsButton,
  SettingsChoices,
  SettingsField,
  SettingsPage,
  SettingsText,
  SettingsToggle,
  useSettingsAction,
  useSettingsResource,
} from "../components/settings-controls";
import type { MobileBot, MobileMe } from "../lib/api";
import { currentApiBase, rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import {
  mcpCallback,
  mcpNavigation,
  mergeMcpAssignment,
  validateMcpCredentialEdit,
} from "../lib/mcp-authorization";

export default function McpServers() {
  const { t } = useI18n();
  const action = useSettingsAction();
  const resource = useSettingsResource(
    useCallback(async () => {
      const [servers, bots, assignments, me] = await Promise.all([
        rpc<McpServer[]>("mcp/servers/list"),
        rpc<MobileBot[]>("bots/list"),
        rpc<BotMcpServer[]>("mcp/assignments/all"),
        rpc<MobileMe>("me"),
      ]);
      return { servers, bots, assignments, me };
    }, []),
    "mcp-servers",
  );
  const [edit, setEdit] = useState<McpServer | "new" | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [transport, setTransport] = useState<McpServer["transport"]>("streamable_http");
  const [endpoint, setEndpoint] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [headers, setHeaders] = useState("");
  const [env, setEnv] = useState("");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [clearCredential, setClearCredential] = useState(false);
  const [assignment, setAssignment] = useState<{
    botId: string;
    serverId: string;
    all: boolean;
    tools: string;
  } | null>(null);
  const [oauth, setOauth] = useState<{
    url: string;
    sessionId: string;
    redirectUri: string;
  } | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  function open(server: McpServer | "new") {
    setEdit(server);
    setName(server === "new" ? "" : server.name);
    setSlug(server === "new" ? "" : server.slug);
    setDescription(server === "new" ? "" : server.description);
    setTransport(server === "new" ? "streamable_http" : server.transport);
    setEndpoint(server === "new" ? "" : (server.endpoint ?? ""));
    setCommand(server === "new" ? "" : (server.command ?? ""));
    setArgs(server === "new" ? "" : server.args.join("\n"));
    setEnabled(server === "new" || server.enabled);
    setSecret("");
    setHeaders("");
    setEnv("");
    setClearCredential(false);
  }
  const complete = (url: string) => {
    if (!oauth || action.busy) return;
    void action.run(async () => {
      const result = mcpCallback(url, oauth.redirectUri, oauth.sessionId);
      if (!result) throw new Error(t("Paste the authorization callback URL"));
      await rpc("mcp/oauth/complete", { sessionId: oauth.sessionId, ...result });
      setOauth(null);
      setCallbackUrl("");
      await resource.reload();
    });
  };
  const startOAuth = (serverId: string) =>
    action.run(async () => {
      const redirectUri = new URL("/mcp/oauth/callback", currentApiBase()).toString();
      const result = await rpc<{ status: string; sessionId?: string; authorizationUrl?: string }>(
        "mcp/oauth/begin",
        { serverId, redirectUri },
      );
      if (
        result.status === "authorization_required" &&
        result.authorizationUrl &&
        result.sessionId
      ) {
        const protocol = new URL(result.authorizationUrl).protocol;
        if (protocol !== "https:" && protocol !== "http:")
          throw new Error("Invalid authorization response");
        setOauth({ url: result.authorizationUrl, sessionId: result.sessionId, redirectUri });
      } else await resource.reload();
    });
  const pairs = (text: string): Record<string, string> =>
    Object.fromEntries(
      text
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const index = line.indexOf("=");
          if (index < 1) throw new Error(t("Use one NAME=value per line"));
          return [line.slice(0, index).trim(), line.slice(index + 1)];
        }),
    );
  return (
    <SettingsPage
      title={t("MCP servers")}
      loading={resource.loading}
      error={action.error ?? resource.error}
      retry={() => void resource.reload()}
    >
      {assignment ? (
        <>
          <SettingsToggle
            label={t("Allow all tools")}
            value={assignment.all}
            onChange={(all) => setAssignment({ ...assignment, all })}
            disabled={action.busy}
          />
          {!assignment.all ? (
            <SettingsField
              label={t("Allowed tools (one per line)")}
              value={assignment.tools}
              onChangeText={(tools) => setAssignment({ ...assignment, tools })}
              multiline
            />
          ) : null}
          <SettingsButton
            label={t("Save assignment")}
            primary
            disabled={action.busy}
            onPress={() =>
              void action.run(async () => {
                const current = await rpc<BotMcpServer[]>("mcp/assignments/list", {
                  botId: assignment.botId,
                });
                await rpc("mcp/assignments/replace", {
                  botId: assignment.botId,
                  assignments: mergeMcpAssignment(current, assignment.serverId, {
                    allowAllTools: assignment.all,
                    allowedTools: assignment.tools
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }),
                });
                setAssignment(null);
                await resource.reload();
              })
            }
          />
          <SettingsButton
            label={t("Unassign server")}
            disabled={action.busy}
            onPress={() =>
              void action.run(async () => {
                const current = await rpc<BotMcpServer[]>("mcp/assignments/list", {
                  botId: assignment.botId,
                });
                await rpc("mcp/assignments/replace", {
                  botId: assignment.botId,
                  assignments: mergeMcpAssignment(current, assignment.serverId, null),
                });
                setAssignment(null);
                await resource.reload();
              })
            }
          />
          <SettingsButton label={t("Cancel")} onPress={() => setAssignment(null)} />
        </>
      ) : edit ? (
        <>
          <SettingsField label={t("Name")} value={name} onChangeText={setName} maxLength={120} />
          <SettingsField
            label={t("Slug")}
            value={slug}
            onChangeText={setSlug}
            placeholder="my-server"
          />
          <SettingsField
            label={t("Description")}
            value={description}
            onChangeText={setDescription}
          />
          <SettingsChoices
            label={t("Transport")}
            value={transport}
            onChange={setTransport}
            choices={[
              { value: "streamable_http", label: "HTTP" },
              { value: "sse", label: "SSE" },
              ...(resource.data?.me.isDeploymentOwner
                ? [{ value: "stdio" as const, label: "stdio" }]
                : []),
            ]}
          />
          {transport === "stdio" ? (
            <>
              <SettingsField label={t("Command")} value={command} onChangeText={setCommand} />
              <SettingsField
                label={t("Arguments (one per line)")}
                value={args}
                onChangeText={setArgs}
                multiline
              />
              <SettingsField
                label={t("Environment (NAME=value)")}
                value={env}
                onChangeText={setEnv}
                multiline
                secureTextEntry
              />
            </>
          ) : (
            <>
              <SettingsField
                label={t("Server URL")}
                value={endpoint}
                onChangeText={setEndpoint}
                keyboardType="url"
              />
              <SettingsField
                label={t("Headers (NAME=value)")}
                value={headers}
                onChangeText={setHeaders}
                multiline
                secureTextEntry
              />
            </>
          )}
          <SettingsField
            label={t("Secret (optional)")}
            secureTextEntry
            value={secret}
            onChangeText={setSecret}
          />
          {edit !== "new" ? (
            <>
              <SettingsText>
                {t(
                  "Blank secret keeps its stored value. Headers and environment replace the full stored set.",
                )}
              </SettingsText>
              <SettingsToggle
                label={t("Clear stored credentials")}
                value={clearCredential}
                onChange={setClearCredential}
              />
            </>
          ) : null}
          <SettingsToggle label={t("Enabled")} value={enabled} onChange={setEnabled} />
          <SettingsButton
            label={t("Save")}
            primary
            disabled={action.busy || !name.trim()}
            onPress={() =>
              void action.run(async () => {
                validateMcpCredentialEdit(edit, transport, env, headers, clearCredential);
                const base = {
                  name: name.trim(),
                  slug:
                    slug.trim() ||
                    name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, "")
                      .slice(0, 64),
                  description,
                  enabled,
                  clearCredential,
                  ...(secret ? { secret } : {}),
                };
                const config = McpServerConfigInput.parse(
                  transport === "stdio"
                    ? {
                        ...base,
                        transport,
                        command,
                        args: args.split("\n").filter(Boolean),
                        ...(env ? { env: pairs(env) } : {}),
                      }
                    : {
                        ...base,
                        transport,
                        endpoint,
                        ...(headers ? { headers: pairs(headers) } : {}),
                      },
                );
                if (edit === "new") await rpc("mcp/servers/create", config);
                else await rpc("mcp/servers/update", { id: edit.id, config });
                setEdit(null);
                setSecret("");
                setHeaders("");
                setEnv("");
                await resource.reload();
              })
            }
          />
          <SettingsButton
            label={t("Cancel")}
            disabled={action.busy}
            onPress={() => {
              setEdit(null);
              setSecret("");
              setHeaders("");
              setEnv("");
            }}
          />
        </>
      ) : (
        <>
          <SettingsButton label={t("Add MCP server")} primary onPress={() => open("new")} />
          {resource.data?.servers.length === 0 ? (
            <SettingsText>{t("No direct MCP servers yet.")}</SettingsText>
          ) : null}
          {resource.data?.servers.map((server) => (
            <View key={server.id} style={{ gap: 8 }}>
              <SettingsText>{`${server.name} · ${server.transport} · ${server.oauthStatus}`}</SettingsText>
              {server.transport !== "stdio" || resource.data?.me.isDeploymentOwner ? (
                <SettingsButton
                  label={t("Edit {name}", { name: server.name })}
                  onPress={() => open(server)}
                />
              ) : null}
              {server.transport !== "stdio" ? (
                <>
                  <SettingsButton
                    label={t("Authorize {name}", { name: server.name })}
                    disabled={action.busy}
                    onPress={() => void startOAuth(server.id)}
                  />
                  {server.oauthStatus !== "none" ? (
                    <SettingsButton
                      label={t("Disconnect authorization")}
                      disabled={action.busy}
                      onPress={() =>
                        void action.run(async () => {
                          await rpc("mcp/oauth/disconnect", { serverId: server.id });
                          await resource.reload();
                        })
                      }
                    />
                  ) : null}
                </>
              ) : null}
              {resource.data?.bots
                .filter((b) => !b.archivedAt)
                .map((bot) => {
                  const assigned = resource.data?.assignments.find(
                    (a) => a.botId === bot.id && a.serverId === server.id,
                  );
                  return (
                    <SettingsButton
                      key={bot.id}
                      label={`${bot.name} · ${assigned ? t("Assigned") : t("Assign")}`}
                      onPress={() =>
                        setAssignment({
                          botId: bot.id,
                          serverId: server.id,
                          all: assigned?.allowAllTools ?? true,
                          tools: assigned?.allowedTools.join("\n") ?? "",
                        })
                      }
                    />
                  );
                })}
              {server.transport !== "stdio" || resource.data?.me.isDeploymentOwner ? (
                <SettingsButton
                  label={t("Delete {name}", { name: server.name })}
                  destructive
                  disabled={action.busy}
                  onPress={() =>
                    confirmRemoval(
                      t("Delete {name}?", { name: server.name }),
                      () =>
                        void action.run(async () => {
                          await rpc("mcp/servers/remove", { id: server.id });
                          await resource.reload();
                        }),
                    )
                  }
                />
              ) : null}
            </View>
          ))}
        </>
      )}
      <Modal visible={!!oauth} animationType="slide" onRequestClose={() => setOauth(null)}>
        {oauth ? (
          <View style={{ flex: 1 }}>
            <SettingsPage title={t("Authorize MCP")} error={action.error} modal>
              <SettingsButton
                label={t("Cancel authorization")}
                onPress={() => {
                  setOauth(null);
                  setCallbackUrl("");
                }}
              />
              <SettingsButton
                label={t("Open in browser")}
                onPress={() => void Linking.openURL(oauth.url)}
              />
              <SettingsField
                label={t("Callback URL (if using browser)")}
                value={callbackUrl}
                onChangeText={setCallbackUrl}
              />
              <SettingsButton
                label={t("Complete authorization")}
                disabled={action.busy || !callbackUrl}
                onPress={() => complete(callbackUrl)}
              />
              <View style={{ height: 500 }}>
                <WebView
                  source={{ uri: oauth.url }}
                  onShouldStartLoadWithRequest={(request) => {
                    const decision = mcpNavigation(request.url, oauth.redirectUri, oauth.url);
                    if (decision === "callback") complete(request.url);
                    return decision === "allow";
                  }}
                />
              </View>
              <SettingsButton
                label={t("Refresh connection")}
                onPress={() =>
                  void action.run(async () => {
                    await resource.reload();
                  })
                }
              />
            </SettingsPage>
          </View>
        ) : null}
      </Modal>
    </SettingsPage>
  );
}
