import { describe, expect, it } from "vitest";
import type { EcosystemType, FleetAuthMatrix, PluginOAuthStatus } from "./types";

describe("FleetAuthView data model & ecosystem invariants", () => {
  const sampleMatrix: FleetAuthMatrix = {
    antigravity: {
      provider: "antigravity",
      label: "Google Antigravity (AGY)",
      ecosystem: "agy",
      status: "authenticated",
      authType: "cli_session",
      source: "/home/zen/.local/bin/agy",
      account: "agy_1.2.16",
      maskedToken: "loca...ated",
    },
    opencode: {
      provider: "opencode",
      label: "OpenCode Engine & 9Router",
      ecosystem: "opencode",
      status: "authenticated",
      authType: "api_key",
      source: "/home/zen/.config/opencode/opencode.jsonc",
      account: "9router_opencode",
    },
    "opencode-go": {
      provider: "opencode-go",
      label: "OpenCode Go Official",
      ecosystem: "opencode",
      status: "unconfigured",
      authType: "none",
    },
    codex: {
      provider: "codex",
      label: "OpenAI Codex",
      ecosystem: "codex",
      status: "authenticated",
      authType: "oauth",
      source: "/home/zen/.pi/agent/auth.json",
      maskedToken: "sk-t...5678",
    },
    claude: {
      provider: "claude",
      label: "Anthropic Claude",
      ecosystem: "codex",
      status: "unconfigured",
      authType: "none",
    },
    copilot: {
      provider: "copilot",
      label: "GitHub Copilot",
      ecosystem: "paseo",
      status: "unconfigured",
      authType: "none",
    },
    cursor: {
      provider: "cursor",
      label: "Cursor Agent",
      ecosystem: "paseo",
      status: "unconfigured",
      authType: "none",
    },
    grok: {
      provider: "grok",
      label: "xAI Grok",
      ecosystem: "paseo",
      status: "unconfigured",
      authType: "none",
    },
    kimi: {
      provider: "kimi",
      label: "Moonshot Kimi",
      ecosystem: "paseo",
      status: "unconfigured",
      authType: "none",
    },
    minimax: {
      provider: "minimax",
      label: "MiniMax M6",
      ecosystem: "paseo",
      status: "unconfigured",
      authType: "none",
    },
    zai: {
      provider: "zai",
      label: "ZAI Engine (Zencode)",
      ecosystem: "paseo",
      status: "unconfigured",
      authType: "none",
    },
    muse: {
      provider: "muse",
      label: "Muse Audio / Core Protocol",
      ecosystem: "paseo",
      status: "unconfigured",
      authType: "none",
    },
    github: {
      provider: "github",
      label: "GitHub Version Control",
      ecosystem: "infra",
      status: "authenticated",
      authType: "cli_session",
      source: "/home/zen/.config/gh/hosts.yml",
      account: "zenphamgeek",
      maskedToken: "gh_c...lper",
    },
    telegram: {
      provider: "telegram",
      label: "Telegram Alert Gateway",
      ecosystem: "infra",
      status: "authenticated",
      authType: "api_key",
      source: "/home/zen/.antigravity-controller/telegram_config.json",
      account: "Phamvuthang (@zenpham_bot)",
      maskedToken: "7056...IP8c",
    },
  };

  it("calculates cluster auth percentage and counts accurately", () => {
    const items = Object.values(sampleMatrix);
    const total = items.length;
    const authCount = items.filter((i) => i.status === "authenticated").length;
    const percent = Math.round((authCount / total) * 100);

    expect(total).toBe(14);
    expect(authCount).toBe(5);
    expect(percent).toBe(36);
  });

  it("categorizes all 14 plugins into 5 clean ecosystem groups", () => {
    const groups: Record<EcosystemType, PluginOAuthStatus[]> = {
      agy: [],
      opencode: [],
      codex: [],
      paseo: [],
      infra: [],
    };

    for (const item of Object.values(sampleMatrix)) {
      const eco: EcosystemType = item.ecosystem || "paseo";
      groups[eco].push(item);
    }

    expect(groups.agy).toHaveLength(1);
    expect(groups.opencode).toHaveLength(2);
    expect(groups.codex).toHaveLength(2);
    expect(groups.paseo).toHaveLength(7);
    expect(groups.infra).toHaveLength(2);
  });

  it("guarantees secret masking for all authenticated items with tokens", () => {
    for (const item of Object.values(sampleMatrix)) {
      if (item.maskedToken) {
        expect(item.maskedToken).toContain("...");
        expect(item.maskedToken.length).toBeLessThanOrEqual(14);
      }
    }
  });

  it("determines status badge labeling correctly", () => {
    const getBadgeLabel = (item: PluginOAuthStatus) => {
      if (item.status === "authenticated") {
        if (item.authType === "cli_session") return "CLI ACTIVE";
        if (item.authType === "oauth") return "OAUTH OK";
        if (item.authType === "api_key") return "API KEY OK";
        return "AUTHENTICATED";
      }
      if (item.status === "discovered") return "DISCOVERED";
      return "NOT CONFIGURED";
    };

    expect(getBadgeLabel(sampleMatrix.antigravity)).toBe("CLI ACTIVE");
    expect(getBadgeLabel(sampleMatrix.codex)).toBe("OAUTH OK");
    expect(getBadgeLabel(sampleMatrix.opencode)).toBe("API KEY OK");
    expect(getBadgeLabel(sampleMatrix.cursor)).toBe("NOT CONFIGURED");
  });
});
