import type { BotMcpServer, McpServer } from "@rakazo/contracts";

export function mcpCallback(
  input: string,
  redirectUri: string,
  sessionId: string,
): { code: string; state: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const redirect = new URL(redirectUri);
  if (url.origin !== redirect.origin || url.pathname !== redirect.pathname) return null;
  if (url.searchParams.has("error"))
    throw new Error(url.searchParams.get("error_description") ?? "Authorization cancelled");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (
    !code ||
    state !== sessionId ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.getAll("code").length !== 1
  )
    throw new Error("Invalid authorization response");
  return { code, state };
}

export function mcpNavigation(
  input: string,
  redirectUri: string,
  authorizationUrl?: string,
): "callback" | "allow" | "block" {
  try {
    const url = new URL(input);
    const redirect = new URL(redirectUri);
    if (url.origin === redirect.origin && url.pathname === redirect.pathname) return "callback";
    const trustedHttp =
      url.protocol === "http:" &&
      authorizationUrl &&
      url.origin === new URL(authorizationUrl).origin;
    return url.protocol === "https:" || trustedHttp || input === "about:blank" ? "allow" : "block";
  } catch {
    return "block";
  }
}

export function mergeMcpAssignment(
  current: BotMcpServer[],
  serverId: string,
  replacement: { allowAllTools: boolean; allowedTools: string[] } | null,
) {
  const other = current
    .filter((row) => row.serverId !== serverId)
    .map(({ serverId, allowAllTools, allowedTools }) => ({
      serverId,
      allowAllTools,
      allowedTools,
    }));
  return replacement
    ? [
        ...other,
        {
          serverId,
          allowAllTools: replacement.allowAllTools,
          allowedTools: [
            ...new Set(replacement.allowedTools.map((name) => name.trim()).filter(Boolean)),
          ],
        },
      ]
    : other;
}

export function validateMcpCredentialEdit(
  existing: McpServer | "new",
  transport: McpServer["transport"],
  env: string,
  headers: string,
  clearing: boolean,
) {
  if (existing === "new" || clearing || existing.transport !== transport) return;
  if (transport === "stdio" && existing.envKeys.length && !env.trim())
    throw new Error(
      "Re-enter the complete environment to edit this server, or clear stored credentials",
    );
  if (transport !== "stdio" && existing.headerKeys.length && !headers.trim())
    throw new Error("Re-enter all stored headers to edit this server, or clear stored credentials");
}
