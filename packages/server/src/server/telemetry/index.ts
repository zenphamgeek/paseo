import type { Logger } from "pino";
import { getEgressProxyManager, type EgressPoolStatus } from "../egress/index.js";
import { getHermesManager, type HermesHealthStatus } from "../hermes/index.js";
import { getDualOnnxEngine, type BreakerState } from "../onnx/index.js";
import { getTelegramAlerter, type TelegramAlerter } from "./telegram-alerter.js";

export * from "./telegram-alerter.js";

export interface DualOnnxTelemetry {
  clefBreakerState: BreakerState;
  clefFailureCount: number;
  semanticMemoriesCount: number;
  unconsolidatedEpisodesCount: number;
  driftStatus: string;
  tokenomicsLocalDecisions: number;
  tokenomicsEstimatedSavingsUsd: number;
}

export interface NodeHealthSnapshot {
  name: string;
  status: string;
  tier: string;
  accountEmail?: string;
  geminiQuotaPercent?: number;
  claudeQuotaPercent?: number;
  activeJobs: number;
  requestsServed: number;
  errorCount: number;
}

export interface SwarmTelemetrySnapshot {
  timestamp: number;
  clusterStatus: "healthy" | "degraded" | "critical";
  onlineNodes: number;
  totalNodes: number;
  nodes: NodeHealthSnapshot[];
  dualOnnx: DualOnnxTelemetry;
  egress: EgressPoolStatus;
  hermes: HermesHealthStatus;
  telegram: {
    enabled: boolean;
    chatId: string;
    botName?: string;
    hasToken: boolean;
  };
}

export class TelemetryHub {
  private readonly telegramAlerter: TelegramAlerter;
  private readonly logger?: Logger;
  private tokenomicsSavingsCounter = 0;
  private localDecisionsCounter = 0;

  constructor(options?: { logger?: Logger }) {
    this.logger = options?.logger?.child({ module: "telemetry-hub" });
    this.logger?.debug("TelemetryHub initialized");
    this.telegramAlerter = getTelegramAlerter();
  }

  public recordLocalDecision(tokensEstimate: number): void {
    this.localDecisionsCounter += 1;
    // Estimated $0.000015 per token saved compared to Cloud LLM
    this.tokenomicsSavingsCounter += tokensEstimate * 0.000015;
    this.logger?.debug({ tokensEstimate }, "Recorded local tokenomics decision");
  }

  public async fetchFleetNodes(): Promise<{
    nodes: NodeHealthSnapshot[];
    online: number;
    total: number;
  }> {
    try {
      const res = await fetch("http://127.0.0.1:7777/api/fleet/status", {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as {
        nodes?: Array<{
          name: string;
          status: string;
          tier: string;
          account_email?: string;
          gemini_quota_percent?: number;
          claude_quota_percent?: number;
          active_jobs?: number;
          requests_served?: number;
          error_count?: number;
        }>;
      };

      const rawNodes = json.nodes || [];
      const nodes: NodeHealthSnapshot[] = rawNodes.map((n) => ({
        name: n.name,
        status: n.status,
        tier: n.tier,
        accountEmail: n.account_email,
        geminiQuotaPercent: n.gemini_quota_percent,
        claudeQuotaPercent: n.claude_quota_percent,
        activeJobs: n.active_jobs ?? 0,
        requestsServed: n.requests_served ?? 0,
        errorCount: n.error_count ?? 0,
      }));

      const online = nodes.filter(
        (n) => n.status === "ready" || n.status === "idle" || n.status === "busy",
      ).length;
      return { nodes, online, total: nodes.length };
    } catch {
      return { nodes: [], online: 0, total: 0 };
    }
  }

  public async getTelemetrySnapshot(): Promise<SwarmTelemetrySnapshot> {
    const onnxEngine = getDualOnnxEngine();
    const egressMgr = getEgressProxyManager();
    const hermesMgr = getHermesManager();

    const [fleetData, egressPool, hermesHealth] = await Promise.all([
      this.fetchFleetNodes(),
      egressMgr.getPoolStatus(),
      hermesMgr.getHealthStatus(),
    ]);

    const clefBreaker = onnxEngine.upstreamClef.getBreakerState();
    const clefFailures = onnxEngine.upstreamClef.getFailureCount();
    const memories = onnxEngine.memoryConsolidator.getAllSemanticMemories();
    const unconsolidated = onnxEngine.memoryConsolidator.getUnconsolidatedEpisodes();

    // Check cluster health
    let clusterStatus: "healthy" | "degraded" | "critical" = "healthy";
    if (clefBreaker === "OPEN" || egressPool.healthyCount === 0) {
      clusterStatus = "critical";
    } else if (clefBreaker === "HALF_OPEN" || egressPool.healthyCount < egressPool.poolSize / 2) {
      clusterStatus = "degraded";
    }

    // Auto-evaluate triggers for Telegram alerts
    if (clefBreaker === "OPEN") {
      void this.telegramAlerter.dispatchAlert({
        alertKey: "onnx:clef:breaker_open",
        severity: "critical",
        title: "Clef Circuit Breaker OPEN — Local Fallback Engaged",
        source: "onnx",
        evidence: {
          consecutiveFailures: clefFailures,
          upstream: "Cloudflare/clef",
          action: "Local ONNX heuristic fallback active",
        },
      });
    }

    if (egressPool.healthyCount === 0) {
      void this.telegramAlerter.dispatchAlert({
        alertKey: "proxy:egress:no_healthy_slots",
        severity: "critical",
        title: "Egress Proxy Pool Exhausted — 0 of 16 Slots Available",
        source: "proxy",
        evidence: {
          poolSize: egressPool.poolSize,
          strategy: egressPool.strategy,
          action: "Direct requests blocked to preserve NO_PROXY policy",
        },
      });
    }

    return {
      timestamp: Date.now(),
      clusterStatus,
      onlineNodes: fleetData.online,
      totalNodes: fleetData.total,
      nodes: fleetData.nodes,
      dualOnnx: {
        clefBreakerState: clefBreaker,
        clefFailureCount: clefFailures,
        semanticMemoriesCount: memories.length,
        unconsolidatedEpisodesCount: unconsolidated.length,
        driftStatus: "stable",
        tokenomicsLocalDecisions: this.localDecisionsCounter,
        tokenomicsEstimatedSavingsUsd: Math.round(this.tokenomicsSavingsCounter * 100) / 100,
      },
      egress: egressPool,
      hermes: hermesHealth,
      telegram: this.telegramAlerter.getConfig(),
    };
  }

  public getTelegramAlerter(): TelegramAlerter {
    return this.telegramAlerter;
  }
}

let hubInstance: TelemetryHub | null = null;

export function getTelemetryHub(): TelemetryHub {
  if (!hubInstance) {
    hubInstance = new TelemetryHub();
  }
  return hubInstance;
}
