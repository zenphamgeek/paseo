import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CANONICAL_WORKLOADS, ModalGpuSwarmManager } from "./modal-gpu-swarm.js";

describe("ModalGpuSwarmManager", () => {
  let tempTomlPath: string;

  beforeEach(() => {
    tempTomlPath = join(
      tmpdir(),
      `test-modal-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`,
    );
    const mockTomlContent = `
[diatts]
token_id = "ak-5JPSYDtrvZHK03KbgiuZjo"
token_secret = "as-lx1qx8UQEH9TwLx5lRKN0q"

[mojopham]
token_id = "ak-5jZWdzpMPhsJmbHCYxakOF"
token_secret = "as-L3Wf3mYOy2v4XmiyigbY2u"

[asmr]
token_id = "ak-testTokenIdForAsmr123"
token_secret = "as-testSecretForAsmr456"
`;
    writeFileSync(tempTomlPath, mockTomlContent, "utf-8");
  });

  afterEach(() => {
    if (existsSync(tempTomlPath)) {
      try {
        unlinkSync(tempTomlPath);
      } catch {
        // ignore
      }
    }
  });

  it("parses all workspace profiles from toml with masked tokens", () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: tempTomlPath });
    const profiles = manager.parseProfilesFromToml();

    expect(profiles.length).toBe(3);
    const diatts = profiles.find((p) => p.profile === "diatts");
    expect(diatts).toBeDefined();
    expect(diatts?.tokenIdMasked).toContain("...");
    expect(diatts?.tokenIdMasked?.startsWith("ak-5J")).toBe(true);
  });

  it("contains all 11 canonical GPU workload contracts", () => {
    expect(CANONICAL_WORKLOADS.length).toBeGreaterThanOrEqual(10);
    const qwen = CANONICAL_WORKLOADS.find((w) => w.appId === "qwen_img_21");
    expect(qwen).toBeDefined();
    expect(qwen?.targetGpu).toBe("A100-80GB");

    const wan = CANONICAL_WORKLOADS.find((w) => w.appId === "wan_s2v_14b");
    expect(wan).toBeDefined();
    expect(wan?.targetGpu).toBe("H100");

    const sdxl = CANONICAL_WORKLOADS.find((w) => w.appId === "sdxl-image-worker");
    expect(sdxl).toBeDefined();
  });

  it("handles non-existent toml file gracefully", () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: "/tmp/non-existent-modal.toml" });
    const profiles = manager.parseProfilesFromToml();
    expect(profiles).toEqual([]);
  });

  it("rejects unauthorized commands outside the sandbox whitelist", async () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: tempTomlPath });
    await expect(manager.executeModalCli("rm -rf /")).rejects.toThrow(
      /not allowed in GPU Swarm sandbox/,
    );
  });

  it("fetches summary structure correctly", async () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: tempTomlPath });
    const summary = await manager.getSummary();

    expect(summary.totalProfiles).toBe(3);
    expect(summary.hardwareSpectrum).toBeDefined();
    expect(summary.hardwareSpectrum["A100-80GB"]).toBeDefined();
    expect(summary.hardwareSpectrum["T4"]).toBeDefined();
    expect(summary.cliVersion).toBe("1.4.3");
  }, 15000);

  it("calculates workspaces credits, headroom, and stealth mode summary", async () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: tempTomlPath });
    const { summary, workspaces } = await manager.getWorkspacesCredits(true);

    expect(workspaces.length).toBeGreaterThanOrEqual(3);
    expect(summary.totalBudgetUsd).toBeGreaterThan(0);
    expect(summary.totalHeadroomUsd).toBeGreaterThan(0);
    expect(summary.stealthMode.enabled).toBe(true);
    expect(summary.stealthMode.swrCacheTtlSeconds).toBe(1800);
    expect(summary.integrity.enforceRunawayProtection).toBe(true);

    const first = workspaces[0];
    expect(first.headroomUsd).toBeDefined();
    expect(first.intellisenseScore).toBeGreaterThanOrEqual(0);
  }, 15000);

  it("generates intelligent workload recommendations", async () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: tempTomlPath });
    const recs = await manager.getRecommendations();

    expect(recs.length).toBeGreaterThan(0);
    const qwenRec = recs.find((r) => r.appId === "qwen_img_21" || r.appId === "wan_s2v_14b");
    expect(qwenRec).toBeDefined();
    expect(qwenRec?.recommendedWorkspace).toBeDefined();
    expect(qwenRec?.workspaceHeadroomUsd).toBeGreaterThan(0);
  }, 15000);

  it("fetches modal execution logs with retention metadata and pagination", async () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: tempTomlPath });
    const res = await manager.getModalLogs({ limit: 5, page: 1 });

    expect(res.status).toBe("success");
    expect(Array.isArray(res.logs)).toBe(true);
    expect(res.retention).toBeDefined();
    expect(res.retention.retention_policy_days).toBeGreaterThanOrEqual(7);
    expect(res.retention.policy_type).toBe("rolling_window_prune");
  }, 15000);

  it("fetches aggregated modal telemetric metrics and cost breakdown", async () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: tempTomlPath });
    const metrics = await manager.getModalLogMetrics();

    expect(metrics.status).toBe("success");
    expect(metrics.total_cost_usd).toBeGreaterThanOrEqual(0);
    expect(metrics.gpu_breakdown).toBeDefined();
    expect(metrics.app_breakdown).toBeDefined();
  }, 15000);

  it("retrieves cross-mesh smart rebalancing recommendations and applies action", async () => {
    const manager = new ModalGpuSwarmManager({ tomlPath: tempTomlPath });
    const status = await manager.getCrossMeshRebalanceRecommendations(true);

    expect(status.status).toBe("active");
    expect(status.stealth_mode).toBe(true);
    expect(status.recommendations_count).toBeGreaterThan(0);
    expect(status.recommendations.length).toBeGreaterThan(0);

    const firstRec = status.recommendations[0];
    expect(firstRec.id).toBeDefined();
    expect(firstRec.source).toBeDefined();
    expect(firstRec.target).toBeDefined();

    const applyResult = await manager.applyCrossMeshRebalance(firstRec.id, firstRec.action_payload);
    expect(applyResult.status).toBe("applied");
    expect(applyResult.recommendation_id).toBe(firstRec.id);
  }, 15000);
});
