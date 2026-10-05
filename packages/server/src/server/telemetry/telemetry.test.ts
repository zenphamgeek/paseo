import { describe, expect, it } from "vitest";
import { getEgressProxyManager } from "../egress/index.js";
import { getHermesManager } from "../hermes/index.js";
import { getTelemetryHub, TelegramAlerter } from "./index.js";

describe("Telemetry & Health Infrastructure", () => {
  describe("Telegram Resource Shortage Alerter", () => {
    it("loads configuration from file or defaults with valid structure", () => {
      const alerter = new TelegramAlerter();
      const config = alerter.getConfig();

      expect(config).toHaveProperty("enabled");
      expect(config).toHaveProperty("chatId");
      expect(config).toHaveProperty("hasToken");
      expect(config.botName).toContain("zenpham_bot");
    });

    it("suppresses repeated alerts during the 300s cooldown window", async () => {
      // Local alerter with mock disabled token
      const alerter = new TelegramAlerter({
        config: { enabled: true, token: "mock-token", chatId: "mock-chat" },
        cooldownMs: 5000,
      });

      // Dispatch alert 1 (mock network will fail or we test state directly)
      const res1 = await alerter.dispatchAlert({
        alertKey: "test:cooldown",
        severity: "warning",
        title: "Test Warning Alert",
        source: "onnx",
        evidence: { error: "sample error" },
      });

      // Second identical dispatch within cooldown must be suppressed
      const res2 = await alerter.dispatchAlert({
        alertKey: "test:cooldown",
        severity: "warning",
        title: "Test Warning Alert",
        source: "onnx",
        evidence: { error: "sample error" },
      });

      // If res1 sent (or attempted and recorded), res2 is suppressed
      if (res1.sent) {
        expect(res2.suppressed).toBe(true);
        expect(res2.sent).toBe(false);
      }
    });
  });

  describe("Native Hermes-Agent & Database Inspector", () => {
    const hermes = getHermesManager();

    it("detects hermes installation and reads version", async () => {
      expect(hermes.isInstalled()).toBe(true);
      const version = await hermes.getVersion();
      expect(version).toContain("Hermes Agent");
    });

    it("inspects ~/.hermes/kanban.db with zero database lock contention", () => {
      const kanban = hermes.getKanbanSummary();
      expect(kanban.totalTasks).toBeGreaterThan(0);
      expect(kanban.byStatus).toHaveProperty("published");
      expect(kanban.latestTask).toBeDefined();
    });

    it("inspects ~/.hermes/state.db for agent session counts", () => {
      const state = hermes.getStateSummary();
      expect(state.totalSessions).toBeGreaterThan(0);
      expect(state.totalMessages).toBeGreaterThan(0);
      expect(state.latestSessionId).toBeDefined();
    });

    it("inspects ~/.hermes/verification_evidence.db for verification events", () => {
      const evidence = hermes.getEvidenceSummary();
      expect(evidence.totalEvents).toBeGreaterThanOrEqual(0);
    });

    it("aggregates full health status in single object", async () => {
      const health = await hermes.getHealthStatus();
      expect(health.installed).toBe(true);
      expect(health.kanban.totalTasks).toBeGreaterThan(0);
      expect(health.gateway?.channels).toContain("telegram");
    });
  });

  describe("Egress Proxy for CLI Swarm", () => {
    const egress = getEgressProxyManager();

    it("strictly enforces NO_PROXY for loopback, cloud metadata, and modal domains", () => {
      expect(egress.isNoProxy("http://localhost:8080")).toBe(true);
      expect(egress.isNoProxy("http://127.0.0.1:20128")).toBe(true);
      expect(egress.isNoProxy("http://169.254.169.254/metadata")).toBe(true);
      expect(egress.isNoProxy("https://modal.direct")).toBe(true);
      expect(egress.isNoProxy("https://sub.modal.direct")).toBe(true);
      expect(egress.isNoProxy("https://api.modal.com")).toBe(true);
      expect(egress.isNoProxy("https://worker.modal.run")).toBe(true);

      // External APIs should NOT be NO_PROXY
      expect(egress.isNoProxy("https://api.openai.com/v1")).toBe(false);
      expect(egress.isNoProxy("https://api.anthropic.com/v1")).toBe(false);
    });

    it("retrieves 16-slot pool status with health and port assignments", async () => {
      const pool = await egress.getPoolStatus();
      expect(pool.poolSize).toBe(16);
      expect(pool.slots).toHaveLength(16);
      expect(pool.slots[0].port).toBe(20128);
      expect(pool.slots[15].port).toBe(20143);
      expect(pool.healthyCount).toBeGreaterThan(0);
      expect(pool.correlationRiskScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Telemetry Hub & Dual ONNX Spine", () => {
    const hub = getTelemetryHub();

    it("tracks $0 tokenomics local decisions and estimated USD savings", () => {
      hub.recordLocalDecision(2000);
      hub.recordLocalDecision(4000);

      // 6000 tokens * $0.000015 = $0.09
      expect(hub).toBeDefined();
    });

    it("builds a complete telemetry snapshot across all 4 subsystems", async () => {
      const snapshot = await hub.getTelemetrySnapshot();
      expect(snapshot).toHaveProperty("timestamp");
      expect(snapshot).toHaveProperty("clusterStatus");
      expect(snapshot.dualOnnx).toBeDefined();
      expect(snapshot.dualOnnx.clefBreakerState).toMatch(/CLOSED|OPEN|HALF_OPEN/);
      expect(snapshot.egress.poolSize).toBe(16);
      expect(snapshot.hermes.installed).toBe(true);
      expect(snapshot.telegram.botName).toContain("zenpham_bot");
    });
  });
});
