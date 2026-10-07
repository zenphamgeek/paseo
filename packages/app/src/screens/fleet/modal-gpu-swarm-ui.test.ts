import { describe, expect, it } from "vitest";
import type { ModalGpuSwarmSummaryUI, ModalGpuWorkerUI, ModalWorkloadUI } from "./types";

describe("Modal GPU Swarm UI Types & Model Specifications", () => {
  it("formats Modal GPU Swarm summary with hardware spectrum", () => {
    const summary: ModalGpuSwarmSummaryUI = {
      available: true,
      totalProfiles: 23,
      activeProfile: "asmr",
      totalWorkers: 13,
      totalRunningContainers: 2,
      hardwareSpectrum: {
        "A100-80GB": 1,
        H100: 2,
        A10G: 2,
        T4: 8,
        L4: 0,
      },
      clusterHealth: "healthy",
      latencyMs: 1.2,
      endpoint: "http://127.0.0.1:7777/api/fleet/modal",
      cliVersion: "1.4.3",
    };

    expect(summary.totalProfiles).toBe(23);
    expect(summary.activeProfile).toBe("asmr");
    expect(summary.hardwareSpectrum["A100-80GB"]).toBe(1);
    expect(summary.hardwareSpectrum["H100"]).toBe(2);
    expect(summary.hardwareSpectrum["T4"]).toBe(8);
  });

  it("validates Modal GPU worker contract structure", () => {
    const worker: ModalGpuWorkerUI = {
      appId: "ap-jNQRsNegs379Wa4oLF60de",
      name: "qwen-image-edit-worker",
      workspace: "asmr",
      state: "deployed",
      hardware: "T4",
      endpoint: "https://asmr--qwen-image-edit-worker-api.modal.run",
      tasks: 0,
      createdAt: "2026-04-21 09:33:46+00:00",
    };

    expect(worker.state).toBe("deployed");
    expect(worker.endpoint).toContain("modal.run");
    expect(worker.workspace).toBe("asmr");
  });

  it("verifies canonical workload definition", () => {
    const workload: ModalWorkloadUI = {
      appId: "wan_s2v_14b",
      name: "Wan 2.2 S2V (Speech-to-Video 14B)",
      description: "Audio-Driven Video Synthesis",
      targetGpu: "H100",
      defaultUrlTemplate: "https://{workspace}--hermes-wan-s2v-14b-wans2vworker-generate.modal.run",
      candidateWorkspaces: ["diatts", "asmr", "motion"],
    };

    expect(workload.targetGpu).toBe("H100");
    expect(workload.candidateWorkspaces).toContain("diatts");
  });

  it("verifies Modal workspace credit & intellisense model", () => {
    const credit: import("./types").ModalWorkspaceCreditUI = {
      workspace: "zenonts",
      accountEmail: "zenonmind@gmail.com",
      gpuTier: "T4",
      configuredLimitUsd: 29.5,
      currentSpendUsd: 0.0077,
      headroomUsd: 29.4923,
      headroomPercent: 99.97,
      utilizationPercent: 0.03,
      intellisenseScore: 99.98,
      canDeploy: true,
      billingStatus: "nominal",
      alarm: null,
      circuitState: "CLOSED",
      lastProbed: Date.now(),
    };

    expect(credit.headroomUsd).toBe(29.4923);
    expect(credit.canDeploy).toBe(true);
    expect(credit.circuitState).toBe("CLOSED");
    expect(credit.intellisenseScore).toBe(99.98);
  });

  it("verifies Modal intellisense summary & stealth governance", () => {
    const summary: import("./types").ModalIntelliSenseSummaryUI = {
      totalBudgetUsd: 678.5,
      totalSpendUsd: 71.42,
      totalHeadroomUsd: 607.08,
      totalHeadroomPercent: 89.47,
      healthyWorkspacesCount: 21,
      warningWorkspacesCount: 2,
      exhaustedWorkspacesCount: 0,
      stealthMode: {
        enabled: true,
        swrCacheTtlSeconds: 1800,
        passiveInterpolation: true,
        jitterDelayRangeMs: [500, 1500],
        lastSyncTimestamp: Date.now(),
      },
      integrity: {
        circuitBreakersTripped: 0,
        autoFailoverEnabled: true,
        minHeadroomThresholdUsd: 2.0,
        enforceRunawayProtection: true,
      },
    };

    expect(summary.totalBudgetUsd).toBe(678.5);
    expect(summary.stealthMode.enabled).toBe(true);
    expect(summary.integrity.enforceRunawayProtection).toBe(true);
  });

  it("validates Modal execution log and retention policy structure", () => {
    const retention: import("./types").ModalRetentionPolicyUI = {
      retention_policy_days: 14,
      policy_type: "rolling_window_prune",
      total_modal_logs: 130,
      oldest_log_timestamp: Date.now() - 14 * 86400 * 1000,
      newest_log_timestamp: Date.now(),
      oldest_log_age_days: 14.0,
      auto_prune_enabled: true,
    };

    expect(retention.retention_policy_days).toBe(14);
    expect(retention.total_modal_logs).toBe(130);
    expect(retention.auto_prune_enabled).toBe(true);

    const log: import("./types").ModalExecutionLogUI = {
      id: 24199,
      db_id: 24199,
      node_id: "modal:zenonmind",
      workspace: "zenonmind",
      level: "INFO",
      message:
        "[MODAL_EXEC] qwen_img_21 on zenonmind (A100-80GB) | Cost: $0.0000 | Status: SUCCESS",
      timestamp: Date.now(),
      time_str: "10:14:00",
      time_full: "2026-10-06 10:14:00 +07",
      app_id: "qwen_img_21",
      gpu_tier: "A100-80GB",
      duration_s: 1.5,
      duration_ms: 1500,
      cost_usd: 0.0001,
      status: "success",
      run_id: "run-abc-123",
      details: {
        is_modal: true,
        workspace: "zenonmind",
      },
    };

    expect(log.status).toBe("success");
    expect(log.gpu_tier).toBe("A100-80GB");
    expect(log.cost_usd).toBeGreaterThan(0);
    expect(log.duration_s).toBe(1.5);
  });

  it("validates cross-mesh smart rebalancing recommendation specifications", () => {
    const rec: import("./types").SmartCrossMeshRecommendationUI = {
      id: "rec-repatriate-omnivoice-mesh",
      type: "repatriate_to_mesh",
      category: "cost_saving",
      title: "Repatriate OmniVoice TTS to Local Hardware Mesh",
      app_template_id: "omnivoice",
      app_title: "VieNeu 3 Turbo & OmniVoice TTS",
      source: "modal:diatts",
      target: "mesh:binhthuong",
      reason:
        "Local node binhthuong has surplus quota & idle ONNX engine. Repatriating saves $0.20/GPU-hr.",
      estimated_cost_delta_usd: -0.2,
      savings_percent: 100.0,
      latency_impact: "faster (zero network latency, local ONNX)",
      urgency: "high",
      action_type: "reroute_to_mesh",
      action_payload: { app_id: "omnivoice", target_node: "binhthuong" },
      created_at: Date.now(),
    };

    expect(rec.type).toBe("repatriate_to_mesh");
    expect(rec.estimated_cost_delta_usd).toBe(-0.2);
    expect(rec.savings_percent).toBe(100.0);
    expect(rec.target).toBe("mesh:binhthuong");
    expect(rec.source).toBe("modal:diatts");
  });
});
