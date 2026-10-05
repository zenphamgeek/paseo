import { describe, expect, it } from "vitest";
import pino from "pino";
import { FleetRegistry } from "../fleet/registry.js";
import { NineRouter } from "./index.js";

const logger = pino({ level: "silent" });

describe("NineRouter", () => {
  it("should prioritize Ultra Tier cascade (Nebula -> Opus 5.5 Fallbacks)", async () => {
    const registry = new FleetRegistry({ logger });
    await registry.initialize();
    const router = new NineRouter({ registry, logger });

    const decision = router.route({
      taskId: "test-task-1",
      prompt: "Design high level architecture",
      tokensEstimate: 3000,
      preferredTier: "ultra",
      requiredCaps: ["planning"],
    });

    expect(decision.nodeId).toBe("nebula");
    expect(decision.model).toBe("claude-opus-4.8");
    expect(decision.fallbackChain.length).toBeGreaterThan(0);

    // Verify fallbacks contain Opus 5.5 nodes
    const fallbackNodeIds = decision.fallbackChain.map((f) => f.nodeId);
    expect(fallbackNodeIds).toContain("binhthuong");
    expect(fallbackNodeIds).toContain("sunward");
    expect(fallbackNodeIds).toContain("justaskgao");

    await registry.shutdown();
  });

  it("should execute sub-second failover on 429/quota error", async () => {
    const registry = new FleetRegistry({ logger });
    await registry.initialize();
    const router = new NineRouter({ registry, logger });

    const decision = router.route({
      taskId: "test-task-2",
      prompt: "Test failover",
      preferredTier: "ultra",
      tokensEstimate: 1000,
      requiredCaps: [],
    });

    const failoverDecision = router.failover(decision, new Error("HTTP 429: Resource Exhausted"));
    expect(failoverDecision).not.toBeNull();
    expect(failoverDecision?.nodeId).not.toBe(decision.nodeId);

    await registry.shutdown();
  });
});
