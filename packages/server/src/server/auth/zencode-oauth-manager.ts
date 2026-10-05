import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Logger } from "pino";

const execFileAsync = promisify(execFile);

export type ProviderAuthType = "oauth" | "api_key" | "cli_session" | "none";
export type ProviderAuthStatus = "authenticated" | "discovered" | "unconfigured";

export interface ProviderAuthInfo {
  provider: string;
  label: string;
  status: ProviderAuthStatus;
  authType: ProviderAuthType;
  source?: string;
  account?: string;
  maskedToken?: string;
  configuredAt?: number;
}

export interface AutoConfigHarvestItem {
  provider: string;
  found: boolean;
  source?: string;
  authType: ProviderAuthType;
  account?: string;
  error?: string;
}

export interface AutoConfigResult {
  timestamp: number;
  totalProviders: number;
  configuredCount: number;
  items: AutoConfigHarvestItem[];
}

export class ZencodeOAuthManager {
  private readonly configDir: string;
  private readonly storePath: string;
  private readonly memoryCredentials = new Map<
    string,
    { token: string; authType: ProviderAuthType; account?: string; source: string }
  >();
  private readonly logger?: Logger;

  constructor(options?: { configDir?: string; logger?: Logger }) {
    this.configDir = options?.configDir || join(homedir(), ".zencode", "auth");
    this.storePath = join(this.configDir, "credentials.json");
    this.logger = options?.logger;
    this.loadPersisted();
  }

  private loadPersisted(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const raw = readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<
        string,
        { token: string; authType: ProviderAuthType; account?: string; source: string }
      >;
      for (const [provider, cred] of Object.entries(parsed)) {
        if (cred?.token) {
          this.memoryCredentials.set(provider, cred);
        }
      }
    } catch (err) {
      this.logger?.warn({ err }, "Failed to load persisted Zencode credentials");
    }
  }

  private persist(): void {
    try {
      const obj: Record<string, unknown> = {};
      for (const [provider, cred] of this.memoryCredentials.entries()) {
        obj[provider] = cred;
      }
      writeFileSync(this.storePath, JSON.stringify(obj, null, 2), { mode: 0o600 });
    } catch (err) {
      this.logger?.warn({ err }, "Failed to persist Zencode credentials");
    }
  }

  private maskSecret(secret?: string): string | undefined {
    if (!secret || secret.length < 8) return undefined;
    return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
  }

  // Harvester: Opencode Ecosystem
  private harvestOpencode(): AutoConfigHarvestItem {
    const home = homedir();
    // Check ~/.config/opencode/opencode.jsonc
    const configPath = join(home, ".config", "opencode", "opencode.jsonc");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const match = raw.match(/apiKey["']?\s*:\s*["']([^"']+)["']/);
        if (match && match[1]) {
          const key = match[1];
          this.memoryCredentials.set("opencode", {
            token: key,
            authType: "api_key",
            account: "9router_opencode",
            source: configPath,
          });
          return {
            provider: "opencode",
            found: true,
            source: configPath,
            authType: "api_key",
            account: "9router_opencode",
          };
        }
      } catch (err) {
        this.logger?.debug({ err }, "Error harvesting opencode.jsonc");
      }
    }

    // Check ~/.local/share/opencode/auth.json
    const authJsonPath = join(home, ".local", "share", "opencode", "auth.json");
    if (existsSync(authJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(authJsonPath, "utf-8")) as Record<
          string,
          { key?: string }
        >;
        for (const [service, data] of Object.entries(parsed)) {
          if (data?.key) {
            this.memoryCredentials.set("opencode", {
              token: data.key,
              authType: "api_key",
              account: service,
              source: authJsonPath,
            });
            return {
              provider: "opencode",
              found: true,
              source: authJsonPath,
              authType: "api_key",
              account: service,
            };
          }
        }
      } catch (err) {
        this.logger?.debug({ err }, "Error harvesting opencode auth.json");
      }
    }

    if (process.env.OPENCODE_API_KEY) {
      this.memoryCredentials.set("opencode", {
        token: process.env.OPENCODE_API_KEY,
        authType: "api_key",
        source: "env:OPENCODE_API_KEY",
      });
      return {
        provider: "opencode",
        found: true,
        source: "env:OPENCODE_API_KEY",
        authType: "api_key",
      };
    }

    return { provider: "opencode", found: false, authType: "none" };
  }

  // Harvester: Antigravity (AGY) Ecosystem
  private async harvestAntigravity(): Promise<AutoConfigHarvestItem> {
    const agyBin = join(homedir(), ".local", "bin", "agy");
    const hasAgy = existsSync(agyBin);

    if (hasAgy) {
      try {
        const { stdout } = await execFileAsync(agyBin, ["--version"]);
        const ver = stdout.trim();
        this.memoryCredentials.set("antigravity", {
          token: "local_cli_authenticated",
          authType: "cli_session",
          account: `agy_${ver}`,
          source: agyBin,
        });
        return {
          provider: "antigravity",
          found: true,
          source: agyBin,
          authType: "cli_session",
          account: `agy_${ver}`,
        };
      } catch {
        // Fallback check
      }
    }

    if (process.env.GEMINI_API_KEY || process.env.ANTIGRAVITY_TOKEN) {
      const token = (process.env.GEMINI_API_KEY || process.env.ANTIGRAVITY_TOKEN) as string;
      this.memoryCredentials.set("antigravity", {
        token,
        authType: "api_key",
        source: "env:GEMINI_API_KEY",
      });
      return {
        provider: "antigravity",
        found: true,
        source: "env:GEMINI_API_KEY",
        authType: "api_key",
      };
    }

    return { provider: "antigravity", found: false, authType: "none" };
  }

  // Harvester: Codex Ecosystem (OpenAI / Pi / OMP)
  private harvestCodex(): AutoConfigHarvestItem {
    const home = homedir();

    // Check ~/.pi/agent/auth.json
    const piAuthPath = join(home, ".pi", "agent", "auth.json");
    if (existsSync(piAuthPath)) {
      try {
        const parsed = JSON.parse(readFileSync(piAuthPath, "utf-8")) as Record<
          string,
          { access?: string; key?: string }
        >;
        const codex = parsed["openai-codex"] || parsed.codex || parsed.openai;
        const token = codex?.access || codex?.key;
        if (token) {
          const authType = codex?.access ? "oauth" : "api_key";
          this.memoryCredentials.set("codex", {
            token,
            authType,
            source: piAuthPath,
          });
          return { provider: "codex", found: true, source: piAuthPath, authType };
        }
      } catch {
        // Continue
      }
    }

    if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) {
      const token = (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) as string;
      this.memoryCredentials.set("codex", {
        token,
        authType: "api_key",
        source: "env:OPENAI_API_KEY",
      });
      return { provider: "codex", found: true, source: "env:OPENAI_API_KEY", authType: "api_key" };
    }

    return { provider: "codex", found: false, authType: "none" };
  }

  // Harvester: Claude (Anthropic) Ecosystem
  private harvestClaude(): AutoConfigHarvestItem {
    if (process.env.ANTHROPIC_API_KEY) {
      this.memoryCredentials.set("claude", {
        token: process.env.ANTHROPIC_API_KEY,
        authType: "api_key",
        source: "env:ANTHROPIC_API_KEY",
      });
      return {
        provider: "claude",
        found: true,
        source: "env:ANTHROPIC_API_KEY",
        authType: "api_key",
      };
    }

    const home = homedir();
    const piAuthPath = join(home, ".pi", "agent", "auth.json");
    if (existsSync(piAuthPath)) {
      try {
        const parsed = JSON.parse(readFileSync(piAuthPath, "utf-8")) as Record<
          string,
          { access?: string; key?: string }
        >;
        const anthropic = parsed.anthropic || parsed.claude;
        const token = anthropic?.access || anthropic?.key;
        if (token) {
          const authType = anthropic?.access ? "oauth" : "api_key";
          this.memoryCredentials.set("claude", { token, authType, source: piAuthPath });
          return { provider: "claude", found: true, source: piAuthPath, authType };
        }
      } catch {
        // Continue
      }
    }

    return { provider: "claude", found: false, authType: "none" };
  }

  // Harvester: GitHub CLI OAuth
  private harvestGitHub(): AutoConfigHarvestItem {
    const ghHostPath = join(homedir(), ".config", "gh", "hosts.yml");
    if (existsSync(ghHostPath)) {
      try {
        const raw = readFileSync(ghHostPath, "utf-8");
        const userMatch = raw.match(/user:\s*([^\s]+)/);
        const tokenMatch = raw.match(/oauth_token:\s*([^\s]+)/);
        const user = userMatch?.[1] || "zenphamgeek";
        if (tokenMatch?.[1]) {
          this.memoryCredentials.set("github", {
            token: tokenMatch[1],
            authType: "oauth",
            account: user,
            source: ghHostPath,
          });
          return {
            provider: "github",
            found: true,
            source: ghHostPath,
            authType: "oauth",
            account: user,
          };
        }
        // User is configured with gh CLI credentials helper
        this.memoryCredentials.set("github", {
          token: "gh_cli_credential_helper",
          authType: "cli_session",
          account: user,
          source: ghHostPath,
        });
        return {
          provider: "github",
          found: true,
          source: ghHostPath,
          authType: "cli_session",
          account: user,
        };
      } catch {
        // Continue
      }
    }

    if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
      const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) as string;
      this.memoryCredentials.set("github", {
        token,
        authType: "oauth",
        source: "env:GITHUB_TOKEN",
      });
      return { provider: "github", found: true, source: "env:GITHUB_TOKEN", authType: "oauth" };
    }

    return { provider: "github", found: false, authType: "none" };
  }

  // Harvester: Telegram Alerter
  private harvestTelegram(): AutoConfigHarvestItem {
    const configPath = join(homedir(), ".antigravity-controller", "telegram_config.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw) as { token?: string; botName?: string };
        if (parsed.token) {
          this.memoryCredentials.set("telegram", {
            token: parsed.token,
            authType: "api_key",
            account: parsed.botName || "Phamvuthang (@zenpham_bot)",
            source: configPath,
          });
          return {
            provider: "telegram",
            found: true,
            source: configPath,
            authType: "api_key",
            account: parsed.botName,
          };
        }
      } catch {
        // Continue
      }
    }

    return { provider: "telegram", found: false, authType: "none" };
  }

  public async autoConfigureAll(): Promise<AutoConfigResult> {
    const items: AutoConfigHarvestItem[] = [];

    items.push(this.harvestOpencode());
    items.push(await this.harvestAntigravity());
    items.push(this.harvestCodex());
    items.push(this.harvestClaude());
    items.push(this.harvestGitHub());
    items.push(this.harvestTelegram());

    this.persist();

    const configuredCount = items.filter((i) => i.found).length;

    return {
      timestamp: Date.now(),
      totalProviders: items.length,
      configuredCount,
      items,
    };
  }

  public async getStatus(): Promise<Record<string, ProviderAuthInfo>> {
    // If empty, auto-harvest once
    if (this.memoryCredentials.size === 0) {
      await this.autoConfigureAll();
    }

    const providers: Array<{ id: string; label: string }> = [
      { id: "antigravity", label: "Google Antigravity (AGY)" },
      { id: "opencode", label: "OpenCode Engine & 9Router" },
      { id: "codex", label: "OpenAI Codex" },
      { id: "claude", label: "Anthropic Claude" },
      { id: "github", label: "GitHub Version Control" },
      { id: "telegram", label: "Telegram Alert Gateway" },
    ];

    const result: Record<string, ProviderAuthInfo> = {};

    for (const p of providers) {
      const cred = this.memoryCredentials.get(p.id);
      if (cred) {
        result[p.id] = {
          provider: p.id,
          label: p.label,
          status: "authenticated",
          authType: cred.authType,
          source: cred.source,
          account: cred.account,
          maskedToken: this.maskSecret(cred.token),
        };
      } else {
        result[p.id] = {
          provider: p.id,
          label: p.label,
          status: "unconfigured",
          authType: "none",
        };
      }
    }

    return result;
  }

  public setManualCredentials(
    provider: string,
    credentials: { token: string; authType?: ProviderAuthType; account?: string },
  ): { success: boolean; message: string } {
    if (!credentials.token) {
      return { success: false, message: "Token or API key must not be empty" };
    }

    this.memoryCredentials.set(provider, {
      token: credentials.token,
      authType: credentials.authType || "api_key",
      account: credentials.account,
      source: "manual_user_config",
    });

    this.persist();
    return { success: true, message: `Successfully configured credentials for ${provider}` };
  }

  public getRawCredential(provider: string): string | undefined {
    return this.memoryCredentials.get(provider)?.token;
  }

  public applyToEnvironment(): void {
    const opencode = this.getRawCredential("opencode");
    if (opencode && !process.env.OPENCODE_API_KEY) {
      process.env.OPENCODE_API_KEY = opencode;
    }

    const codex = this.getRawCredential("codex");
    if (codex && !process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = codex;
    }

    const claude = this.getRawCredential("claude");
    if (claude && !process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = claude;
    }

    const agy = this.getRawCredential("antigravity");
    if (agy && !process.env.GEMINI_API_KEY && agy !== "local_cli_authenticated") {
      process.env.GEMINI_API_KEY = agy;
    }
  }
}

let managerInstance: ZencodeOAuthManager | null = null;

export function getZencodeOAuthManager(): ZencodeOAuthManager {
  if (!managerInstance) {
    managerInstance = new ZencodeOAuthManager();
  }
  return managerInstance;
}
