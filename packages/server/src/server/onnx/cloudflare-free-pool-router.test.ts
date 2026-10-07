import { describe, it, expect, beforeEach } from "vitest";
import {
  CloudflareFreePoolRouter,
  DEFAULT_FREE_NEURONS_LIMIT,
} from "./cloudflare-free-pool-router.js";
import { ClefUpstreamClient } from "./clef-upstream-client.js";
import { getClefHitLogger } from "./clef-hit-logger.js";
import type { ClefSystemOneRequest } from "./types.js";

describe("CloudflareFreePoolRouter", () => {
  let router: CloudflareFreePoolRouter;

  const mockRequest: ClefSystemOneRequest = {
    task_id: "test-task-1",
    context: { query: "Optimize parallel fleet scheduling and memory" },
    schema: {
      question: "Which execution mode to assign?",
      type: "choice",
      options: [
        { id: "local_9b", label: "Local 9B ONNX" },
        { id: "upstream_27b", label: "Upstream 27B Cloud" },
      ],
    },
  };

  beforeEach(() => {
    router = new CloudflareFreePoolRouter({
      accounts: [
        {
          id: "acc_zen",
          email: "zenpham@gmail.com",
          accountId: "cf_zen_123",
          apiToken: "tok_zen_abc",
          dailyNeuronsLimit: 10_000,
          neuronsUsedToday: 0,
          lastResetDateUtc: "2026-10-06",
          status: "active",
          lastUsedTimestamp: 0,
        },
        {
          id: "acc_binhthuong",
          email: "binhthuong@gmail.com",
          accountId: "cf_binhthuong_456",
          apiToken: "tok_binhthuong_def",
          dailyNeuronsLimit: 10_000,
          neuronsUsedToday: 0,
          lastResetDateUtc: "2026-10-06",
          status: "active",
          lastUsedTimestamp: 0,
        },
        {
          id: "acc_sunward",
          email: "sunward@gmail.com",
          accountId: "cf_sunward_789",
          apiToken: "tok_sunward_ghi",
          dailyNeuronsLimit: 10_000,
          neuronsUsedToday: 0,
          lastResetDateUtc: "2026-10-06",
          status: "active",
          lastUsedTimestamp: 0,
        },
      ],
      defaultNeuronsPerPass: 100,
      fallbackToLocal9BOnExhausted: true,
    });
  });

  it("should initialize the pool with 30,000 total free daily neurons across 3 accounts", () => {
    const stats = router.getPoolStats();
    expect(stats.totalAccounts).toBe(3);
    expect(stats.activeAccounts).toBe(3);
    expect(stats.exhaustedAccounts).toBe(0);
    expect(stats.totalDailyPoolNeurons).toBe(30_000);
    expect(stats.totalNeuronsUsedToday).toBe(0);
    expect(stats.totalNeuronsRemainingToday).toBe(30_000);
  });

  it("should track neuron consumption per account and update remaining pool neurons", () => {
    router.recordUsage("acc_zen", 500);
    router.recordUsage("acc_binhthuong", 200);

    const stats = router.getPoolStats();
    expect(stats.totalNeuronsUsedToday).toBe(700);
    expect(stats.totalNeuronsRemainingToday).toBe(29_300);
  });

  it("should mark account as exhausted when reaching 10,000 neurons", () => {
    router.recordUsage("acc_zen", 10_000);

    const stats = router.getPoolStats();
    expect(stats.activeAccounts).toBe(2);
    expect(stats.exhaustedAccounts).toBe(1);

    // The exhausted account should not be selected
    const selected = router.selectNextAccount();
    expect(selected).not.toBeNull();
    expect(selected?.id).not.toBe("acc_zen");
  });

  it("should select accounts using stealth load balancing (lowest utilization first)", () => {
    router.recordUsage("acc_binhthuong", 5000); // 50%
    router.recordUsage("acc_sunward", 8000); // 80%
    router.recordUsage("acc_zen", 1000); // 10%

    // acc_zen has lowest utilization, so it should be prioritized
    const nextAcc = router.selectNextAccount();
    expect(nextAcc?.id).toBe("acc_zen");
  });

  it("should seamlessly fallback to Local 9B when all free Cloudflare accounts are exhausted", async () => {
    // Exhaust all 3 accounts
    router.markAccountExhausted("acc_zen");
    router.markAccountExhausted("acc_binhthuong");
    router.markAccountExhausted("acc_sunward");

    const stats = router.getPoolStats();
    expect(stats.activeAccounts).toBe(0);
    expect(stats.exhaustedAccounts).toBe(3);

    // Now evaluate: must seamlessly fallback to 9B Local
    const client = new ClefUpstreamClient();
    const response = await router.evaluateWithFallback(mockRequest, client);

    expect(response).toBeDefined();
    expect(response.source).toBe("local_fallback");
    expect(response.selected_option).toBeDefined();

    // Pool stats should register local fallback
    const updatedStats = router.getPoolStats();
    expect(updatedStats.localFallbackCount).toBeGreaterThanOrEqual(1);

    // Clef Hit Logger should have registered the fallback hit
    const loggerStats = getClefHitLogger().getHitStats();
    expect(loggerStats.totalHits).toBeGreaterThan(0);
    expect(loggerStats.byModel["clef-flash-9b"]).toBeGreaterThan(0);
  });

  it("should handle circuit breaker OPEN and gracefully fallback to Local 9B", async () => {
    // Create a client with circuit breaker forced to fail
    const client = new ClefUpstreamClient({
      endpoint: "http://127.0.0.1:9999/non-existent-clef-endpoint",
      breakerConfig: { timeoutMs: 50, failureThreshold: 1 },
    });

    const response = await router.evaluateWithFallback(mockRequest, client);

    expect(response).toBeDefined();
    expect(response.source).toBe("local_fallback");
    expect(response.cost_tokens).toBe(0);
  });

  it("should execute runWorkersAi across free swarm accounts and record neuron consumption", async () => {
    const result = await router.runWorkersAi(
      "@cf/meta/llama-3.1-8b-instruct",
      [{ role: "user", content: "Optimize this loop" }],
      50,
    );

    expect(result).toBeDefined();
    expect(result.source).toBe("cloudflare_workers_ai");
    expect(result.neuronsConsumed).toBe(50);
    expect(result.response).toContain("CF Free Pool Swarm");

    const stats = router.getPoolStats();
    expect(stats.totalNeuronsUsedToday).toBe(50);
  });

  it("should fallback runWorkersAi to Local 9B surrogate when all accounts are exhausted", async () => {
    router.markAccountExhausted("acc_zen");
    router.markAccountExhausted("acc_binhthuong");
    router.markAccountExhausted("acc_sunward");

    const result = await router.runWorkersAi(
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      [{ role: "user", content: "Explain quantum computing" }],
      80,
    );

    expect(result).toBeDefined();
    expect(result.source).toBe("local_fallback");
    expect(result.neuronsConsumed).toBe(0);
    expect(result.accountEmail).toBe("local-9b-surrogate");
    expect(result.response).toContain("Local 9B Surrogate Fallback");
  });
});
