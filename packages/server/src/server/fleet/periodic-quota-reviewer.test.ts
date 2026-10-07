import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pino from "pino";
import { FleetRegistry } from "./registry.js";
import { PeriodicQuotaReviewer } from "./periodic-quota-reviewer.js";
import { NineRouter } from "../router/index.js";

const testLogger = pino({ level: "silent" });

describe("PeriodicQuotaReviewer & Surplus-Quota-First Dynamic Routing", () => {
  let registry: FleetRegistry;
  let reviewer: PeriodicQuotaReviewer;
  let router: NineRouter;

  beforeEach(() => {
    registry = new FleetRegistry({ logger: testLogger, fleetRoot: "/tmp/non-existent-fleet" });

    // Register node: binhthuong (High Dual Surplus: Claude 100%, Gemini 86.5%, 15 served)
    registry.registerNode({
      id: "binhthuong",
      displayName: "binhthuong",
      kind: "agy",
      tier: "pro",
      homeDirectory: "/home/zen/agy-fleet/binhthuong",
      caps: ["gemini-3.8-flash-high", "claude-opus-5-5-high", "tools"],
      preferredModel: "gemini-3.8-flash-high",
      maxConcurrency: 2,
    });
    const binhthuongNode = registry.getNode("binhthuong")!;
    binhthuongNode.geminiQuotaPercent = 86.5;
    binhthuongNode.claudeQuotaPercent = 100.0;
    binhthuongNode.requestsServed = 15;

    // Register node: sunward (Surplus Claude 100%, Gemini 98.7%, 6 served - starved)
    registry.registerNode({
      id: "sunward",
      displayName: "sunward",
      kind: "agy",
      tier: "pro",
      homeDirectory: "/home/zen/agy-fleet/sunward",
      caps: ["gemini-3.8-flash-high", "claude-opus-5-5-high", "tools"],
      preferredModel: "claude-opus-5-5-high",
      maxConcurrency: 2,
    });
    const sunwardNode = registry.getNode("sunward")!;
    sunwardNode.geminiQuotaPercent = 98.7;
    sunwardNode.claudeQuotaPercent = 100.0;
    sunwardNode.requestsServed = 6;

    // Register node: justaskgao (Gemini 0%, Claude 100%, 13 served - starved Claude champion)
    registry.registerNode({
      id: "justaskgao",
      displayName: "justaskgao",
      kind: "agy",
      tier: "pro",
      homeDirectory: "/home/zen/agy-fleet/justaskgao",
      caps: ["gemini-3.8-flash-high", "claude-opus-5-5-high", "tools"],
      preferredModel: "gemini-3.8-flash-high",
      maxConcurrency: 2,
    });
    const justaskgaoNode = registry.getNode("justaskgao")!;
    justaskgaoNode.geminiQuotaPercent = 0.0;
    justaskgaoNode.claudeQuotaPercent = 100.0;
    justaskgaoNode.requestsServed = 13;

    // Register node: overworked-node (Overloaded node: 250 served, Gemini 20%, Claude 10%)
    registry.registerNode({
      id: "overworked-node",
      displayName: "overworked-node",
      kind: "agy",
      tier: "pro",
      homeDirectory: "/home/zen/agy-fleet/overworked",
      caps: ["gemini-3.8-flash-high", "tools"],
      preferredModel: "gemini-3.8-flash-high",
      maxConcurrency: 2,
    });
    const overworked = registry.getNode("overworked-node")!;
    overworked.geminiQuotaPercent = 20.0;
    overworked.claudeQuotaPercent = 10.0;
    overworked.requestsServed = 250;

    reviewer = registry.getPeriodicQuotaReviewer();
    router = new NineRouter({ registry, logger: testLogger });
  });

  afterEach(() => {
    reviewer.stop();
  });

  it("audits cluster quotas and identifies top surplus nodes", () => {
    const audit = reviewer.auditClusterQuotas();
    expect(audit.totalNodesAudited).toBe(4);
    expect(audit.surplusNodesCount).toBeGreaterThanOrEqual(3);

    // Top surplus nodes must contain binhthuong, sunward, or justaskgao
    expect(audit.topSurplusNodes).toContain("binhthuong");
    expect(audit.topSurplusNodes).toContain("sunward");
    expect(audit.topSurplusNodes).toContain("justaskgao");
  });

  it("detects starvation on nodes with low requestsServed and assigns high PriorityBoost", () => {
    reviewer.auditClusterQuotas();
    const sunwardReport = reviewer.getNodeAudit("sunward");
    const overworkedReport = reviewer.getNodeAudit("overworked-node");

    expect(sunwardReport).toBeDefined();
    expect(overworkedReport).toBeDefined();

    expect(sunwardReport!.isStarved).toBe(true);
    expect(sunwardReport!.starvationFactor).toBeGreaterThan(0.4);
    expect(sunwardReport!.priorityBoost).toBeGreaterThan(overworkedReport!.priorityBoost);
  });

  it("reconfigures justaskgao to claude_priority when Gemini quota is exhausted", () => {
    reviewer.auditClusterQuotas();
    const gaoReport = reviewer.getNodeAudit("justaskgao");
    expect(gaoReport).toBeDefined();
    expect(gaoReport!.recommendedRole).toBe("claude_priority");

    // Runtime config preferredModel should automatically be rebalanced to Claude
    const gaoRuntime = registry.getNode("justaskgao");
    expect(gaoRuntime?.config.preferredModel).toBe("claude-opus-5-5-high");
  });

  it("routes general/Gemini tasks to surplus nodes with highest quota (sunward/binhthuong)", () => {
    const decision = router.route({
      taskId: "test-task-1",
      prompt: "Refactor database query",
      preferredTier: "pro",
    });

    // Sunward or Binhthuong has highest quota + starvation bonus; overworked node must NOT be chosen
    expect(["sunward", "binhthuong"]).toContain(decision.nodeId);
    expect(decision.nodeId).not.toBe("overworked-node");
  });

  it("routes Claude tasks to justaskgao or sunward with 100% Claude quota", () => {
    const decision = router.route({
      taskId: "test-task-claude",
      prompt: "Use Claude Opus to write architectural documentation",
      requiredCaps: ["claude-opus-5-5-high"],
      preferredTier: "pro",
    });

    expect(["sunward", "justaskgao", "binhthuong"]).toContain(decision.nodeId);
    expect(decision.model).toBe("claude-opus-5-5-high");
  });

  it("avoids routing to nodes when requested engine quota is depleted", () => {
    // justaskgao has 0% Gemini quota
    const score = reviewer.getSurplusPriorityScore("justaskgao", "gemini-3.8-flash-high");
    expect(score).toBe(0);

    const claudeScore = reviewer.getSurplusPriorityScore("justaskgao", "claude-opus-5-5-high");
    expect(claudeScore).toBeGreaterThan(50);
  });

  it("enforces deperiodic stealth interval randomized between 480s and 600s", () => {
    const stealthReviewer = new PeriodicQuotaReviewer({
      registry,
      logger: testLogger,
    });
    for (let i = 0; i < 20; i++) {
      const interval = stealthReviewer.getRandomStealthIntervalMs();
      expect(interval).toBeGreaterThanOrEqual(480_000);
      expect(interval).toBeLessThanOrEqual(600_000);
    }
  });

  it("performs candidate-only targeted audit without scanning non-candidate nodes", () => {
    // Only audit candidate nodes: binhthuong and sunward
    const candidateAudit = reviewer.auditCandidateNodes(["binhthuong", "sunward"]);
    expect(candidateAudit.isCandidateOnly).toBe(true);
    expect(candidateAudit.totalNodesAudited).toBe(2);
    expect(candidateAudit.candidateScope).toEqual(["binhthuong", "sunward"]);
    expect(candidateAudit.reports.has("binhthuong")).toBe(true);
    expect(candidateAudit.reports.has("sunward")).toBe(true);

    const report = candidateAudit.reports.get("binhthuong")!;
    expect(report.toleranceMarginPercent).toBe(5.0);
  });
});
