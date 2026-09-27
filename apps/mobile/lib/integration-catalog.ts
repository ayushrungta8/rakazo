import type { IntegrationCatalogResult, IntegrationCatalogSurface } from "@rakazo/contracts";

export function catalogImport(
  result: IntegrationCatalogResult,
  surface: IntegrationCatalogSurface,
) {
  if (!surface.source || surface.kind === "cli") return null;
  return {
    kind: surface.kind === "openapi" ? "api" : surface.kind,
    name: result.name,
    source: surface.source,
    authType: surface.auth?.type ?? "none",
    headerName: surface.auth?.headerName ?? "x-api-key",
    note: surface.auth?.note ?? "",
  };
}

export function integrationPrefill(params: Record<string, string | string[] | undefined>) {
  const { kind, name, source, authType, headerName, note } = params;
  if ((kind !== "mcp" && kind !== "api" && kind !== "graphql") || typeof source !== "string")
    return null;
  try {
    const url = new URL(source);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
  } catch {
    return null;
  }
  const sourceKind: "mcp" | "api" | "graphql" = kind;
  const authentication: "none" | "bearer" | "header" =
    authType === "bearer" || authType === "header" ? authType : "none";
  return {
    kind: sourceKind,
    name: typeof name === "string" ? name : "",
    source,
    authType: authentication,
    headerName: typeof headerName === "string" ? headerName : "x-api-key",
    note: typeof note === "string" && note ? note : null,
  };
}

export function sourceAuth(type: "none" | "bearer" | "header", headerName: string) {
  if (type !== "header") return { type };
  const name = headerName.trim();
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name))
    throw new Error("Enter a valid authentication header name");
  return { type, name };
}
