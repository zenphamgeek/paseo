import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZencodeOAuthManager } from "./zencode-oauth-manager.js";

describe("ZencodeOAuthManager", () => {
  it("auto-discovers local credentials from opencode, agy, telegram, and github", async () => {
    const manager = new ZencodeOAuthManager();
    const result = await manager.autoConfigureAll();

    expect(result.totalProviders).toBeGreaterThanOrEqual(10);
    expect(result.configuredCount).toBeGreaterThan(0);

    // Opencode should be harvested from ~/.config/opencode/opencode.jsonc or ~/.local/share/opencode/auth.json
    const opencodeItem = result.items.find((i) => i.provider === "opencode");
    expect(opencodeItem?.found).toBe(true);
    expect(opencodeItem?.ecosystem).toBe("opencode");

    // Antigravity should be harvested from ~/.local/bin/agy
    const agyItem = result.items.find((i) => i.provider === "antigravity");
    expect(agyItem?.found).toBe(true);
    expect(agyItem?.ecosystem).toBe("agy");

    // Telegram should be harvested from ~/.antigravity-controller/telegram_config.json
    const telegramItem = result.items.find((i) => i.provider === "telegram");
    expect(telegramItem?.found).toBe(true);
    expect(telegramItem?.ecosystem).toBe("infra");
  });

  it("returns status with masked tokens and prevents secret leaks", async () => {
    const manager = new ZencodeOAuthManager();
    const status = await manager.getStatus();

    expect(status.antigravity).toBeDefined();
    expect(status.opencode).toBeDefined();
    expect(status.codex).toBeDefined();
    expect(status.copilot).toBeDefined();

    if (status.opencode.maskedToken) {
      expect(status.opencode.maskedToken).toContain("...");
      expect(status.opencode.maskedToken.length).toBeLessThan(15);
    }
  });

  it("supports manual credential configuration and bidirectional sync", () => {
    const manager = new ZencodeOAuthManager();
    const res = manager.setManualCredentials("codex", {
      token: "sk-test-manual-token-12345678",
      authType: "api_key",
      account: "test_user",
    });

    expect(res.success).toBe(true);
    expect(manager.getRawCredential("codex")).toBe("sk-test-manual-token-12345678");

    // Verify it synced to ~/.pi/agent/auth.json
    const piAuthPath = join(homedir(), ".pi", "agent", "auth.json");
    if (existsSync(piAuthPath)) {
      const parsed = JSON.parse(readFileSync(piAuthPath, "utf-8"));
      expect(parsed["openai-codex"]).toBeDefined();
      expect(parsed["openai-codex"].access).toBe("sk-test-manual-token-12345678");
    }
  });
});
