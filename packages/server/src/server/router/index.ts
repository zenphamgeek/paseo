import type { Logger } from "pino";
import type { RouteDecision, RouteRequest } from "@getpaseo/protocol/fleet-types";
import { type FleetRegistry, getFleetRegistry } from "../fleet/registry.js";
import { TokenomicsAdmissionController } from "../onnx/index.js";

export interface LatencyEWMA {
  valueMs: number;
  alpha: number;
}

export const NINE_ROUTER_ALLOWED_MODELS = [
  "codex",
  "cx/gpt-5.6-terra",
  "cx/gpt-5.5",
  "sol",
  "luna",
  "deepseek-v4-flash",
  "deepseek-r1-distill-qwen-32b",
  "opencode/fledge-alpha-free",
] as const;

export function isClaudeOrOpusTarget(req: RouteRequest): boolean {
  const capMatch = req.requiredCaps?.some((c) => /claude|opus|sonnet|haiku|anthropic/i.test(c));
  const promptMatch = req.prompt ? /claude|opus|sonnet|haiku|anthropic/i.test(req.prompt) : false;
  return Boolean(capMatch || promptMatch);
}

export function isPlanningTarget(req: RouteRequest): boolean {
  const capMatch = req.requiredCaps?.includes("planning");
  const promptMatch = req.prompt ? /plan|decompose|subtask|breakdown/i.test(req.prompt) : false;
  return Boolean(capMatch || promptMatch);
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
    // 9router is STRICTLY EXCLUDED here as it does not serve Claude/Opus.

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

  private routeProTier(req: RouteRequest): RouteDecision {
    // Pro Tier: Filter candidate nodes, score by Surplus-Quota-First & Anti-Starvation
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

    const reviewer = this.registry.getPeriodicQuotaReviewer();
    const isClaudeTarget = isClaudeOrOpusTarget(req);
    const isPlanTarget = isPlanningTarget(req);

    // CRITICAL INVARIANT: 9router can NEVER serve Claude or Opus models!
    // Filter out 9router if Claude/Opus is requested.
    const candidates = allCandidates.filter((node) => {
      if (node.config.id === "9router" && isClaudeTarget) {
        return false; // Hard block: Claude / Opus can NEVER route to 9router
      }
      return true;
    });

    if (candidates.length === 0) {
      return {
        nodeId: "nebula",
        model: "claude-opus-4.8",
        fallbackChain: [{ nodeId: "binhthuong", model: "claude-opus-5-5-high" }],
      };
    }

    // Rank candidates: higher score = higher priority
    const scored = candidates.map((node) => {
      const audit = reviewer.getNodeAudit(node.config.id);

      // If 9router is handling a planning task, give it a dedicated planning boost using allowed models
      if (node.config.id === "9router" && isPlanTarget && !isClaudeTarget) {
        return { node, score: 95, audit };
      }

      const hasClaudeCap =
        node.config.caps.some((c) => /claude|opus|sonnet/i.test(c)) ||
        /claude|opus|sonnet/i.test(node.config.preferredModel || "");

      const quotaPercent = isClaudeTarget
        ? hasClaudeCap
          ? (node.claudeQuotaPercent ?? node.quota.quotaPercent)
          : 0
        : (node.geminiQuotaPercent ?? node.quota.quotaPercent);

      // If quota is exhausted for the requested engine, heavily penalize
      if (quotaPercent <= 5) {
        return { node, score: -1000, audit };
      }

      const surplusWeight = (quotaPercent / 100) * 55; // up to 55 pts
      const starvationWeight = (audit?.starvationFactor ?? 0) * 35; // up to 35 pts
      const trustWeight = ((node.trustScore ?? 1.0) / 1.0) * 10; // up to 10 pts
      const loadPenalty = node.activeJobs * 25; // penalty for busy jobs

      const stats = this.latencyStats.get(node.config.id) || { valueMs: 800, alpha: 0.2 };
      const latencyPenalty = Math.min(10, (stats.valueMs / 2000) * 10);

      const score = surplusWeight + starvationWeight + trustWeight - loadPenalty - latencyPenalty;
      return { node, score, audit };
    });

    // Sort descending: highest surplus & starved nodes win
    scored.sort((a, b) => b.score - a.score);

    const primaryEntry = scored[0];
    const primary = primaryEntry.node;
    const resolveModelForNode = (n: typeof primary, a?: typeof primaryEntry.audit) => {
      // INVARIANT: 9router ONLY serves setup allowed models. NEVER Claude or Opus.
      if (n.config.id === "9router") {
        if (isPlanTarget) {
          return "cx/gpt-5.6-terra";
        }
        if (
          n.config.preferredModel &&
          (NINE_ROUTER_ALLOWED_MODELS as readonly string[]).includes(n.config.preferredModel)
        ) {
          return n.config.preferredModel;
        }
        return "codex";
      }

      if (
        a?.recommendedRole === "claude_priority" ||
        (isClaudeTarget &&
          ((n.claudeQuotaPercent ?? 0) > 50 ||
            n.config.caps.some((c) => /claude|opus/i.test(c)) ||
            /claude|opus/i.test(n.config.preferredModel || "")))
      ) {
        return n.config.preferredModel && /claude|opus/i.test(n.config.preferredModel)
          ? n.config.preferredModel
          : "claude-opus-5-5-high";
      }
      return n.config.preferredModel || "gemini-3.8-flash-high";
    };

    const primaryModel = resolveModelForNode(primary, primaryEntry.audit);

    const fallbacks = scored
      .slice(1, 5)
      .filter((s) => !(s.node.config.id === "9router" && isClaudeTarget))
      .map((s) => ({
        nodeId: s.node.config.id,
        model: resolveModelForNode(s.node, s.audit),
      }));

    // If fallbacks are empty, append standard nodes
    if (fallbacks.length === 0) {
      fallbacks.push({ nodeId: "ultra-2", model: "gemini-3.8-flash-high" });
    }

    return {
      nodeId: primary.config.id,
      model: primaryModel,
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

    // INVARIANT: 9router can never be assigned a Claude or Opus model during failover
    if (next.nodeId === "9router" && /claude|opus|sonnet|anthropic/i.test(next.model)) {
      this.logger.warn(
        { nextNodeId: next.nodeId, model: next.model },
        "Prevented Claude/Opus assignment to 9router in failover, shifting to next fallback",
      );
      if (remaining.length > 0) {
        const [advancedNext, ...advancedRemaining] = remaining;
        return {
          nodeId: advancedNext.nodeId,
          model: advancedNext.model,
          fallbackChain: advancedRemaining,
        };
      }
      return {
        nodeId: "binhthuong",
        model: "claude-opus-5-5-high",
        fallbackChain: [],
      };
    }

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

let defaultNineRouter: NineRouter | null = null;

export function getNineRouter(options?: { registry?: FleetRegistry; logger?: Logger }): NineRouter {
  if (!defaultNineRouter) {
    const registry = options?.registry ?? getFleetRegistry({ logger: options?.logger });
    const logger = options?.logger ?? registry.getLogger();
    defaultNineRouter = new NineRouter({ registry, logger });
  }
  return defaultNineRouter;
}

export function setNineRouter(router: NineRouter): void {
  defaultNineRouter = router;
}
