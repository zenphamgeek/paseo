import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import type {
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

  private summarizeNode(runtime: FleetNodeRuntime): FleetNodeSummary {
    return {
      id: runtime.config.id,
      kind: runtime.config.kind,
      tier: runtime.config.tier,
      state: runtime.state,
      accountEmail: runtime.config.accountEmail,
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

      if (!isKnownNode && ent.name === "nebula") continue;

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
    }, 15_000);
  }

  public async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
