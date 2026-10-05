import type { Logger } from "pino";
import type { RouteDecision, RouteRequest } from "@getpaseo/protocol/fleet-types";
import type { FleetRegistry } from "../fleet/registry.js";
import { TokenomicsAdmissionController } from "../onnx/index.js";

export interface LatencyEWMA {
  valueMs: number;
  alpha: number;
}

export class NineRouter {
  private readonly registry: FleetRegistry;
  private readonly logger: Logger;
  private readonly latencyStats = new Map<string, LatencyEWMA>();
  private readonly admissionController: TokenomicsAdmissionController;

  constructor(options: { registry: FleetRegistry; logger: Logger }) {
    this.registry = options.registry;
    this.logger = options.logger.child({ module: "nine-router" });
    this.admissionController = new TokenomicsAdmissionController();
  }

  public getAdmissionController(): TokenomicsAdmissionController {
    return this.admissionController;
  }

  public route(req: RouteRequest): RouteDecision {
    const admission = this.admissionController.evaluateAdmission({
      taskId: req.taskId,
      prompt: req.prompt,
      estimatedTokens: req.tokensEstimate,
      preferredTier: req.preferredTier === "standard" ? "local" : req.preferredTier,
    });

    this.logger.info(
      {
        taskId: req.taskId,
        tier: req.preferredTier,
        tokensEstimate: req.tokensEstimate,
        admissionDecision: admission.decision,
        billedCost: admission.billedCost,
      },
      "Calculating optimal route decision with tokenomics admission",
    );

    // 1. Build prioritized fallback cascade based on tier
    if (req.preferredTier === "ultra") {
      return this.routeUltraTier(req);
    }

    return this.routeProTier(req);
  }

  private routeUltraTier(_req: RouteRequest): RouteDecision {
    // Ultra Tier Cascade:
    // 1. Primary: nebula (Claude Opus 4.8 via Direct API)
    // 2. Fallback 1: binhthuong (Claude Opus 5.5 High)
    // 3. Fallback 2: sunward (Claude Opus 5.5 High)
    // 4. Fallback 3: justaskgao (Claude Opus 5.5 High)
    // 5. Emergency: pro-1 (Gemini 3.8 Flash High)

    const nebula = this.registry.getNode("nebula");
    const nebulaAvailable =
      nebula &&
      (nebula.state === "ready" || nebula.state === "busy") &&
      nebula.activeJobs < nebula.config.maxConcurrency;

    const primaryNodeId = nebulaAvailable ? "nebula" : "binhthuong";
    const primaryModel = nebulaAvailable ? "claude-opus-4.8" : "claude-opus-5-5-high";

    const fallbackChain = [
      { nodeId: "binhthuong", model: "claude-opus-5-5-high" },
      { nodeId: "sunward", model: "claude-opus-5-5-high" },
      { nodeId: "justaskgao", model: "claude-opus-5-5-high" },
      { nodeId: "pro-1", model: "gemini-3.8-flash-high" },
      { nodeId: "ultra-2", model: "gemini-3.8-flash-high" },
    ].filter((entry) => entry.nodeId !== primaryNodeId);

    return {
      nodeId: primaryNodeId,
      model: primaryModel,
      fallbackChain,
    };
  }

  private routeProTier(_req: RouteRequest): RouteDecision {
    // Pro Tier: Filter candidate nodes, score by (remaining quota / latency EWMA)
    const proNodes = this.registry.getAvailableNodes("pro");
    const ultraProNodes = this.registry
      .getAvailableNodes("ultra")
      .filter((n) => n.config.kind === "agy");
    const allCandidates = [...proNodes, ...ultraProNodes];

    if (allCandidates.length === 0) {
      // Emergency fallback to nebula
      return {
        nodeId: "nebula",
        model: "claude-sonnet-5",
        fallbackChain: [{ nodeId: "pro-1", model: "gemini-3.8-flash-high" }],
      };
    }

    // Rank candidates by lowest active jobs and lowest EWMA latency
    const scored = allCandidates.map((node) => {
      const stats = this.latencyStats.get(node.config.id) || { valueMs: 1500, alpha: 0.2 };
      const score = (node.activeJobs + 1) * stats.valueMs;
      return { node, score };
    });

    scored.sort((a, b) => a.score - b.score);

    const primary = scored[0].node;
    const fallbacks = scored.slice(1, 4).map((s) => ({
      nodeId: s.node.config.id,
      model: s.node.config.preferredModel || "gemini-3.8-flash-high",
    }));

    // If fallbacks are empty, append standard nodes
    if (fallbacks.length === 0) {
      fallbacks.push({ nodeId: "ultra-2", model: "gemini-3.8-flash-high" });
    }

    return {
      nodeId: primary.config.id,
      model: primary.config.preferredModel || "gemini-3.8-flash-high",
      fallbackChain: fallbacks,
    };
  }

  public reportOutcome(
    decision: RouteDecision,
    outcome: { success: boolean; latencyMs: number; errorKind?: string },
  ): void {
    const prev = this.latencyStats.get(decision.nodeId) || {
      valueMs: outcome.latencyMs,
      alpha: 0.2,
    };
    const updated = prev.valueMs * (1 - prev.alpha) + outcome.latencyMs * prev.alpha;
    this.latencyStats.set(decision.nodeId, { valueMs: updated, alpha: prev.alpha });

    this.registry.recordJobResult(decision.nodeId, outcome.success, outcome.errorKind);
  }

  public failover(current: RouteDecision, error: Error): RouteDecision | null {
    this.logger.warn(
      { failedNodeId: current.nodeId, error: error.message },
      "Triggering 9router sub-second failover",
    );

    // Mark current node as throttled/error
    const isQuotaOr429 = /429|quota|RESOURCE_EXHAUSTED/i.test(error.message);
    this.registry.recordJobResult(
      current.nodeId,
      false,
      isQuotaOr429 ? "quota_exhausted" : "failed",
    );

    if (current.fallbackChain.length === 0) {
      this.logger.error("No remaining nodes in fallback chain for failover");
      return null;
    }

    const [next, ...remaining] = current.fallbackChain;
    this.logger.info(
      { nextNodeId: next.nodeId, nextModel: next.model },
      "Failover advance succeeded",
    );

    return {
      nodeId: next.nodeId,
      model: next.model,
      fallbackChain: remaining,
    };
  }
}
