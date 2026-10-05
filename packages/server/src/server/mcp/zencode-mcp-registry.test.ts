import { describe, expect, it } from "vitest";
import {
  WORKSPACE_MCP_SERVERS,
  ZencodeMcpRegistry,
  getZencodeMcpRegistry,
} from "./zencode-mcp-registry.js";

describe("ZencodeMcpRegistry", () => {
  it("defines 5 standard workspace MCP servers", () => {
    expect(WORKSPACE_MCP_SERVERS).toHaveLength(5);
    const ids = WORKSPACE_MCP_SERVERS.map((s) => s.id);
    expect(ids).toEqual(["figma", "gdrive", "canva", "notion", "linear"]);

    for (const server of WORKSPACE_MCP_SERVERS) {
      expect(server.command).toBe("npx");
      expect(server.args[0]).toBe("-y");
      expect(server.args[1]).toMatch(/^@modelcontextprotocol\/server-/);
      expect(server.requiredEnvKeys.length).toBeGreaterThan(0);
      expect(server.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("retrieves MCP server statuses", async () => {
    const registry = getZencodeMcpRegistry();
    const statuses = await registry.getMcpStatus();

    expect(statuses).toHaveLength(5);
    const figma = statuses.find((s) => s.id === "figma");
    expect(figma).toBeDefined();
    expect(figma?.name).toContain("Figma");
    expect(figma?.capabilities).toContain("get_file");
  });

  it("returns executable config with injected environment", () => {
    const registry = new ZencodeMcpRegistry();
    const config = registry.getExecutableConfig("figma");

    expect(config).toBeDefined();
    expect(config?.command).toBe("npx");
    expect(config?.args).toEqual(["-y", "@modelcontextprotocol/server-figma"]);
    expect(config?.env).toBeDefined();

    // Unknown server returns null
    expect(registry.getExecutableConfig("nonexistent")).toBeNull();
  });
});
