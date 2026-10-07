import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import pino, { type Logger } from "pino";
import type {
  FleetClusterSummary,
  FleetJobRecord,
  FleetNodeConfig,
  FleetNodeRuntime,
  FleetNodeSummary,
  NodeState,
  QuotaSnapshot,
} from "./types.js";
import { getFleetAnalyticsDatabase } from "./fleet-analytics-db.js";
import { getCloudflareFreePoolRouter } from "../onnx/cloudflare-free-pool-router.js";
import { PeriodicQuotaReviewer, type PeriodicQuotaAuditResult } from "./periodic-quota-reviewer.js";

const DEFAULT_FLEET_ROOT = "/home/zen/agy-fleet";

export class FleetRegistry extends EventEmitter {
  private readonly nodes = new Map<string, FleetNodeRuntime>();
  private readonly logger: Logger;
  private readonly fleetRoot: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isHeartbeatRunning = false;
  private quotaReviewer: PeriodicQuotaReviewer | null = null;

  constructor(options: { logger: Logger; fleetRoot?: string }) {
    super();
    this.logger = options.logger.child({ module: "fleet-registry" });
    this.fleetRoot = options.fleetRoot || process.env.FLEET_DIR || DEFAULT_FLEET_ROOT;
  }

  public async initialize(): Promise<void> {
    this.logger.info({ root: this.fleetRoot }, "Initializing Zencode Fleet Registry");
    await this.autoDiscoverNodes();
    await this.syncStealthQuotas();
    this.quotaReviewer = new PeriodicQuotaReviewer({
      registry: this,
      logger: this.logger,
    });
    this.quotaReviewer.start();
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

  public getAllNodes(timeRange: "1h" | "24h" | "7d" | "30d" | "all" = "24h"): FleetNodeSummary[] {
    let statsMap: Map<
      string,
      { requestsServed: number; errorCount: number; tokensConsumed: number; usdSaved: number }
    > | null = null;
    try {
      const analyticsDb = getFleetAnalyticsDatabase();
      statsMap = analyticsDb.getNodeStatsMap(timeRange);
    } catch {
      // fallback to in-memory stats
    }

    return Array.from(this.nodes.values()).map((r) => {
      const summary = this.summarizeNode(r);
      if (statsMap) {
        const s = statsMap.get(r.config.id);
        if (s) {
          summary.requestsServed = s.requestsServed;
          summary.errorCount = s.errorCount;
          summary.tokensConsumed = s.tokensConsumed;
          summary.usdSaved = s.usdSaved;
        }
      }
      summary.retentionPeriod = timeRange;
      return summary;
    });
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

    const agyNodes = all.filter((n) => n.config.kind === "agy" || n.config.kind === "nebula");
    const opencodeNodes = all.filter((n) => n.config.kind === "opencode");

    return {
      totalNodes: all.length,
      onlineNodes: online.length,
      busyNodes: busy.length,
      ultraNodes: ultra.length,
      proNodes: pro.length,
      agyNodes: agyNodes.length,
      opencodeNodes: opencodeNodes.length,
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
      getFleetAnalyticsDatabase().syncFromPassiveLedger();
    } catch {
      // ignore
    }

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
            gemini_decay_remaining_s?: number;
            claude_decay_remaining_s?: number;
            gemini_reset_countdown_s?: number;
            claude_reset_countdown_s?: number;
            total_tokens_consumed?: number;
            tier_capacity_tokens?: number;
            status?: string;
            label?: string | null;
            domain_specialization?: string[];
            trust_score?: number;
            ineligible?: boolean;
            ineligible_reason?: string | null;
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
        if (typeof (q.gemini_decay_remaining_s ?? q.gemini_reset_countdown_s) === "number") {
          node.geminiResetCountdownS = q.gemini_decay_remaining_s ?? q.gemini_reset_countdown_s;
        }
        if (typeof (q.claude_decay_remaining_s ?? q.claude_reset_countdown_s) === "number") {
          node.claudeResetCountdownS = q.claude_decay_remaining_s ?? q.claude_reset_countdown_s;
        }
        if (q.label !== undefined) node.label = q.label;
        if (q.domain_specialization) node.domainSpecialization = q.domain_specialization;
        if (typeof q.trust_score === "number") node.trustScore = q.trust_score;
        if (q.ineligible !== undefined) node.ineligible = q.ineligible;
        if (q.ineligible_reason !== undefined) node.ineligibleReason = q.ineligible_reason;

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

  public summarizeNode(runtime: FleetNodeRuntime): FleetNodeSummary {
    return {
      id: runtime.config.id,
      displayName: runtime.config.displayName ?? runtime.config.id,
      kind: runtime.config.kind,
      tier: runtime.config.tier,
      state: runtime.state,
      accountEmail: runtime.config.accountEmail,
      caps: runtime.config.caps,
      preferredModel: runtime.config.preferredModel,
      allowedModels: runtime.config.allowedModels,
      proxyId: runtime.config.proxyId,
      geminiQuotaPercent:
        runtime.config.kind === "opencode"
          ? 100
          : (runtime.geminiQuotaPercent ?? (runtime.config.tier === "ultra" ? 100 : 75)),
      claudeQuotaPercent:
        runtime.config.id === "9router"
          ? 0 // 9router never serves Claude or Opus
          : runtime.config.kind === "opencode"
            ? 100
            : (runtime.claudeQuotaPercent ??
              (runtime.config.caps.some((c) => c.includes("opus") || c.includes("claude"))
                ? 98
                : 0)),
      geminiResetTime: runtime.geminiResetTime ?? null,
      claudeResetTime: runtime.claudeResetTime ?? null,
      geminiResetCountdownS: runtime.geminiResetCountdownS,
      claudeResetCountdownS: runtime.claudeResetCountdownS,
      label: runtime.label,
      domainSpecialization: runtime.domainSpecialization,
      trustScore: runtime.trustScore,
      ineligible: runtime.ineligible,
      ineligibleReason: runtime.ineligibleReason,
      quota: runtime.quota,
      activeJobs: runtime.activeJobs,
      requestsServed: runtime.requestsServed,
      errorCount: runtime.errorCount,
      lastHeartbeat: runtime.lastHeartbeat,
    };
  }

  private extractAgyNodeIdentity(
    nodeName: string,
    nodeDir: string,
  ): { accountEmail: string; displayName: string } {
    const CANONICAL_MAP: Record<string, { email: string; displayName: string }> = {
      "team-3": { email: "coderedgen@gmail.com", displayName: "coderedgen" },
      "pro-1": { email: "innoria.team@gmail.com", displayName: "innoria.team" },
      "ultra-2": { email: "lthn.ariana@gmail.com", displayName: "lthn.Ariana" },
      "node-4": { email: "just.ask.mr.zen@gmail.com", displayName: "just.ask.mr.zen" },
      "node-5": { email: "zenphamgeek@gmail.com", displayName: "zenphamgeek" },
      "node-6": { email: "zeninallgeek@gmail.com", displayName: "zeninallgeek" },
      "ai-digimate": { email: "ai.digimate@gmail.com", displayName: "ai-digimate" },
      codegeekvn: { email: "codegeekvn@gmail.com", displayName: "codegeekvn" },
      sunward: { email: "sunwardpham@gmail.com", displayName: "sunward" },
      gaopham: { email: "gaopham83@gmail.com", displayName: "gaopham83" },
      insilos: { email: "inteligentsilos@gmail.com", displayName: "insilos" },
      binhthuong: { email: "binhthuongcarpediem@gmail.com", displayName: "binhthuong" },
      justaskgao: { email: "justaskgao@gmail.com", displayName: "justaskgao" },
      zenonmind: { email: "zenonmind@gmail.com", displayName: "zenonmind" },
    };

    const known = CANONICAL_MAP[nodeName];
    let accountEmail = known?.email;
    let displayName = known?.displayName ?? nodeName;

    const tokenPath = path.join(nodeDir, ".gemini", "antigravity-cli", "antigravity-oauth-token");
    if (fs.existsSync(tokenPath)) {
      try {
        const raw = fs.readFileSync(tokenPath, "utf-8");
        const data = JSON.parse(raw);
        if (data.id_token && typeof data.id_token === "string" && data.id_token.includes(".")) {
          const payloadB64 = data.id_token.split(".")[1];
          const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
          const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
          if (payload.email) {
            accountEmail = payload.email;
            if (!known) {
              displayName = payload.email.split("@")[0];
            }
          }
        }
      } catch {
        // fallback
      }
    }

    const cfgPath = path.join(nodeDir, ".node_config.json");
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
        if (cfg.display_name) displayName = cfg.display_name;
      } catch {
        // ignore
      }
    }

    return {
      accountEmail: accountEmail ?? `${nodeName}@gmail.com`,
      displayName,
    };
  }

  private async autoDiscoverNodes(): Promise<void> {
    // 1. Primary Ultra node: Nebula (B.AI Direct / Opus 4.8)
    this.registerNode({
      id: "nebula",
      displayName: "nebula",
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

      // Classify tier based on account and hardware role: Exactly 2 Ultra CLI nodes (pro-1, ultra-2) + 12 Pro nodes
      const isUltra = ["pro-1", "ultra-2"].includes(ent.name);
      const tier = isUltra ? "ultra" : "pro";

      const defaultCaps = [
        "gemini-3.8-flash-high",
        "gemini-3.8-flash-medium",
        "gemini-3.1-pro-high",
        "claude-sonnet-5-5-high",
        "claude-opus-4-6-thinking",
        "tools",
      ];
      if (isUltra) {
        defaultCaps.unshift("claude-opus-5-5-high");
      }

      const { accountEmail, displayName } = this.extractAgyNodeIdentity(ent.name, nodeDir);

      this.registerNode({
        id: ent.name,
        displayName,
        kind: "agy",
        tier,
        accountEmail,
        homeDirectory: nodeDir,
        caps: defaultCaps,
        preferredModel: isUltra ? "claude-opus-5-5-high" : "gemini-3.8-flash-high",
        maxConcurrency: 2,
        proxyId: `proxy-${ent.name}`,
      });
    }

    // 3. Discover OpenCode fleet nodes from /home/zen/opencode-fleet/nodes
    const opencodeNodesDir = path.join("/home/zen/opencode-fleet/nodes");
    if (fs.existsSync(opencodeNodesDir)) {
      const ocEntries = fs.readdirSync(opencodeNodesDir, { withFileTypes: true });
      const OC_CANONICAL_MAP: Record<string, { email: string; displayName: string }> = {
        "oc_team-3": { email: "coderedgen@gmail.com", displayName: "oc_coderedgen" },
        "oc_pro-1": { email: "innoria.team@gmail.com", displayName: "oc_innoria.team" },
        "oc_ultra-2": { email: "lthn.ariana@gmail.com", displayName: "oc_lthn.ariana" },
        "oc_node-4": { email: "just.ask.mr.zen@gmail.com", displayName: "oc_just.ask.mr.zen" },
        "oc_node-5": { email: "zenphamgeek@gmail.com", displayName: "oc_zenphamgeek" },
        "oc_node-6": { email: "zeninallgeek@gmail.com", displayName: "oc_zeninallgeek" },
      };

      for (const ent of ocEntries) {
        if (!ent.isDirectory() || !ent.name.startsWith("oc_")) continue;

        const nodeDir = path.join(opencodeNodesDir, ent.name);
        const ocKnown = OC_CANONICAL_MAP[ent.name];
        let accountEmail = ocKnown?.email ?? `${ent.name}@fleet.local`;
        let displayName = ocKnown?.displayName ?? ent.name;

        const metaPath = path.join(nodeDir, "node_metadata.json");
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            if (meta.account_email) {
              accountEmail = meta.account_email;
              if (!ocKnown) {
                displayName = `oc_${meta.account_email.split("@")[0]}`;
              }
            }
          } catch {
            // ignore
          }
        }

        this.registerNode({
          id: ent.name,
          displayName,
          kind: "opencode",
          tier: "pro",
          homeDirectory: nodeDir,
          accountEmail,
          caps: [
            "opencode/fledge-alpha-free",
            "opencode/ling-3.1-flash-free",
            "opencode/nemotron-3.5-lightning-free",
            "deepseek-v4-flash",
            "free_quota",
            "tools",
          ],
          preferredModel: "opencode/fledge-alpha-free",
          maxConcurrency: 2,
          proxyId: `proxy-${ent.name}`,
        });
      }
    }

    // 4. Register 9router API Codex pool node (Strictly allowed models only, NO Claude or Opus)
    const NINE_ROUTER_ALLOWED_MODELS = [
      "codex",
      "cx/gpt-5.6-terra",
      "cx/gpt-5.5",
      "sol",
      "luna",
      "deepseek-v4-flash",
      "deepseek-r1-distill-qwen-32b",
      "opencode/fledge-alpha-free",
    ];

    this.registerNode({
      id: "9router",
      displayName: "9router Codex & Plan Engine",
      kind: "codex",
      tier: "pro",
      accountEmail: "codex-free-quota@9router.local",
      homeDirectory: "/home/zen/.9router",
      caps: [
        "codex",
        "sol",
        "luna",
        "cx/gpt-5.6-terra",
        "cx/gpt-5.5",
        "deepseek-v4-flash",
        "free_quota",
        "tools",
        "planning",
      ],
      allowedModels: NINE_ROUTER_ALLOWED_MODELS,
      preferredModel: "codex",
      maxConcurrency: 4,
      proxyId: "proxy-9router",
    });

    // 5. Register Cloudflare Free Pool Swarm node (10,000 Neurons/day per account)
    try {
      const cfRouter = getCloudflareFreePoolRouter();
      const stats = cfRouter.getPoolStats();
      this.registerNode({
        id: "cf-free-swarm",
        displayName: "Cloudflare Free Swarm",
        kind: "opencode",
        tier: "pro",
        accountEmail: `pool-${stats.totalAccounts}-accounts@cloudflare.free`,
        homeDirectory: "/home/zen/.zencode",
        caps: [
          "cf-workers-ai",
          "@cf/meta/llama-3.1-8b-instruct",
          "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
          "clef-system-one",
          "10k-neurons-free",
          "stealth-jitter",
          "local-9b-fallback",
        ],
        preferredModel: "@cf/meta/llama-3.1-8b-instruct",
        maxConcurrency: Math.max(2, stats.totalAccounts * 2),
        proxyId: "proxy-cf-swarm",
      });
      this.updateQuota("cf-free-swarm", {
        usedTokens: stats.totalNeuronsUsedToday,
        tokenLimit: stats.totalDailyPoolNeurons,
        quotaPercent:
          stats.totalDailyPoolNeurons > 0
            ? Math.round((stats.totalNeuronsRemainingToday / stats.totalDailyPoolNeurons) * 100)
            : 100,
        resetsAt: null,
        lastCheckedAt: Date.now(),
      });
    } catch (err) {
      this.logger.warn({ err }, "Could not register Cloudflare Free Swarm node");
    }

    this.logger.info({ registeredCount: this.nodes.size }, "Auto-discovered fleet nodes");
  }

  private scheduleNextHeartbeat(): void {
    if (!this.isHeartbeatRunning) return;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Sovereign Stealth Deperiodic Jitter: uniform distribution in [12_000ms, 18_000ms]
    // Replaces static setInterval with dynamic timer rescheduling to eliminate periodic clock footprints
    const jitterMs = Math.floor(12_000 + Math.random() * (18_000 - 12_000 + 1));
    this.heartbeatTimer = setTimeout(async () => {
      try {
        const now = Date.now();
        for (const node of this.nodes.values()) {
          // Automatically recover throttled nodes after cooldown (60s)
          if (node.state === "throttled" && now - node.lastHeartbeat > 60_000) {
            this.updateNodeState(node.config.id, "ready");
          }
        }
        await this.syncStealthQuotas().catch(() => undefined);
      } catch (err) {
        this.logger.warn({ err }, "Error in fleet heartbeat/stealth sync cycle");
      } finally {
        if (this.isHeartbeatRunning) {
          this.scheduleNextHeartbeat();
        }
      }
    }, jitterMs);
  }

  private startHeartbeatLoop(): void {
    this.isHeartbeatRunning = true;
    this.scheduleNextHeartbeat();
  }

  public getPeriodicQuotaReviewer(): PeriodicQuotaReviewer {
    if (!this.quotaReviewer) {
      this.quotaReviewer = new PeriodicQuotaReviewer({
        registry: this,
        logger: this.logger,
      });
    }
    return this.quotaReviewer;
  }

  public auditClusterQuotas(): PeriodicQuotaAuditResult {
    return this.getPeriodicQuotaReviewer().auditClusterQuotas();
  }

  public getLogger(): Logger {
    return this.logger;
  }

  public async shutdown(): Promise<void> {
    this.isHeartbeatRunning = false;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.quotaReviewer) {
      this.quotaReviewer.stop();
    }
  }
}

let defaultFleetRegistry: FleetRegistry | null = null;

export function getFleetRegistry(options?: { logger?: Logger; fleetRoot?: string }): FleetRegistry {
  if (!defaultFleetRegistry) {
    const logger = options?.logger ?? pino({ level: "info" });
    defaultFleetRegistry = new FleetRegistry({ logger, fleetRoot: options?.fleetRoot });
  }
  return defaultFleetRegistry;
}

export function setFleetRegistry(registry: FleetRegistry): void {
  defaultFleetRegistry = registry;
}
