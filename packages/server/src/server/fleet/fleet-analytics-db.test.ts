import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FleetAnalyticsDatabase } from "./fleet-analytics-db.js";

describe("FleetAnalyticsDatabase", () => {
  const testDir = join(process.cwd(), ".dev", "test-fleet-analytics");
  const testDbPath = join(testDir, "test_analytics.db");
  const testLogsDir = join(testDir, "logs");
  let db: FleetAnalyticsDatabase;

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testLogsDir, { recursive: true });
    db = new FleetAnalyticsDatabase({ dbPath: testDbPath, logsDir: testLogsDir });
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("records fleet requests and retrieves summary", () => {
    db.recordRequest({
      id: "req-1",
      nodeId: "oc_gaopham",
      cluster: "opencode",
      tier: "free",
      model: "opencode/fledge-alpha-free",
      promptSummary: "Test free job",
      status: "completed",
      exitCode: 0,
      durationMs: 8000,
      totalTokens: 250,
    });

    db.recordRequest({
      id: "req-2",
      nodeId: "pro-1",
      cluster: "agy",
      tier: "ultra",
      model: "claude-opus-5-5-high",
      promptSummary: "Test ultra job",
      status: "completed",
      exitCode: 0,
      durationMs: 12000,
      totalTokens: 2000,
    });

    const summary = db.getSummary("24h");
    expect(summary.totalRequests).toBe(2);
    expect(summary.completedRequests).toBe(2);
    expect(summary.failedRequests).toBe(0);
    expect(summary.successRate).toBe(100);
    expect(summary.totalTokens).toBe(2250);
    expect(summary.totalSavedUsd).toBeGreaterThan(0);
    expect(summary.activeNodesCount).toBe(2);
  });

  it("computes per-node utilization metrics and detects hotspots", () => {
    // Record multiple jobs for oc_gaopham
    for (let i = 0; i < 5; i++) {
      db.recordRequest({
        id: `req-oc-${i}`,
        nodeId: "oc_gaopham",
        cluster: "opencode",
        tier: "free",
        model: "opencode/fledge-alpha-free",
        status: "completed",
        exitCode: 0,
        durationMs: 5000,
        totalTokens: 500,
      });
    }

    // Record 1 job for pro-1
    db.recordRequest({
      id: "req-pro-1",
      nodeId: "pro-1",
      cluster: "agy",
      tier: "ultra",
      model: "claude-opus-5-5-high",
      status: "completed",
      exitCode: 0,
      durationMs: 10000,
      totalTokens: 1000,
    });

    const nodes = db.getNodeUtilization("24h");
    expect(nodes.length).toBe(2);
    const topNode = nodes[0];
    expect(topNode.nodeId).toBe("oc_gaopham");
    expect(topNode.requestsCount).toBe(5);
    expect(topNode.sharePercent).toBeGreaterThan(50);
    expect(topNode.status).toBe("hotspot");
  });

  it("generates time-series buckets for timeline dashboard", () => {
    db.recordRequest({
      id: "req-timeline",
      nodeId: "oc_node-4",
      cluster: "opencode",
      tier: "free",
      model: "opencode/fledge-alpha-free",
      status: "completed",
      exitCode: 0,
      durationMs: 4000,
      totalTokens: 300,
    });

    const timeline = db.getTimeline("1h");
    expect(timeline.length).toBeGreaterThan(0);
    const sumRequests = timeline.reduce((acc, b) => acc + b.requests, 0);
    expect(sumRequests).toBe(1);
  });

  it("prunes records and disk logs older than 30 days", () => {
    const oldTime = Date.now() - 35 * 24 * 60 * 60 * 1000; // 35 days ago
    const newTime = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago

    // Insert old record
    db.recordRequest({
      id: "req-old",
      nodeId: "oc_node-4",
      cluster: "opencode",
      tier: "free",
      model: "opencode/fledge-alpha-free",
      status: "completed",
      exitCode: 0,
      durationMs: 4000,
      createdAt: oldTime,
    });

    // Insert new record
    db.recordRequest({
      id: "req-new",
      nodeId: "oc_node-4",
      cluster: "opencode",
      tier: "free",
      model: "opencode/fledge-alpha-free",
      status: "completed",
      exitCode: 0,
      durationMs: 4000,
      createdAt: newTime,
    });

    // Create dummy disk logs
    const oldLogPath = join(testLogsDir, "job_old.log");
    const newLogPath = join(testLogsDir, "job_new.log");
    writeFileSync(oldLogPath, "old log content");
    writeFileSync(newLogPath, "new log content");

    // Manually backdate the mtime of oldLogPath
    const fs = require("node:fs");
    fs.utimesSync(oldLogPath, new Date(oldTime), new Date(oldTime));

    const result = db.pruneOlderThan30Days(30);
    expect(result.recordsDeleted).toBe(1);
    expect(result.filesDeleted).toBe(1);
    expect(existsSync(oldLogPath)).toBe(false);
    expect(existsSync(newLogPath)).toBe(true);

    const remaining = db.getRecentRequests(10);
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe("req-new");
  });

  it("computes model analytics breakdown and total KPIs", () => {
    db.recordRequest({
      id: "req-m1",
      nodeId: "nebula",
      cluster: "agy",
      tier: "ultra",
      model: "claude-opus-4.8",
      status: "completed",
      exitCode: 0,
      durationMs: 4000,
      totalTokens: 3000,
      costBilledUsd: 0.045,
      costSavedUsd: 0.05,
    });

    db.recordRequest({
      id: "req-m2",
      nodeId: "binhthuong",
      cluster: "agy",
      tier: "pro",
      model: "gemini-3.8-flash-thinking",
      status: "completed",
      exitCode: 0,
      durationMs: 1500,
      totalTokens: 1200,
      costBilledUsd: 0.002,
      costSavedUsd: 0.02,
    });

    db.recordRequest({
      id: "req-m3",
      nodeId: "oc_gaopham",
      cluster: "opencode",
      tier: "free",
      model: "opencode/fledge-alpha-free",
      status: "completed",
      exitCode: 0,
      durationMs: 1100,
      totalTokens: 800,
      costBilledUsd: 0.0,
      costSavedUsd: 0.015,
    });

    const { models, totals } = db.getModelAnalytics("24h");
    expect(models.length).toBe(3);
    expect(totals.totalRequests).toBe(3);
    expect(totals.totalTokens).toBe(5000);
    expect(totals.activeModelsCount).toBe(3);
    expect(totals.totalBilledUsd).toBeCloseTo(0.047, 3);
    expect(totals.totalSavedUsd).toBeCloseTo(0.085, 3);

    const opus = models.find((m) => m.model === "claude-opus-4.8");
    expect(opus).toBeDefined();
    expect(opus?.tier).toBe("ultra");
    expect(opus?.requestsCount).toBe(1);
    expect(opus?.sharePercent).toBeCloseTo(33.3, 1);
    expect(opus?.nodes).toContain("nebula");
  });

  it("computes per-node model distribution percentages accurately", () => {
    // Node nebula runs 2 Opus and 1 Sonnet
    db.recordRequest({
      id: "req-dist-1",
      nodeId: "nebula",
      cluster: "agy",
      tier: "ultra",
      model: "claude-opus-4.8",
      status: "completed",
      exitCode: 0,
      durationMs: 4000,
      totalTokens: 3000,
    });
    db.recordRequest({
      id: "req-dist-2",
      nodeId: "nebula",
      cluster: "agy",
      tier: "ultra",
      model: "claude-opus-4.8",
      status: "completed",
      exitCode: 0,
      durationMs: 4200,
      totalTokens: 3100,
    });
    db.recordRequest({
      id: "req-dist-3",
      nodeId: "nebula",
      cluster: "agy",
      tier: "ultra",
      model: "claude-sonnet-5",
      status: "completed",
      exitCode: 0,
      durationMs: 2200,
      totalTokens: 2000,
    });

    const dists = db.getNodeModelDistributions("24h");
    expect(dists.length).toBe(1);
    const nebulaDist = dists[0];
    expect(nebulaDist.nodeId).toBe("nebula");
    expect(nebulaDist.totalRequests).toBe(3);
    expect(nebulaDist.models.length).toBe(2);

    const opusEntry = nebulaDist.models.find((m) => m.model === "claude-opus-4.8");
    const sonnetEntry = nebulaDist.models.find((m) => m.model === "claude-sonnet-5");
    expect(opusEntry).toBeDefined();
    expect(sonnetEntry).toBeDefined();
    expect(opusEntry?.sharePercent).toBeCloseTo(66.7, 1);
    expect(sonnetEntry?.sharePercent).toBeCloseTo(33.3, 1);
  });

  it("computes per-node stats map and resolves retention metrics", () => {
    db.recordRequest({
      id: "req-stats-1",
      nodeId: "pro-1",
      cluster: "agy",
      tier: "ultra",
      model: "claude-opus-4.8",
      status: "completed",
      exitCode: 0,
      durationMs: 3000,
      totalTokens: 5000,
      costSavedUsd: 0.075,
    });
    db.recordRequest({
      id: "req-stats-2",
      nodeId: "pro-1",
      cluster: "agy",
      tier: "ultra",
      model: "claude-opus-4.8",
      status: "failed",
      exitCode: 1,
      durationMs: 1200,
      totalTokens: 1000,
      costSavedUsd: 0.0,
    });

    const statsMap = db.getNodeStatsMap("24h");
    const proStats = statsMap.get("pro-1");
    expect(proStats).toBeDefined();
    expect(proStats?.requestsServed).toBe(2);
    expect(proStats?.errorCount).toBe(1);
    expect(proStats?.tokensConsumed).toBe(6000);
  });
});
