import type { IntegrationCatalogResult, IntegrationCatalogSurface } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { catalogImport, integrationPrefill, sourceAuth } from "./integration-catalog";

const result: IntegrationCatalogResult = {
  domain: "example.invalid",
  name: "Example",
  description: "Example service",
  pageUrl: null,
  surfaces: [],
};
const surface: IntegrationCatalogSurface = {
  kind: "openapi",
  slug: "api",
  source: "https://example.invalid/api.json",
  auth: { type: "header", headerName: "X-Key", note: "Use a scoped key" },
};
describe("integration catalog imports", () => {
  it("preserves header authentication and maps OpenAPI to the installed API kind", () => {
    const params = catalogImport(result, surface)!;
    expect(integrationPrefill(params)).toEqual({
      kind: "api",
      name: "Example",
      source: surface.source,
      authType: "header",
      headerName: "X-Key",
      note: "Use a scoped key",
    });
    expect(sourceAuth("header", " X-Key ")).toEqual({ type: "header", name: "X-Key" });
  });
  it("does not create imports for CLI or missing endpoints", () => {
    expect(catalogImport(result, { ...surface, kind: "cli" })).toBeNull();
    expect(catalogImport(result, { ...surface, source: null })).toBeNull();
  });
  it("rejects malformed route values, executable URLs, and injected header names", () => {
    expect(integrationPrefill({ kind: "mcp", source: "javascript:alert(1)" })).toBeNull();
    expect(integrationPrefill({ kind: ["mcp"], source: "https://example.invalid" })).toBeNull();
    expect(() => sourceAuth("header", "X-Key\r\nHost")).toThrow();
    expect(sourceAuth("none", "")).toEqual({ type: "none" });
  });
});
