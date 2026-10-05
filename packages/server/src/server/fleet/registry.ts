import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import type {
  FleetClusterSummary,
  FleetJobRecord,
  FleetNodeConfig,
  FleetNodeRuntime,
  FleetNodeSummary,
  NodeState,
  QuotaSnapshot,
} from "./types.js";

const DEFAULT_FLEET_ROOT = "/home/zen/agy-fleet";

export class FleetRegistry extends EventEmitter {
  private readonly nodes = new Map<string, FleetNodeRuntime>();
  private readonly logger: Logger;
  private readonly fleetRoot: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: { logger: Logger; fleetRoot?: string }) {
    super();
    this.logger = options.logger.child({ module: "fleet-registry" });
    this.fleetRoot = options.fleetRoot || process.env.FLEET_DIR || DEFAULT_FLEET_ROOT;
  }

  public async initialize(): Promise<void> {
    this.logger.info({ root: this.fleetRoot }, "Initializing Zencode Fleet Registry");
    await this.autoDiscoverNodes();
    await this.syncStealthQuotas();
    this.startHeartbeatLoop();
  }

  public registerNode(config: FleetNodeConfig): FleetNodeRuntime {
    const existing = this.nodes.get(config.id);
    if (existing) {
      existing.config = config;
      return existing;
    }

    const runtime: FleetNodeRuntime = {
      config,
      state: "ready",
      quota: {
        usedTokens: 0,
        tokenLimit: 1_000_000,
        quotaPercent: 100,
        resetsAt: null,
        lastCheckedAt: Date.now(),
      },
      activeJobs: 0,
      requestsServed: 0,
      errorCount: 0,
      lastHeartbeat: Date.now(),
      consecutiveFailures: 0,
      proxyBinding: config.proxyId,
    };

    this.nodes.set(config.id, runtime);
    this.logger.info(
      { nodeId: config.id, tier: config.tier, kind: config.kind },
      "Node registered in fleet",
    );
    this.emit("nodeRegistered", this.summarizeNode(runtime));
    return runtime;
  }

  public getNode(nodeId: string): FleetNodeRuntime | undefined {
    return this.nodes.get(nodeId);
  }

  public getAllNodes(): FleetNodeSummary[] {
    return Array.from(this.nodes.values()).map((r) => this.summarizeNode(r));
  }

  public getAvailableNodes(tier?: string): FleetNodeRuntime[] {
    return Array.from(this.nodes.values()).filter((n) => {
      const stateOk = n.state === "ready" || n.state === "busy";
      const hasSlot = n.activeJobs < n.config.maxConcurrency;
      const tierOk = !tier || n.config.tier === tier;
      return stateOk && hasSlot && tierOk;
    });
  }

  public updateNodeState(nodeId: string, newState: NodeState): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.state === newState) return;

    const previousState = node.state;
    node.state = newState;
    this.logger.info({ nodeId, previousState, newState }, "Fleet node state transition");
    this.emit("nodeStateChanged", nodeId, newState);
  }

  public recordJobStart(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.activeJobs++;
    if (node.activeJobs >= node.config.maxConcurrency && node.state === "ready") {
      this.updateNodeState(nodeId, "busy");
    }
  }

  public recordJobResult(nodeId: string, success: boolean, errorKind?: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.activeJobs = Math.max(0, node.activeJobs - 1);
    node.lastHeartbeat = Date.now();

    if (success) {
      node.requestsServed++;
      node.consecutiveFailures = 0;
      if (node.state === "busy" && node.activeJobs < node.config.maxConcurrency) {
        this.updateNodeState(nodeId, "ready");
      }
    } else {
      node.errorCount++;
      node.consecutiveFailures++;

      if (errorKind === "quota_exhausted" || errorKind === "RESOURCE_EXHAUSTED") {
        this.updateNodeState(nodeId, "quota_exhausted");
      } else if (errorKind === "rate_limited" || errorKind === "429") {
        this.updateNodeState(nodeId, "throttled");
      } else if (node.consecutiveFailures >= 3) {
        this.updateNodeState(nodeId, "degraded");
      }
    }
  }

  public updateQuota(nodeId: string, quota: Partial<QuotaSnapshot>): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.quota = {
      ...node.quota,
      ...quota,
      lastCheckedAt: Date.now(),
    };
    this.emit("quotaUpdated", nodeId, node.quota);
  }

  private readonly recentJobs: FleetJobRecord[] = [];

  public getRecentJobs(): FleetJobRecord[] {
    return [...this.recentJobs];
  }

  public recordJob(job: FleetJobRecord): void {
    this.recentJobs.unshift(job);
    if (this.recentJobs.length > 50) this.recentJobs.pop();
  }

  public getClusterSummary(): FleetClusterSummary {
    const all = Array.from(this.nodes.values());
    const online = all.filter((n) => n.state === "ready" || n.state === "busy");
    const busy = all.filter((n) => n.state === "busy");
    const ultra = all.filter((n) => n.config.tier === "ultra");
    const pro = all.filter((n) => n.config.tier === "pro");
    const totalCapacity = all.reduce((sum, n) => sum + (n.quota.tokenLimit || 1_000_000), 0);
    const totalUsed = all.reduce((sum, n) => sum + (n.quota.usedTokens || 0), 0);
    const overallPercent =
      totalCapacity > 0 ? Math.max(0, Math.round((1 - totalUsed / totalCapacity) * 100)) : 100;

    let clusterHealth: "healthy" | "degraded" | "critical" = "critical";
    if (online.length >= all.length * 0.7) {
      clusterHealth = "healthy";
    } else if (online.length >= all.length * 0.4) {
      clusterHealth = "degraded";
    }

    return {
      totalNodes: all.length,
      onlineNodes: online.length,
      busyNodes: busy.length,
      ultraNodes: ultra.length,
      proNodes: pro.length,
      totalTokensCapacity: totalCapacity,
      totalTokensUsed: totalUsed,
      overallQuotaPercent: overallPercent,
      clusterHealth,
      autonomousEnabled: true,
      activeCouncilMode: "hybrid",
    };
  }

  public async syncStealthQuotas(): Promise<void> {
    try {
      const response = await fetch("http://127.0.0.1:7777/api/fleet/quota", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        nodes_quota?: Record<
          string,
          {
            account_email?: string;
            gemini_quota_percent?: number;
            claude_quota_percent?: number;
            gemini_quota_reset_time?: string;
            claude_quota_reset_time?: string;
            total_tokens_consumed?: number;
            tier_capacity_tokens?: number;
            status?: string;
          }
        >;
      };
      if (!data.nodes_quota) return;

      for (const [nodeId, q] of Object.entries(data.nodes_quota)) {
        const node = this.nodes.get(nodeId);
        if (!node) continue;

        if (q.account_email && !node.config.accountEmail) {
          node.config.accountEmail = q.account_email;
        }
        if (typeof q.gemini_quota_percent === "number") {
          node.geminiQuotaPercent = q.gemini_quota_percent;
        }
        if (typeof q.claude_quota_percent === "number") {
          node.claudeQuotaPercent = q.claude_quota_percent;
        }
        if (q.gemini_quota_reset_time) {
          node.geminiResetTime = q.gemini_quota_reset_time;
        }
        if (q.claude_quota_reset_time) {
          node.claudeResetTime = q.claude_quota_reset_time;
        }
        if (q.total_tokens_consumed !== undefined) {
          node.quota.usedTokens = q.total_tokens_consumed;
        }
        if (q.tier_capacity_tokens !== undefined) {
          node.quota.tokenLimit = q.tier_capacity_tokens;
        }
        if (node.quota.tokenLimit > 0) {
          node.quota.quotaPercent = Math.max(
            0,
            Math.round((1 - node.quota.usedTokens / node.quota.tokenLimit) * 100),
          );
        }
      }
    } catch {
      // 7777 passive fallback
    }
  }

  private summarizeNode(runtime: FleetNodeRuntime): FleetNodeSummary {
    return {
      id: runtime.config.id,
      kind: runtime.config.kind,
      tier: runtime.config.tier,
      state: runtime.state,
      accountEmail: runtime.config.accountEmail,
      caps: runtime.config.caps,
      preferredModel: runtime.config.preferredModel,
      proxyId: runtime.config.proxyId,
      geminiQuotaPercent:
        runtime.geminiQuotaPercent ?? (runtime.config.tier === "ultra" ? 100 : 75),
      claudeQuotaPercent:
        runtime.claudeQuotaPercent ??
        (runtime.config.caps.some((c) => c.includes("opus") || c.includes("claude")) ? 98 : 0),
      geminiResetTime: runtime.geminiResetTime ?? null,
      claudeResetTime: runtime.claudeResetTime ?? null,
      quota: runtime.quota,
      activeJobs: runtime.activeJobs,
      requestsServed: runtime.requestsServed,
      errorCount: runtime.errorCount,
      lastHeartbeat: runtime.lastHeartbeat,
    };
  }

  private async autoDiscoverNodes(): Promise<void> {
    // 1. Primary Ultra node: Nebula (B.AI Direct / Opus 4.8)
    this.registerNode({
      id: "nebula",
      kind: "nebula",
      tier: "ultra",
      accountEmail: "nebula@b.ai",
      homeDirectory: path.join(this.fleetRoot, "nebula"),
      caps: ["claude-opus-4.8", "claude-sonnet-5", "claude-opus-4.6", "tools", "planning"],
      preferredModel: "claude-opus-4.8",
      maxConcurrency: 3,
    });

    // 2. Discover local AGY account homes
    if (!fs.existsSync(this.fleetRoot)) {
      this.logger.warn({ fleetRoot: this.fleetRoot }, "Fleet root directory not found on disk");
      return;
    }

    const entries = fs.readdirSync(this.fleetRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;

      const nodeDir = path.join(this.fleetRoot, ent.name);
      const isKnownNode = [
        "pro-1",
        "ultra-2",
        "binhthuong",
        "sunward",
        "justaskgao",
        "codegeekvn",
        "gaopham",
        "insilos",
        "ai-digimate",
        "team-3",
        "node-4",
        "node-5",
        "node-6",
        "zenonmind",
      ].includes(ent.name);

      if (!isKnownNode) continue;

      // Classify tier based on account and hardware role
      const isUltraFallback = ["binhthuong", "sunward", "justaskgao"].includes(ent.name);
      const isUltraPro = ["pro-1", "ultra-2"].includes(ent.name);
      const tier = isUltraFallback || isUltraPro ? "ultra" : "pro";

      const defaultCaps = [
        "gemini-3.8-flash-high",
        "gemini-3.8-flash-medium",
        "gemini-3.1-pro-high",
        "tools",
      ];
      if (isUltraFallback) {
        defaultCaps.unshift("claude-opus-5-5-high", "claude-opus-4-6-thinking");
      }

      this.registerNode({
        id: ent.name,
        kind: "agy",
        tier,
        homeDirectory: nodeDir,
        caps: defaultCaps,
        preferredModel: isUltraFallback ? "claude-opus-5-5-high" : "gemini-3.8-flash-high",
        maxConcurrency: 2,
        proxyId: `proxy-${ent.name}`,
      });
    }

    this.logger.info({ registeredCount: this.nodes.size }, "Auto-discovered fleet nodes");
  }

  private startHeartbeatLoop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const node of this.nodes.values()) {
        // Automatically recover throttled nodes after cooldown (60s)
        if (node.state === "throttled" && now - node.lastHeartbeat > 60_000) {
          this.updateNodeState(node.config.id, "ready");
        }
      }
      this.syncStealthQuotas().catch(() => undefined);
    }, 15_000);
  }

  public async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
