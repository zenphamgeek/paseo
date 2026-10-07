import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Logger } from "pino";

const execFileAsync = promisify(execFile);

export type ProviderAuthType = "oauth" | "api_key" | "cli_session" | "none";
export type ProviderAuthStatus = "authenticated" | "discovered" | "unconfigured";
export type EcosystemType = "agy" | "opencode" | "codex" | "paseo" | "infra" | "workspace";

export interface ProviderAuthInfo {
  provider: string;
  label: string;
  ecosystem: EcosystemType;
  status: ProviderAuthStatus;
  authType: ProviderAuthType;
  source?: string;
  account?: string;
  maskedToken?: string;
  configuredAt?: number;
}

export interface AutoConfigHarvestItem {
  provider: string;
  ecosystem: EcosystemType;
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

export const SUPPORTED_PLUGINS: Array<{
  id: string;
  label: string;
  ecosystem: EcosystemType;
  envKeys: string[];
}> = [
  {
    id: "antigravity",
    label: "Google Antigravity (AGY)",
    ecosystem: "agy",
    envKeys: ["GEMINI_API_KEY", "ANTIGRAVITY_TOKEN"],
  },
  {
    id: "opencode",
    label: "OpenCode Engine & 9Router",
    ecosystem: "opencode",
    envKeys: ["OPENCODE_API_KEY"],
  },
  {
    id: "opencode-go",
    label: "OpenCode Go Official",
    ecosystem: "opencode",
    envKeys: ["OPENCODE_GO_TOKEN"],
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    ecosystem: "codex",
    envKeys: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  },
  {
    id: "claude",
    label: "Anthropic Claude",
    ecosystem: "codex",
    envKeys: ["ANTHROPIC_API_KEY"],
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    ecosystem: "paseo",
    envKeys: ["COPILOT_TOKEN", "GITHUB_TOKEN"],
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    ecosystem: "paseo",
    envKeys: ["CURSOR_TOKEN"],
  },
  {
    id: "grok",
    label: "xAI Grok",
    ecosystem: "paseo",
    envKeys: ["GROK_TOKEN", "XAI_API_KEY", "GROK_API_KEY"],
  },
  {
    id: "kimi",
    label: "Moonshot Kimi",
    ecosystem: "paseo",
    envKeys: ["KIMI_TOKEN"],
  },
  {
    id: "minimax",
    label: "MiniMax M6",
    ecosystem: "paseo",
    envKeys: ["MINIMAX_API_KEY"],
  },
  {
    id: "zai",
    label: "ZAI Engine (Zencode)",
    ecosystem: "paseo",
    envKeys: ["ZAI_API_KEY"],
  },
  {
    id: "muse",
    label: "Muse Audio / Core Protocol",
    ecosystem: "paseo",
    envKeys: ["MUSE_TOKEN"],
  },
  {
    id: "figma",
    label: "Figma (Design-to-Code)",
    ecosystem: "workspace",
    envKeys: ["FIGMA_ACCESS_TOKEN", "FIGMA_TOKEN", "FIGMA_PERSONAL_TOKEN"],
  },
  {
    id: "gdrive",
    label: "Google Drive (Docs & Sheets)",
    ecosystem: "workspace",
    envKeys: ["GOOGLE_DRIVE_TOKEN", "GDRIVE_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS"],
  },
  {
    id: "canva",
    label: "Canva (Creative Visuals)",
    ecosystem: "workspace",
    envKeys: ["CANVA_API_KEY", "CANVA_TOKEN"],
  },
  {
    id: "notion",
    label: "Notion Knowledge & Docs",
    ecosystem: "workspace",
    envKeys: ["NOTION_API_KEY", "NOTION_TOKEN"],
  },
  {
    id: "linear",
    label: "Linear (Issue Tracker)",
    ecosystem: "workspace",
    envKeys: ["LINEAR_API_KEY", "LINEAR_TOKEN"],
  },
  {
    id: "github",
    label: "GitHub Version Control",
    ecosystem: "infra",
    envKeys: ["GITHUB_TOKEN", "GH_TOKEN"],
  },
  {
    id: "telegram",
    label: "Telegram Alert Gateway",
    ecosystem: "infra",
    envKeys: ["TELEGRAM_BOT_TOKEN"],
  },
];

interface FileHarvestConfig {
  pluginId: string;
  ecosystem: EcosystemType;
  authType: ProviderAuthType;
  subPath: string[];
  extract: (json: Record<string, unknown>) => string | undefined;
}

function extractFirstString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = data[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

const FILE_HARVEST_CONFIGS: FileHarvestConfig[] = [
  {
    pluginId: "cursor",
    ecosystem: "paseo",
    authType: "oauth",
    subPath: [".config", "cursor", "auth.json"],
    extract: (data) => extractFirstString(data, ["accessToken"]),
  },
  {
    pluginId: "grok",
    ecosystem: "paseo",
    authType: "oauth",
    subPath: [".grok", "auth.json"],
    extract: (data) => extractFirstString(data, ["access_token", "apiKey"]),
  },
  {
    pluginId: "figma",
    ecosystem: "workspace",
    authType: "oauth",
    subPath: [".config", "figma", "auth.json"],
    extract: (data) => extractFirstString(data, ["token", "accessToken"]),
  },
  {
    pluginId: "gdrive",
    ecosystem: "workspace",
    authType: "oauth",
    subPath: [".config", "gdrive", "credentials.json"],
    extract: (data) => extractFirstString(data, ["token", "access_token"]),
  },
  {
    pluginId: "notion",
    ecosystem: "workspace",
    authType: "api_key",
    subPath: [".config", "notion", "auth.json"],
    extract: (data) => extractFirstString(data, ["apiKey", "token"]),
  },
];

export class ZencodeOAuthManager {
  private readonly configDir: string;
  private readonly storePath: string;
  private readonly memoryCredentials = new Map<
    string,
    {
      token: string;
      authType: ProviderAuthType;
      account?: string;
      source: string;
      ecosystem: EcosystemType;
    }
  >();
  private readonly logger?: Logger;
  private autoConfigPromise: Promise<AutoConfigResult> | null = null;

  constructor(options?: { configDir?: string; logger?: Logger }) {
    this.configDir = options?.configDir || join(homedir(), ".zencode", "auth");
    this.storePath = join(this.configDir, "credentials.json");
    this.logger = options?.logger;
    this.ensureDirs();
    this.loadPersisted();
  }

  private ensureDirs(): void {
    try {
      if (!existsSync(this.configDir)) {
        mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
      }
    } catch (err) {
      this.logger?.warn({ err }, "Could not create config dir");
    }
  }

  private loadPersisted(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const raw = readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<
        string,
        {
          token: string;
          authType: ProviderAuthType;
          account?: string;
          source: string;
          ecosystem?: EcosystemType;
        }
      >;
      for (const [provider, cred] of Object.entries(parsed)) {
        if (cred?.token) {
          const pluginDef = SUPPORTED_PLUGINS.find((p) => p.id === provider);
          this.memoryCredentials.set(provider, {
            ...cred,
            ecosystem: cred.ecosystem || pluginDef?.ecosystem || "paseo",
          });
        }
      }
    } catch (err) {
      this.logger?.warn({ err }, "Failed to load persisted Zencode credentials");
    }
  }

  private persist(): void {
    try {
      this.ensureDirs();
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

  // --- Ecosystem Harvesters ---

  // 1. Opencode & 9Router
  private harvestOpencode(): AutoConfigHarvestItem {
    const home = homedir();
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
            ecosystem: "opencode",
          });
          return {
            provider: "opencode",
            ecosystem: "opencode",
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
              ecosystem: "opencode",
            });
            return {
              provider: "opencode",
              ecosystem: "opencode",
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
        ecosystem: "opencode",
      });
      return {
        provider: "opencode",
        ecosystem: "opencode",
        found: true,
        source: "env:OPENCODE_API_KEY",
        authType: "api_key",
      };
    }

    return { provider: "opencode", ecosystem: "opencode", found: false, authType: "none" };
  }

  // 2. Antigravity (AGY)
  private async harvestAntigravity(): Promise<AutoConfigHarvestItem> {
    const agyBin = join(homedir(), ".local", "bin", "agy");
    if (existsSync(agyBin)) {
      try {
        const { stdout } = await execFileAsync(agyBin, ["--version"]);
        const ver = stdout.trim();
        this.memoryCredentials.set("antigravity", {
          token: "local_cli_authenticated",
          authType: "cli_session",
          account: `agy_${ver}`,
          source: agyBin,
          ecosystem: "agy",
        });
        return {
          provider: "antigravity",
          ecosystem: "agy",
          found: true,
          source: agyBin,
          authType: "cli_session",
          account: `agy_${ver}`,
        };
      } catch {
        // Fall through
      }
    }

    if (process.env.GEMINI_API_KEY || process.env.ANTIGRAVITY_TOKEN) {
      const token = (process.env.GEMINI_API_KEY || process.env.ANTIGRAVITY_TOKEN) as string;
      this.memoryCredentials.set("antigravity", {
        token,
        authType: "api_key",
        source: "env:GEMINI_API_KEY",
        ecosystem: "agy",
      });
      return {
        provider: "antigravity",
        ecosystem: "agy",
        found: true,
        source: "env:GEMINI_API_KEY",
        authType: "api_key",
      };
    }

    return { provider: "antigravity", ecosystem: "agy", found: false, authType: "none" };
  }

  // 3. Codex (OpenAI)
  private harvestCodex(): AutoConfigHarvestItem {
    const home = homedir();
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
            ecosystem: "codex",
          });
          return {
            provider: "codex",
            ecosystem: "codex",
            found: true,
            source: piAuthPath,
            authType,
          };
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
        ecosystem: "codex",
      });
      return {
        provider: "codex",
        ecosystem: "codex",
        found: true,
        source: "env:OPENAI_API_KEY",
        authType: "api_key",
      };
    }

    return { provider: "codex", ecosystem: "codex", found: false, authType: "none" };
  }

  // 4. Claude (Anthropic)
  private harvestClaude(): AutoConfigHarvestItem {
    if (process.env.ANTHROPIC_API_KEY) {
      this.memoryCredentials.set("claude", {
        token: process.env.ANTHROPIC_API_KEY,
        authType: "api_key",
        source: "env:ANTHROPIC_API_KEY",
        ecosystem: "codex",
      });
      return {
        provider: "claude",
        ecosystem: "codex",
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
          this.memoryCredentials.set("claude", {
            token,
            authType,
            source: piAuthPath,
            ecosystem: "codex",
          });
          return {
            provider: "claude",
            ecosystem: "codex",
            found: true,
            source: piAuthPath,
            authType,
          };
        }
      } catch {
        // Continue
      }
    }

    return { provider: "claude", ecosystem: "codex", found: false, authType: "none" };
  }

  // 5. GitHub & Copilot
  private harvestGitHubAndCopilot(): { gh: AutoConfigHarvestItem; copilot: AutoConfigHarvestItem } {
    const ghHostPath = join(homedir(), ".config", "gh", "hosts.yml");
    let ghFound = false;
    let ghToken: string | undefined;
    let ghUser = "zenphamgeek";

    if (existsSync(ghHostPath)) {
      try {
        const raw = readFileSync(ghHostPath, "utf-8");
        const userMatch = raw.match(/user:\s*([^\s]+)/);
        const tokenMatch = raw.match(/oauth_token:\s*([^\s]+)/);
        if (userMatch?.[1]) ghUser = userMatch[1];
        if (tokenMatch?.[1]) {
          ghToken = tokenMatch[1];
          ghFound = true;
          this.memoryCredentials.set("github", {
            token: ghToken,
            authType: "oauth",
            account: ghUser,
            source: ghHostPath,
            ecosystem: "infra",
          });
        } else {
          ghToken = "gh_cli_credential_helper";
          ghFound = true;
          this.memoryCredentials.set("github", {
            token: ghToken,
            authType: "cli_session",
            account: ghUser,
            source: ghHostPath,
            ecosystem: "infra",
          });
        }
      } catch {
        // Continue
      }
    }

    if (!ghFound && (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)) {
      ghToken = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) as string;
      ghFound = true;
      this.memoryCredentials.set("github", {
        token: ghToken,
        authType: "oauth",
        account: ghUser,
        source: "env:GITHUB_TOKEN",
        ecosystem: "infra",
      });
    }

    // Copilot
    let copilotFound = false;
    if (process.env.COPILOT_TOKEN) {
      copilotFound = true;
      this.memoryCredentials.set("copilot", {
        token: process.env.COPILOT_TOKEN,
        authType: "oauth",
        source: "env:COPILOT_TOKEN",
        ecosystem: "paseo",
      });
    } else if (ghFound && ghToken && ghToken !== "gh_cli_credential_helper") {
      copilotFound = true;
      this.memoryCredentials.set("copilot", {
        token: ghToken,
        authType: "oauth",
        account: ghUser,
        source: ghHostPath,
        ecosystem: "paseo",
      });
    }

    return {
      gh: ghFound
        ? {
            provider: "github",
            ecosystem: "infra",
            found: true,
            source: ghHostPath,
            authType: ghToken === "gh_cli_credential_helper" ? "cli_session" : "oauth",
            account: ghUser,
          }
        : { provider: "github", ecosystem: "infra", found: false, authType: "none" },
      copilot: copilotFound
        ? {
            provider: "copilot",
            ecosystem: "paseo",
            found: true,
            source: ghHostPath,
            authType: "oauth",
            account: ghUser,
          }
        : { provider: "copilot", ecosystem: "paseo", found: false, authType: "none" },
    };
  }

  // 6. Telegram Gateway
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
            ecosystem: "infra",
          });
          return {
            provider: "telegram",
            ecosystem: "infra",
            found: true,
            source: configPath,
            authType: "api_key",
            account: parsed.botName || "Phamvuthang (@zenpham_bot)",
          };
        }
      } catch {
        // Continue
      }
    }

    if (process.env.TELEGRAM_BOT_TOKEN) {
      this.memoryCredentials.set("telegram", {
        token: process.env.TELEGRAM_BOT_TOKEN,
        authType: "api_key",
        source: "env:TELEGRAM_BOT_TOKEN",
        ecosystem: "infra",
      });
      return {
        provider: "telegram",
        ecosystem: "infra",
        found: true,
        source: "env:TELEGRAM_BOT_TOKEN",
        authType: "api_key",
      };
    }

    return { provider: "telegram", ecosystem: "infra", found: false, authType: "none" };
  }

  private harvestFromFileStore(config: FileHarvestConfig): AutoConfigHarvestItem | null {
    const filePath = join(homedir(), ...config.subPath);
    if (!existsSync(filePath)) return null;

    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      const token = config.extract(raw);
      if (token) {
        this.memoryCredentials.set(config.pluginId, {
          token,
          authType: config.authType,
          source: filePath,
          ecosystem: config.ecosystem,
        });
        return {
          provider: config.pluginId,
          ecosystem: config.ecosystem,
          found: true,
          source: filePath,
          authType: config.authType,
        };
      }
    } catch {
      // Ignore invalid files
    }

    return null;
  }

  private harvestFromEnv(pluginId: string, ecosystem: EcosystemType): AutoConfigHarvestItem | null {
    const pluginDef = SUPPORTED_PLUGINS.find((p) => p.id === pluginId);
    if (!pluginDef) return null;

    for (const envKey of pluginDef.envKeys) {
      const val = process.env[envKey];
      if (val) {
        this.memoryCredentials.set(pluginId, {
          token: val,
          authType: "api_key",
          source: `env:${envKey}`,
          ecosystem,
        });
        return {
          provider: pluginId,
          ecosystem,
          found: true,
          source: `env:${envKey}`,
          authType: "api_key",
        };
      }
    }
    return null;
  }

  // 7. Generic Environment & Plugin Files Harvester (Cursor, Grok, Kimi, MiniMax, ZAI, Workspace)
  private harvestOtherPlugins(pluginId: string, ecosystem: EcosystemType): AutoConfigHarvestItem {
    const fileConfig = FILE_HARVEST_CONFIGS.find((c) => c.pluginId === pluginId);
    if (fileConfig) {
      const result = this.harvestFromFileStore(fileConfig);
      if (result) return result;
    }

    const envResult = this.harvestFromEnv(pluginId, ecosystem);
    if (envResult) return envResult;

    return { provider: pluginId, ecosystem, found: false, authType: "none" };
  }

  // Auto-synchronize credentials to standard plugin filesystem stores
  public syncToPluginStores(): void {
    const home = homedir();

    // 1. Sync Codex & Claude to ~/.pi/agent/auth.json
    const piDir = join(home, ".pi", "agent");
    const piAuthPath = join(piDir, "auth.json");
    const codexToken = this.getRawCredential("codex");
    const claudeToken = this.getRawCredential("claude");

    if (codexToken || claudeToken) {
      try {
        if (!existsSync(piDir)) {
          mkdirSync(piDir, { recursive: true, mode: 0o700 });
        }
        let current: Record<string, unknown> = {};
        if (existsSync(piAuthPath)) {
          try {
            current = JSON.parse(readFileSync(piAuthPath, "utf-8")) as Record<string, unknown>;
          } catch {
            current = {};
          }
        }
        if (codexToken) {
          current["openai-codex"] = { type: "oauth", access: codexToken };
        }
        if (claudeToken) {
          current["anthropic"] = { type: "oauth", access: claudeToken };
        }
        writeFileSync(piAuthPath, JSON.stringify(current, null, 2), { mode: 0o600 });
        this.logger?.info("Synchronized Codex/Claude credentials to ~/.pi/agent/auth.json");
      } catch (err) {
        this.logger?.warn({ err }, "Failed to write ~/.pi/agent/auth.json");
      }
    }

    // 2. Sync Opencode to ~/.local/share/opencode/auth.json
    const opencodeDir = join(home, ".local", "share", "opencode");
    const opencodeAuthPath = join(opencodeDir, "auth.json");
    const opencodeToken = this.getRawCredential("opencode");

    if (opencodeToken) {
      try {
        if (!existsSync(opencodeDir)) {
          mkdirSync(opencodeDir, { recursive: true, mode: 0o700 });
        }
        let current: Record<string, unknown> = {};
        if (existsSync(opencodeAuthPath)) {
          try {
            current = JSON.parse(readFileSync(opencodeAuthPath, "utf-8")) as Record<
              string,
              unknown
            >;
          } catch {
            current = {};
          }
        }
        current["opencode-go"] = { type: "api", key: opencodeToken };
        writeFileSync(opencodeAuthPath, JSON.stringify(current, null, 2), { mode: 0o600 });
        this.logger?.info("Synchronized OpenCode credentials to ~/.local/share/opencode/auth.json");
      } catch (err) {
        this.logger?.warn({ err }, "Failed to write ~/.local/share/opencode/auth.json");
      }
    }

    // 3. Inject to process.env
    this.applyToEnvironment();
  }

  public async autoConfigureAll(): Promise<AutoConfigResult> {
    if (this.autoConfigPromise) {
      this.logger?.debug("Returning in-flight autoConfigureAll promise (deduplicated)");
      return this.autoConfigPromise;
    }

    this.autoConfigPromise = this.executeAutoConfigureAll().finally(() => {
      this.autoConfigPromise = null;
    });

    return this.autoConfigPromise;
  }

  private async executeAutoConfigureAll(): Promise<AutoConfigResult> {
    const items: AutoConfigHarvestItem[] = [];

    // Harvest core ecosystems
    items.push(this.harvestOpencode());
    items.push(await this.harvestAntigravity());
    items.push(this.harvestCodex());
    items.push(this.harvestClaude());

    const ghAndCopilot = this.harvestGitHubAndCopilot();
    items.push(ghAndCopilot.gh);
    items.push(ghAndCopilot.copilot);

    items.push(this.harvestTelegram());

    // Harvest remaining plugins
    items.push(this.harvestOtherPlugins("cursor", "paseo"));
    items.push(this.harvestOtherPlugins("grok", "paseo"));
    items.push(this.harvestOtherPlugins("kimi", "paseo"));
    items.push(this.harvestOtherPlugins("minimax", "paseo"));
    items.push(this.harvestOtherPlugins("zai", "paseo"));
    items.push(this.harvestOtherPlugins("muse", "paseo"));

    // Harvest Workspace & Design Integrations (Codex Engine)
    items.push(this.harvestOtherPlugins("figma", "workspace"));
    items.push(this.harvestOtherPlugins("gdrive", "workspace"));
    items.push(this.harvestOtherPlugins("canva", "workspace"));
    items.push(this.harvestOtherPlugins("notion", "workspace"));
    items.push(this.harvestOtherPlugins("linear", "workspace"));

    this.persist();
    this.syncToPluginStores();

    const configuredCount = items.filter((i) => i.found).length;

    return {
      timestamp: Date.now(),
      totalProviders: items.length,
      configuredCount,
      items,
    };
  }

  public async getStatus(): Promise<Record<string, ProviderAuthInfo>> {
    if (this.memoryCredentials.size === 0) {
      await this.autoConfigureAll();
    }

    const result: Record<string, ProviderAuthInfo> = {};

    for (const plugin of SUPPORTED_PLUGINS) {
      const cred = this.memoryCredentials.get(plugin.id);
      if (cred) {
        result[plugin.id] = {
          provider: plugin.id,
          label: plugin.label,
          ecosystem: plugin.ecosystem,
          status: "authenticated",
          authType: cred.authType,
          source: cred.source,
          account: cred.account,
          maskedToken: this.maskSecret(cred.token),
        };
      } else {
        result[plugin.id] = {
          provider: plugin.id,
          label: plugin.label,
          ecosystem: plugin.ecosystem,
          status: "unconfigured",
          authType: "none",
        };
      }
    }

    return result;
  }

  public setManualCredentials(
    provider: string,
    credentials: {
      token: string;
      authType?: ProviderAuthType;
      account?: string;
      ecosystem?: EcosystemType;
    },
  ): { success: boolean; message: string } {
    if (!credentials.token) {
      return { success: false, message: "Token or API key must not be empty" };
    }

    const pluginDef = SUPPORTED_PLUGINS.find((p) => p.id === provider);
    const ecosystem = credentials.ecosystem || pluginDef?.ecosystem || "paseo";

    this.memoryCredentials.set(provider, {
      token: credentials.token,
      authType: credentials.authType || "api_key",
      account: credentials.account,
      source: "manual_user_config",
      ecosystem,
    });

    this.persist();
    this.syncToPluginStores();

    return {
      success: true,
      message: `Successfully configured and synchronized credentials for ${pluginDef?.label || provider}`,
    };
  }

  public getRawCredential(provider: string): string | undefined {
    return this.memoryCredentials.get(provider)?.token;
  }

  public applyToEnvironment(): void {
    const envKeyMappings: Record<string, string> = {
      opencode: "OPENCODE_API_KEY",
      codex: "OPENAI_API_KEY",
      claude: "ANTHROPIC_API_KEY",
      grok: "GROK_TOKEN",
      cursor: "CURSOR_TOKEN",
      kimi: "KIMI_TOKEN",
      minimax: "MINIMAX_API_KEY",
      zai: "ZAI_API_KEY",
      figma: "FIGMA_ACCESS_TOKEN",
      gdrive: "GOOGLE_DRIVE_TOKEN",
      canva: "CANVA_API_KEY",
      notion: "NOTION_API_KEY",
      linear: "LINEAR_API_KEY",
    };

    for (const [provider, envKey] of Object.entries(envKeyMappings)) {
      const cred = this.getRawCredential(provider);
      if (cred && !process.env[envKey]) {
        process.env[envKey] = cred;
      }
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
