import type { BotMcpServer, McpServer } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  mcpCallback,
  mcpNavigation,
  mergeMcpAssignment,
  validateMcpCredentialEdit,
} from "./mcp-authorization";

const callback = "https://example.invalid/mcp/oauth/callback";
describe("native MCP authorization", () => {
  it("accepts only the exact callback and a single matching state/code", () => {
    expect(mcpCallback(`${callback}?code=one&state=session`, callback, "session")).toEqual({
      code: "one",
      state: "session",
    });
    expect(
      mcpCallback(
        "https://evil.invalid/mcp/oauth/callback?code=one&state=session",
        callback,
        "session",
      ),
    ).toBeNull();
    expect(() => mcpCallback(`${callback}?code=one&state=wrong`, callback, "session")).toThrow();
    expect(() =>
      mcpCallback(`${callback}?code=one&state=session&state=wrong`, callback, "session"),
    ).toThrow();
    expect(() => mcpCallback(`${callback}?error=denied`, callback, "session")).toThrow();
  });
  it("blocks malformed/custom protocol navigation and intercepts callbacks before loading", () => {
    expect(mcpNavigation("garbage", callback)).toBe("block");
    expect(mcpNavigation("javascript:alert(1)", callback)).toBe("block");
    expect(mcpNavigation("about:blank", callback)).toBe("allow");
    expect(mcpNavigation("https://provider.invalid/login", callback)).toBe("allow");
    expect(mcpNavigation(`${callback}?code=one&state=session`, callback)).toBe("callback");
    expect(
      mcpNavigation("http://local.example/login", callback, "http://local.example/authorize"),
    ).toBe("allow");
    expect(
      mcpNavigation("http://other.example/login", callback, "http://local.example/authorize"),
    ).toBe("block");
  });
  it("changes one assignment while preserving all other servers and strips duplicate tools", () => {
    const current = [
      { serverId: "other", allowAllTools: false, allowedTools: ["read"] },
      { serverId: "target", allowAllTools: true, allowedTools: [] },
    ] as BotMcpServer[];
    expect(
      mergeMcpAssignment(current, "target", {
        allowAllTools: false,
        allowedTools: ["write", " write ", ""],
      }),
    ).toEqual([
      { serverId: "other", allowAllTools: false, allowedTools: ["read"] },
      { serverId: "target", allowAllTools: false, allowedTools: ["write"] },
    ]);
    expect(mergeMcpAssignment(current, "target", null)).toEqual([
      { serverId: "other", allowAllTools: false, allowedTools: ["read"] },
    ]);
  });
  it("prevents a blank edit from silently erasing stored headers/environment", () => {
    const existing = {
      transport: "streamable_http",
      headerKeys: ["X-Key"],
      envKeys: [],
    } as unknown as McpServer;
    expect(() => validateMcpCredentialEdit(existing, "streamable_http", "", "", false)).toThrow();
    expect(() =>
      validateMcpCredentialEdit(existing, "streamable_http", "", "X-Key=fake", false),
    ).not.toThrow();
    expect(() =>
      validateMcpCredentialEdit(existing, "streamable_http", "", "", true),
    ).not.toThrow();
    expect(() =>
      validateMcpCredentialEdit(
        { ...existing, transport: "stdio", envKeys: ["KEY"] },
        "stdio",
        "",
        "",
        false,
      ),
    ).toThrow();
  });
});
