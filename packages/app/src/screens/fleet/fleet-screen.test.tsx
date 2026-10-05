import { describe, expect, it } from "vitest";
import type { FleetNodeSummary } from "./types";

describe("Fleet Dashboard state & data model", () => {
  const mockNodes: FleetNodeSummary[] = [
    {
      id: "nebula",
      kind: "nebula",
      tier: "ultra",
      state: "ready",
      accountEmail: "nebula@b.ai",
      caps: ["claude-opus-4.8", "claude-sonnet-5"],
      preferredModel: "claude-opus-4.8",
      geminiQuotaPercent: 100,
      claudeQuotaPercent: 99,
      quota: {
        usedTokens: 0,
        tokenLimit: 1_000_000,
        quotaPercent: 100,
        resetsAt: null,
        lastCheckedAt: Date.now(),
      },
      activeJobs: 0,
      requestsServed: 547,
      errorCount: 3,
      lastHeartbeat: Date.now(),
    },
    {
      id: "binhthuong",
      kind: "agy",
      tier: "ultra",
      state: "ready",
      accountEmail: "binhthuongcarpediem@gmail.com",
      caps: ["claude-opus-5-5-high", "gemini-3.8-flash-high"],
      preferredModel: "claude-opus-5-5-high",
      geminiQuotaPercent: 62.9,
      claudeQuotaPercent: 99.7,
      quota: {
        usedTokens: 720088,
        tokenLimit: 1_000_000,
        quotaPercent: 63,
        resetsAt: null,
        lastCheckedAt: Date.now(),
      },
      activeJobs: 0,
      requestsServed: 9,
      errorCount: 4,
      lastHeartbeat: Date.now(),
    },
    {
      id: "ai-digimate",
      kind: "agy",
      tier: "pro",
      state: "ready",
      accountEmail: "ai.digimate@gmail.com",
      caps: ["gemini-3.8-flash-high"],
      preferredModel: "gemini-3.8-flash-high",
      geminiQuotaPercent: 54,
      claudeQuotaPercent: 0,
      quota: {
        usedTokens: 460000,
        tokenLimit: 1_000_000,
        quotaPercent: 54,
        resetsAt: null,
        lastCheckedAt: Date.now(),
      },
      activeJobs: 0,
      requestsServed: 13,
      errorCount: 1,
      lastHeartbeat: Date.now(),
    },
  ];

  it("filters fleet nodes by tier correctly", () => {
    const ultraNodes = mockNodes.filter((n) => n.tier === "ultra");
    const proNodes = mockNodes.filter((n) => n.tier === "pro");

    expect(ultraNodes).toHaveLength(2);
    expect(proNodes).toHaveLength(1);
    expect(ultraNodes.map((n) => n.id)).toEqual(["nebula", "binhthuong"]);
    expect(proNodes[0].id).toBe("ai-digimate");
  });

  it("filters fleet nodes by search keyword (id, email, model)", () => {
    const hasCapMatch = (caps: string[] | undefined, q: string) => {
      if (!caps) return false;
      for (const c of caps) {
        if (c.toLowerCase().includes(q)) return true;
      }
      return false;
    };

    const search = (query: string) => {
      const q = query.toLowerCase().trim();
      return mockNodes.filter(
        (n) =>
          n.id.toLowerCase().includes(q) ||
          (n.accountEmail && n.accountEmail.toLowerCase().includes(q)) ||
          (n.preferredModel && n.preferredModel.toLowerCase().includes(q)) ||
          hasCapMatch(n.caps, q),
      );
    };

    expect(search("nebula")).toHaveLength(1);
    expect(search("gmail.com")).toHaveLength(2);
    expect(search("opus")).toHaveLength(2);
    expect(search("flash")).toHaveLength(2);
    expect(search("nonexistent")).toHaveLength(0);
  });

  it("calculates cluster health based on node online fraction", () => {
    const calculateClusterHealth = (
      nodes: FleetNodeSummary[],
    ): "healthy" | "degraded" | "critical" => {
      const online = nodes.filter((n) => n.state === "ready" || n.state === "busy");
      if (online.length >= nodes.length * 0.7) return "healthy";
      if (online.length >= nodes.length * 0.4) return "degraded";
      return "critical";
    };

    expect(calculateClusterHealth(mockNodes)).toBe("healthy");

    const degradedCluster = [
      ...mockNodes,
      { ...mockNodes[0], id: "n1", state: "dead" as const },
      { ...mockNodes[0], id: "n2", state: "dead" as const },
      { ...mockNodes[0], id: "n3", state: "dead" as const },
    ];
    expect(calculateClusterHealth(degradedCluster)).toBe("degraded");
  });

  it("formats dual quota progress accurately without out-of-bounds percentages", () => {
    const clampPercent = (val: number) => Math.min(100, Math.max(0, val));
    expect(clampPercent(120)).toBe(100);
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(62.94)).toBe(62.94);
  });
});
