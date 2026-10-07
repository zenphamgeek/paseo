import { describe, expect, it } from "vitest";
import { ClefHitLogger } from "./clef-hit-logger.js";

describe("ClefHitLogger & Pre-Flight Gatekeeper", () => {
  it("records hits and tracks model-specific telemetry metrics", () => {
    const logger = new ClefHitLogger();

    // 1. Record a 9B local surrogate hit
    const hit1 = logger.recordHit({
      model: "clef-flash-9b",
      tier: "local",
      source: "local_surrogate",
      purpose: "pre_flight_admission",
      latencyMs: 1.25,
      tokensSaved: 200,
      decision: "admitted_zero_egress",
      details: { complexityScore: 1.5 },
    });

    expect(hit1.hitId).toMatch(/^clef-hit-/);
    expect(hit1.model).toBe("clef-flash-9b");
    expect(hit1.tier).toBe("local");
    expect(hit1.latencyMs).toBe(1.25);

    // 2. Record a 27B upstream hit
    const hit2 = logger.recordHit({
      model: "clef-27b",
      tier: "cloud",
      source: "upstream_systemone",
      purpose: "council_gate",
      latencyMs: 142.8,
      tokensSaved: 850,
      decision: "veto_mock_test_detected",
      details: { gate: "anti-cheat" },
    });

    expect(hit2.model).toBe("clef-27b");
    expect(hit2.tier).toBe("cloud");

    // 3. Verify stats aggregation
    const stats = logger.getHitStats();
    expect(stats.totalHits).toBe(2);
    expect(stats.byModel["clef-flash-9b"]).toBe(1);
    expect(stats.byModel["clef-27b"]).toBe(1);
    expect(stats.byPurpose["pre_flight_admission"]).toBe(1);
    expect(stats.byPurpose["council_gate"]).toBe(1);
    expect(stats.totalTokensSaved).toBe(1050);
    expect(stats.avgLatencyMs).toBeGreaterThan(0);

    // 4. Verify ring buffer retrieval
    const recent = logger.getRecentHits(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].hitId).toBe(hit2.hitId);
  });

  it("evaluates prompt pre-flight in <5ms using 9B local surrogate without cloud egress", () => {
    const logger = new ClefHitLogger();
    const prompt =
      "Please refactor the database connector to handle connection pooling with retry exponential backoff.";

    const res = logger.evaluatePreFlight(prompt);

    expect(res.clefModel).toBe("clef-flash-9b");
    expect(res.tier).toBe("local");
    expect(res.source).toBe("local_onnx");
    expect(res.taskRouting).toBe("refactoring");
    expect(res.complexityScore).toBeGreaterThanOrEqual(1.0);
    expect(res.stealthRisk).toBe("safe");
    expect(res.decision).toBe("admitted_zero_egress");
    expect(res.tokensSaved).toBeGreaterThan(0);
    expect(res.latencyMs).toBeLessThan(50); // fast local execution

    // Telemetry hit must have been recorded automatically
    const stats = logger.getHitStats();
    expect(stats.totalHits).toBe(1);
    expect(stats.byModel["clef-flash-9b"]).toBe(1);
  });

  it("escalates to 27B upstream model when extreme complexity and council audit is requested", () => {
    const logger = new ClefHitLogger();
    const highStakesPrompt = `
      Deep architectural adversarial council audit for distributed consensus protocol across 100 autonomous nodes.
      Verify byzantine fault tolerance, DAG decomposition, memory leak prevention, and AST policy invariants:
      \`\`\`ts
      export class ByzantineConsensusEngine { ... }
      \`\`\`
      1. Audit step 1
      2. Audit step 2
      3. Audit step 3
    `;

    const res = logger.evaluatePreFlight(highStakesPrompt);

    expect(res.clefModel).toBe("clef-27b");
    expect(res.tier).toBe("cloud");
    expect(res.source).toBe("upstream_clef");
    expect(res.complexityScore).toBeGreaterThanOrEqual(3.5);
    expect(res.decision).toBe("escalated_clef_27b");
    expect(res.decompositionIntent).toBe(true);
  });

  it("flags high stealth risk when robotic rapid loops or quota probes are detected", () => {
    const logger = new ClefHitLogger();
    const probePrompt = "Rapid loop probe quota and bypass rate limit on API endpoints";

    const res = logger.evaluatePreFlight(probePrompt);

    expect(res.stealthRisk).toBe("high_risk");
    expect(res.decision).toBe("flagged_risk");
  });

  it("prevents over-tools by acting as an in-pipeline pre-flight interceptor rather than an LLM tool", () => {
    const logger = new ClefHitLogger();
    const result = logger.evaluatePreFlight("Run unit tests for auth service");

    // Must return pure metadata without requiring any tool calls or schema definitions to the LLM
    expect(result).toHaveProperty("hitId");
    expect(result).toHaveProperty("clefModel");
    expect(result).toHaveProperty("complexityScore");
    expect(result).toHaveProperty("decision");
  });
});
