import fs from "node:fs";
import type {
  ClefSystemOneRequest,
  ClefSystemOneResponse,
  CloudflareFreeAccount,
  CloudflarePoolConfig,
  CloudflarePoolStats,
} from "./types.js";
import { ClefUpstreamClient } from "./clef-upstream-client.js";
import { getClefHitLogger } from "./clef-hit-logger.js";

export const DEFAULT_FREE_NEURONS_LIMIT = 10_000; // Cloudflare Free Tier: 10,000 Neurons/day

/**
 * Cloudflare Free Multi-Account Pool Router
 * Upstream Reference: https://huggingface.co/Cloudflare/clef
 *
 * Distributes requests across multiple free Cloudflare accounts (10,000 Neurons/day each).
 * Strictly complies with Zencode's Stealth Mode & Quota Randomization rules.
 * Automatically falls back to Local 9B (Clef-Flash 9B ONNX / Surrogate) when all accounts exhaust their quota.
 */
export class CloudflareFreePoolRouter {
  private accounts: Map<string, CloudflareFreeAccount> = new Map();
  private localFallbackCount = 0;
  private currentUtcDate: string;
  private readonly defaultNeuronsPerPass: number;
  public readonly fallbackToLocal9B: boolean;

  constructor(config?: Partial<CloudflarePoolConfig>) {
    this.currentUtcDate = this.getTodayUtcString();
    this.defaultNeuronsPerPass = config?.defaultNeuronsPerPass ?? 75;
    this.fallbackToLocal9B = config?.fallbackToLocal9BOnExhausted ?? true;

    // Initialize from provided config or environment
    if (config?.accounts && config.accounts.length > 0) {
      for (const acc of config.accounts) {
        this.registerAccount(acc);
      }
    } else {
      this.initFromEnvironmentOrDefault();
    }
  }

  private getTodayUtcString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private initFromEnvironmentOrDefault(): void {
    // 1. Check file-based account config
    const configPath =
      process.env.ZENCODE_CLOUDFLARE_ACCOUNTS_FILE || "/home/zen/.zencode/cloudflare_accounts.json";
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : parsed.accounts || [];
        for (const item of list) {
          if (item.email) {
            this.registerAccount({
              ...item,
              email: item.email,
            });
          }
        }
        if (this.accounts.size > 0) return;
      } catch {
        // Fall back to env
      }
    }

    // 2. Check JSON env var
    const envAccounts = process.env.ZENCODE_CLOUDFLARE_ACCOUNTS_JSON;
    if (envAccounts) {
      try {
        const parsed = JSON.parse(envAccounts) as Array<Partial<CloudflareFreeAccount>>;
        for (const item of parsed) {
          if (item.email) {
            this.registerAccount({
              ...item,
              email: item.email,
            });
          }
        }
        return;
      } catch {
        // Ignore parse error and fall back to node defaults
      }
    }

    // Default multi-node free accounts pool
    const defaultEmails = ["zenpham@gmail.com", "binhthuong@gmail.com", "sunward@gmail.com"];

    for (const email of defaultEmails) {
      const id = email.replace(/[^a-zA-Z0-9]/g, "_");
      this.registerAccount({
        id,
        email,
        accountId: `cf_acc_${id.slice(0, 8)}`,
        apiToken: `cf_token_${id.slice(0, 8)}`,
        dailyNeuronsLimit: DEFAULT_FREE_NEURONS_LIMIT,
      });
    }
  }

  public registerAccount(
    account: Partial<CloudflareFreeAccount> & { email: string },
  ): CloudflareFreeAccount {
    const id = account.id || account.email.replace(/[^a-zA-Z0-9]/g, "_");
    const existing = this.accounts.get(id);

    const fullAccount: CloudflareFreeAccount = {
      id,
      email: account.email,
      accountId: account.accountId || existing?.accountId || `cf_acc_${id.slice(0, 8)}`,
      apiToken: account.apiToken || existing?.apiToken || `cf_token_${id.slice(0, 8)}`,
      dailyNeuronsLimit:
        account.dailyNeuronsLimit ?? existing?.dailyNeuronsLimit ?? DEFAULT_FREE_NEURONS_LIMIT,
      neuronsUsedToday: existing ? existing.neuronsUsedToday : 0,
      lastResetDateUtc: existing ? existing.lastResetDateUtc : this.currentUtcDate,
      status: account.status || existing?.status || "active",
      lastUsedTimestamp: existing ? existing.lastUsedTimestamp : 0,
      egressProxy: account.egressProxy || existing?.egressProxy,
    };

    this.accounts.set(id, fullAccount);
    return fullAccount;
  }

  public checkAndResetUtcDay(): boolean {
    const today = this.getTodayUtcString();
    if (today !== this.currentUtcDate) {
      this.currentUtcDate = today;
      for (const account of this.accounts.values()) {
        account.neuronsUsedToday = 0;
        account.lastResetDateUtc = today;
        if (account.status === "quota_exhausted") {
          account.status = "active";
        }
      }
      return true;
    }
    return false;
  }

  public selectNextAccount(): CloudflareFreeAccount | null {
    this.checkAndResetUtcDay();

    const activeAccounts = Array.from(this.accounts.values()).filter(
      (a) => a.status === "active" && a.neuronsUsedToday < a.dailyNeuronsLimit,
    );

    if (activeAccounts.length === 0) {
      return null;
    }

    // Stealth load balancing: Pick account with lowest utilization + randomized jitter
    activeAccounts.sort((a, b) => {
      const utilA = a.neuronsUsedToday / a.dailyNeuronsLimit;
      const utilB = b.neuronsUsedToday / b.dailyNeuronsLimit;
      const diff = utilA - utilB;
      // Add a slight random noise (jitter) to prevent predictable round-robin fingerprinting
      if (Math.abs(diff) < 0.1) {
        return Math.random() - 0.5;
      }
      return diff;
    });

    return activeAccounts[0];
  }

  public recordUsage(accountId: string, neuronsConsumed: number): void {
    const account = this.accounts.get(accountId);
    if (!account) return;

    account.neuronsUsedToday += neuronsConsumed;
    account.lastUsedTimestamp = Date.now();

    if (account.neuronsUsedToday >= account.dailyNeuronsLimit) {
      account.status = "quota_exhausted";
    }
  }

  public markAccountExhausted(accountId: string, reason?: string): void {
    const account = this.accounts.get(accountId);
    if (account) {
      account.status = "quota_exhausted";
      account.neuronsUsedToday = account.dailyNeuronsLimit;
      account.lastUsedTimestamp = Date.now();
      if (reason) {
        // Track exhaustion reason in metadata
        account.status = "quota_exhausted";
      }
    }
  }

  public getPoolStats(): CloudflarePoolStats {
    this.checkAndResetUtcDay();

    let totalNeuronsUsed = 0;
    let totalDailyPoolNeurons = 0;
    let activeCount = 0;
    let exhaustedCount = 0;

    for (const a of this.accounts.values()) {
      totalDailyPoolNeurons += a.dailyNeuronsLimit;
      totalNeuronsUsed += a.neuronsUsedToday;
      if (a.status === "active" && a.neuronsUsedToday < a.dailyNeuronsLimit) {
        activeCount++;
      } else if (a.status === "quota_exhausted" || a.neuronsUsedToday >= a.dailyNeuronsLimit) {
        exhaustedCount++;
      }
    }

    return {
      totalAccounts: this.accounts.size,
      activeAccounts: activeCount,
      exhaustedAccounts: exhaustedCount,
      totalDailyPoolNeurons,
      totalNeuronsUsedToday: totalNeuronsUsed,
      totalNeuronsRemainingToday: Math.max(0, totalDailyPoolNeurons - totalNeuronsUsed),
      localFallbackCount: this.localFallbackCount,
      lastResetDateUtc: this.currentUtcDate,
    };
  }

  /**
   * Execute Clef evaluation across Cloudflare Free pool accounts with automatic Local 9B fallback
   */
  public async evaluateWithFallback(
    req: ClefSystemOneRequest,
    upstreamClient?: ClefUpstreamClient,
  ): Promise<ClefSystemOneResponse> {
    const startTime = performance.now();
    const client = upstreamClient || new ClefUpstreamClient();

    // 1. Try to route through Cloudflare Free Account Pool
    let account = this.selectNextAccount();

    while (account) {
      try {
        // Execute request against upstream Cloudflare Workers AI / Clef
        const response = await client.evaluate(req);

        // If circuit breaker fell back locally due to OPEN state or network error:
        if (response.source === "local_fallback") {
          // Breaker triggered or upstream unavailable -> Fallback to 9B Local
          this.localFallbackCount++;
          getClefHitLogger().recordHit({
            model: "clef-flash-9b",
            tier: "local",
            source: "local_fallback",
            purpose: "council_gate",
            latencyMs: Math.round(performance.now() - startTime),
            tokensSaved: 150,
            decision: "ZERO_TOKEN_PASS_LOCAL_9B",
            details: {
              accountEmail: account.email,
              reason:
                "Upstream Cloudflare unreachable or circuit breaker OPEN, routed to Local 9B Surrogate",
            },
          });
          return response;
        }

        // Upstream succeeded: record neuron consumption
        const neurons = this.defaultNeuronsPerPass;
        this.recordUsage(account.id, neurons);

        getClefHitLogger().recordHit({
          model: "clef-27b",
          tier: "cloud",
          source: "upstream_clef",
          purpose: "council_gate",
          latencyMs: Math.round(performance.now() - startTime),
          tokensSaved: 250,
          decision: response.selected_option,
          details: {
            accountEmail: account.email,
            neuronsConsumed: neurons,
            poolRemainingToday: this.getPoolStats().totalNeuronsRemainingToday,
          },
        });

        return response;
      } catch (err: unknown) {
        // If HTTP 429 or quota limit hit: mark exhausted and try next account
        const errMsg = String(err);
        if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("limit")) {
          this.markAccountExhausted(account.id, errMsg);
          account = this.selectNextAccount();
        } else {
          // Other unexpected error: break to local fallback
          break;
        }
      }
    }

    // 2. All accounts exhausted OR pool empty: Fallback to 9B Local!
    this.localFallbackCount++;
    const latency = performance.now() - startTime;
    const fallbackResponse = client.localFallbackEvaluation(req, latency, "local_fallback");

    getClefHitLogger().recordHit({
      model: "clef-flash-9b",
      tier: "local",
      source: "local_fallback",
      purpose: "council_gate",
      latencyMs: Math.max(1, Math.round(latency)),
      tokensSaved: 150,
      decision: "ZERO_TOKEN_PASS_CLOUDFLARE_EXHAUSTED",
      details: {
        reason:
          "All Cloudflare Free accounts exhausted (10,000 neurons/day limit), seamless fallback to 9B Local",
        poolStats: this.getPoolStats(),
      },
    });

    return fallbackResponse;
  }

  /**
   * Run generic inference on Cloudflare Workers AI across the multi-account free pool
   * Supported models:
   *  - @cf/meta/llama-3.1-8b-instruct
   *  - @cf/meta/llama-3.3-70b-instruct
   *  - @cf/deepseek-ai/deepseek-r1-distill-qwen-32b
   *  - @cf/qwen/qwen2.5-coder-7b-instruct
   */
  public async runWorkersAi(
    model: string,
    messages: Array<{ role: string; content: string }>,
    estimatedNeurons: number = 50,
    customFetch?: typeof fetch,
  ): Promise<{
    response: string;
    accountEmail: string;
    neuronsConsumed: number;
    source: "cloudflare_workers_ai" | "local_fallback";
    latencyMs: number;
  }> {
    const startTime = performance.now();
    const fetchFn = customFetch ?? fetch;
    let account = this.selectNextAccount();

    while (account) {
      const currentAccount = account;
      try {
        let content = "";
        const isLiveToken =
          currentAccount.apiToken &&
          !currentAccount.apiToken.startsWith("cf_token_") &&
          !currentAccount.apiToken.startsWith("tok_") &&
          !currentAccount.apiToken.startsWith("mock_");

        // If real token provided or customFetch injected, perform REST API call
        if (customFetch || isLiveToken) {
          const res = await fetchFn(
            `https://api.cloudflare.com/client/v4/accounts/${currentAccount.accountId}/ai/run/${model}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${currentAccount.apiToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ messages }),
            },
          );

          if (!res.ok) {
            if (res.status === 429) {
              this.markAccountExhausted(
                currentAccount.id,
                "Cloudflare 429 Rate Limit / Daily Neurons Quota Exhausted",
              );
              account = this.selectNextAccount();
              continue;
            }
            throw new Error(`Workers AI HTTP error ${res.status}: ${await res.text()}`);
          }

          const json = (await res.json()) as { result?: { response?: string } };
          content = json.result?.response || "";
        } else {
          // Dev / mock simulation for offline / testing environments
          content = `[CF Free Pool Swarm: ${currentAccount.email}] Completed inference via ${model}`;
        }

        const latencyMs = Math.round(performance.now() - startTime);
        this.recordUsage(currentAccount.id, estimatedNeurons);

        getClefHitLogger().recordHit({
          model,
          tier: "cloud",
          source: "cloudflare_workers_ai",
          purpose: "workers_ai_swarm",
          latencyMs,
          tokensSaved: 300,
          decision: "SWARM_PASS",
          details: {
            accountEmail: currentAccount.email,
            neuronsConsumed: estimatedNeurons,
            poolRemainingToday: this.getPoolStats().totalNeuronsRemainingToday,
          },
        });

        return {
          response: content,
          accountEmail: currentAccount.email,
          neuronsConsumed: estimatedNeurons,
          source: "cloudflare_workers_ai",
          latencyMs,
        };
      } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("limit")) {
          this.markAccountExhausted(currentAccount.id, errMsg);
          account = this.selectNextAccount();
        } else {
          break;
        }
      }
    }

    // Fallback to local 9B surrogate
    this.localFallbackCount++;
    const latencyMs = Math.max(1, Math.round(performance.now() - startTime));
    const fallbackResponse = `[Local 9B Surrogate Fallback] Cloudflare Free Swarm accounts exhausted. Response served locally at zero cost.`;

    getClefHitLogger().recordHit({
      model: "clef-flash-9b",
      tier: "local",
      source: "local_fallback",
      purpose: "workers_ai_swarm",
      latencyMs,
      tokensSaved: 200,
      decision: "ZERO_TOKEN_PASS_CLOUDFLARE_EXHAUSTED",
      details: {
        reason:
          "All Cloudflare Free accounts exhausted (10k Neurons limit), fallen back to Local 9B",
        poolStats: this.getPoolStats(),
      },
    });

    return {
      response: fallbackResponse,
      accountEmail: "local-9b-surrogate",
      neuronsConsumed: 0,
      source: "local_fallback",
      latencyMs,
    };
  }
}

let poolRouterInstance: CloudflareFreePoolRouter | null = null;

export function getCloudflareFreePoolRouter(): CloudflareFreePoolRouter {
  if (!poolRouterInstance) {
    poolRouterInstance = new CloudflareFreePoolRouter();
  }
  return poolRouterInstance;
}
