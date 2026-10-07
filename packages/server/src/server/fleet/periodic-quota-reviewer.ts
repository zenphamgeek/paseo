import type { Logger } from "pino";
import type { FleetRegistry } from "./registry.js";

export type RecommendedRoutingRole =
  | "claude_priority"
  | "gemini_priority"
  | "dual_priority"
  | "cooldown"
  | "standard";

export interface QuotaAuditNodeReport {
  nodeId: string;
  displayName: string;
  tier: string;
  kind: string;
  geminiQuotaPercent: number;
  claudeQuotaPercent: number;
  surplusQuotaPercent: number;
  requestsServed: number;
  activeJobs: number;
  isStarved: boolean;
  starvationFactor: number; // 0.0 to 1.0 (higher means more starved)
  priorityBoost: number; // 0.0 to 100.0
  recommendedRole: RecommendedRoutingRole;
  auditReason: string;
  lastAuditedAt: number;
  /** Acceptable estimation error margin for Stealth Mode trial planning (default: ±5%) */
  toleranceMarginPercent: number;
}

export interface PeriodicQuotaAuditResult {
  timestamp: number;
  totalNodesAudited: number;
  surplusNodesCount: number;
  starvedNodesCount: number;
  topSurplusNodes: string[];
  reports: Map<string, QuotaAuditNodeReport>;
  candidateScope?: string[];
  isCandidateOnly: boolean;
  nextScheduledDelayMs?: number;
}

/**
 * PeriodicQuotaReviewer
 *
 * Enforces Zencode Stealth Mode Invariants:
 * 1. Zero predictable periodic loops (anti-pattern 60s fixed interval ban).
 * 2. De-periodic randomized review intervals scattered uniformly between 480s and 600s (8 - 10 minutes).
 * 3. Dynamic setTimeout self-rescheduling with entropy on each cycle (no setInterval).
 * 4. Targeted Candidate-Only audits: only inspect candidate nodes when calculating dispatch/rebalancing.
 * 5. Stealth-Over-Precision: trial plan estimation accepts minor tolerance (±3% - 5%) without intrusive probing.
 */
export class PeriodicQuotaReviewer {
  private readonly registry: FleetRegistry;
  private readonly logger: Logger;
  private auditTimer: NodeJS.Timeout | null = null;
  private latestAuditResult: PeriodicQuotaAuditResult | null = null;
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private isRunning = false;

  constructor(options: {
    registry: FleetRegistry;
    logger: Logger;
    auditIntervalMs?: number;
    minIntervalMs?: number;
    maxIntervalMs?: number;
  }) {
    this.registry = options.registry;
    this.logger = options.logger.child({ module: "periodic-quota-reviewer" });

    if (options.auditIntervalMs !== undefined) {
      // Deterministic / test override
      this.minIntervalMs = options.auditIntervalMs;
      this.maxIntervalMs = options.auditIntervalMs;
    } else {
      // Sovereign Stealth Invariant: 480s to 600s (8 - 10 mins)
      this.minIntervalMs = options.minIntervalMs ?? 480_000;
      this.maxIntervalMs = options.maxIntervalMs ?? 600_000;
    }
  }

  /**
   * Generates a randomized deperiodic interval between minIntervalMs and maxIntervalMs.
   */
  public getRandomStealthIntervalMs(): number {
    if (this.minIntervalMs >= this.maxIntervalMs) {
      return this.minIntervalMs;
    }
    return Math.floor(
      this.minIntervalMs + Math.random() * (this.maxIntervalMs - this.minIntervalMs),
    );
  }

  public start(): void {
    if (this.isRunning) {
      this.stop();
    }
    this.isRunning = true;

    // Run initial baseline check on startup
    this.auditClusterQuotas();

    // Schedule next review with deperiodic random temporal jitter (480s - 600s)
    this.scheduleNextAudit();

    this.logger.info(
      { minIntervalMs: this.minIntervalMs, maxIntervalMs: this.maxIntervalMs },
      "Started Deperiodic Stealth Quota Reviewer (480s - 600s jitter window, candidate-targeted)",
    );
  }

  public stop(): void {
    this.isRunning = false;
    if (this.auditTimer) {
      clearTimeout(this.auditTimer);
      this.auditTimer = null;
      this.logger.info("Stopped Deperiodic Quota Reviewer Loop");
    }
  }

  private scheduleNextAudit(): void {
    if (!this.isRunning) return;

    if (this.auditTimer) {
      clearTimeout(this.auditTimer);
      this.auditTimer = null;
    }

    const nextDelayMs = this.getRandomStealthIntervalMs();
    this.auditTimer = setTimeout(() => {
      try {
        this.auditClusterQuotas();
      } catch (err) {
        this.logger.error({ err }, "Error running periodic quota audit cycle");
      } finally {
        if (this.isRunning) {
          this.scheduleNextAudit();
        }
      }
    }, nextDelayMs);

    if (this.latestAuditResult) {
      this.latestAuditResult.nextScheduledDelayMs = nextDelayMs;
    }

    this.logger.debug(
      { nextDelaySeconds: Math.round(nextDelayMs / 1000) },
      "Scheduled next deperiodic quota audit cycle",
    );
  }

  /**
   * Targeted Candidate Audit: Only audits candidate nodes needed for dispatch or rebalancing.
   * Prevents indiscriminate whole-cluster scanning to preserve Stealth Mode.
   */
  public auditCandidateNodes(candidateNodeIds: string[]): PeriodicQuotaAuditResult {
    return this.auditClusterQuotas(candidateNodeIds);
  }

  /**
   * Audits quotas for either specified candidate nodes or the cluster candidate set.
   * Applies trial plan tolerance (±5%) for passive simulation.
   */
  public auditClusterQuotas(candidateNodeIds?: string[]): PeriodicQuotaAuditResult {
    const allSummaries = this.registry.getAllNodes("24h");
    const now = Date.now();

    const isCandidateOnly = Boolean(candidateNodeIds && candidateNodeIds.length > 0);
    const candidateSet = isCandidateOnly ? new Set(candidateNodeIds) : null;

    // 1. Calculate cluster-wide averages to detect starvation across valid nodes
    const validNodes = allSummaries.filter((n) => n.state !== "dead" && !n.ineligible);
    const totalRequests = validNodes.reduce((sum, n) => sum + n.requestsServed, 0);
    const avgRequests = validNodes.length > 0 ? totalRequests / validNodes.length : 10;

    // Target nodes: only candidate nodes if specified, otherwise valid candidate nodes
    const targetNodes = candidateSet
      ? validNodes.filter((n) => candidateSet.has(n.id))
      : validNodes;

    // Preserve existing reports when doing candidate-only update
    const reports =
      isCandidateOnly && this.latestAuditResult
        ? new Map(this.latestAuditResult.reports)
        : new Map<string, QuotaAuditNodeReport>();

    const surplusNodeIds: string[] = [];

    for (const node of targetNodes) {
      const runtime = this.registry.getNode(node.id);
      const geminiQ = node.geminiQuotaPercent ?? 75;
      const claudeQ = node.claudeQuotaPercent ?? 0;
      const generalQ = node.quota.quotaPercent ?? 100;

      // Max quota available for this node across supported models
      const surplusQ = Math.max(geminiQ, claudeQ, generalQ);

      // Starvation factor: if requestsServed is substantially below average
      const requestsServed = node.requestsServed;
      let starvationFactor = 0;
      if (avgRequests > 5) {
        starvationFactor = Math.max(
          0,
          Math.min(1.0, (avgRequests - requestsServed) / (avgRequests + 1)),
        );
      } else if (requestsServed < 10) {
        starvationFactor = (10 - requestsServed) / 10;
      }

      const isStarved = starvationFactor >= 0.4;

      // Determine recommended routing role based on dual quotas
      let recommendedRole: RecommendedRoutingRole = "standard";
      let auditReason = "Balanced capacity";

      if (geminiQ <= 5 && claudeQ >= 75) {
        // e.g. justaskgao: Gemini exhausted, but Claude 100% surplus
        recommendedRole = "claude_priority";
        auditReason = "Gemini exhausted; Claude surplus 100% available - route Claude tasks";
        if (runtime && runtime.config.preferredModel?.includes("gemini")) {
          // Rebalance preferredModel automatically
          runtime.config.preferredModel = "claude-opus-5-5-high";
        }
      } else if (claudeQ <= 5 && geminiQ >= 75) {
        recommendedRole = "gemini_priority";
        auditReason = "Claude depleted; Gemini surplus available - route Gemini tasks";
      } else if (claudeQ >= 85 && geminiQ >= 80) {
        // e.g. binhthuong, sunward
        recommendedRole = "dual_priority";
        auditReason = "High dual-quota surplus (Claude & Gemini > 80%) - high dispatch priority";
      } else if (surplusQ <= 15) {
        recommendedRole = "cooldown";
        auditReason = "Near quota exhaustion - deprioritized for cooldown";
      }

      // Compute priority boost score (0 - 100)
      const quotaComponent = (surplusQ / 100) * 50;
      const starvationComponent = starvationFactor * 35;
      const trustComponent = ((node.trustScore ?? 1.0) / 1.0) * 15;
      const priorityBoost = Math.round(
        Math.min(100, quotaComponent + starvationComponent + trustComponent),
      );

      if (surplusQ >= 75 || isStarved) {
        surplusNodeIds.push(node.id);
      }

      const report: QuotaAuditNodeReport = {
        nodeId: node.id,
        displayName: node.displayName || node.id,
        tier: node.tier,
        kind: node.kind,
        geminiQuotaPercent: geminiQ,
        claudeQuotaPercent: claudeQ,
        surplusQuotaPercent: surplusQ,
        requestsServed,
        activeJobs: node.activeJobs,
        isStarved,
        starvationFactor: Number(starvationFactor.toFixed(2)),
        priorityBoost,
        recommendedRole,
        auditReason,
        lastAuditedAt: now,
        toleranceMarginPercent: 5.0, // Stealth Mode tolerance margin
      };

      reports.set(node.id, report);
    }

    // Sort top surplus nodes by priority boost descending
    const sortedSurplus = Array.from(reports.values())
      .filter((r) => r.surplusQuotaPercent >= 70)
      .sort((a, b) => b.priorityBoost - a.priorityBoost)
      .map((r) => r.nodeId);

    const result: PeriodicQuotaAuditResult = {
      timestamp: now,
      totalNodesAudited: targetNodes.length,
      surplusNodesCount: sortedSurplus.length,
      starvedNodesCount: Array.from(reports.values()).filter((r) => r.isStarved).length,
      topSurplusNodes: sortedSurplus,
      reports,
      candidateScope: candidateNodeIds,
      isCandidateOnly,
    };

    this.latestAuditResult = result;

    this.logger.info(
      {
        totalAudited: result.totalNodesAudited,
        isCandidateOnly,
        surplusNodesCount: result.surplusNodesCount,
        starvedNodesCount: result.starvedNodesCount,
        topSurplusNodes: sortedSurplus.slice(0, 5),
      },
      "Quota Audit cycle complete: candidate nodes evaluated under stealth tolerance",
    );

    return result;
  }

  public getLatestAudit(): PeriodicQuotaAuditResult | null {
    if (!this.latestAuditResult) {
      return this.auditClusterQuotas();
    }
    return this.latestAuditResult;
  }

  public getNodeAudit(nodeId: string): QuotaAuditNodeReport | undefined {
    let report = this.getLatestAudit()?.reports.get(nodeId);
    if (!report) {
      // On-demand targeted candidate audit for this specific node
      const targetedResult = this.auditCandidateNodes([nodeId]);
      report = targetedResult.reports.get(nodeId);
    }
    return report;
  }

  public getSurplusPriorityScore(nodeId: string, modelTarget?: string): number {
    const report = this.getNodeAudit(nodeId);
    if (!report) return 50;

    let targetQuota = report.surplusQuotaPercent;
    if (modelTarget) {
      const isClaude = /claude|opus|sonnet/i.test(modelTarget);
      targetQuota = isClaude ? report.claudeQuotaPercent : report.geminiQuotaPercent;
    }

    // Node with 0 quota for target model gets heavily penalised
    if (targetQuota <= 0) return 0;

    const baseScore = report.priorityBoost;
    return Math.max(5, baseScore);
  }
}

let defaultReviewer: PeriodicQuotaReviewer | null = null;

export function getPeriodicQuotaReviewer(options?: {
  registry: FleetRegistry;
  logger: Logger;
  auditIntervalMs?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
}): PeriodicQuotaReviewer {
  if (!defaultReviewer && options) {
    defaultReviewer = new PeriodicQuotaReviewer(options);
  }
  return defaultReviewer!;
}

export function setPeriodicQuotaReviewer(reviewer: PeriodicQuotaReviewer): void {
  defaultReviewer = reviewer;
}
