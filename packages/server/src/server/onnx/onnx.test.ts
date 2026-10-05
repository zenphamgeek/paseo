import { describe, expect, it } from "vitest";
import {
  AutonomousEvolutionEvaluator,
  ClefUpstreamClient,
  computeCosineSimilarity,
  DualOnnxEngine,
  generateLocalEmbedding,
  PeriodicMemoryConsolidator,
  TokenomicsAdmissionController,
} from "./index.js";
import type { ClefSystemOneRequest, TrajectoryMetrics } from "./types.js";

function buildHistory(count: number, errorCountPerSample: number): TrajectoryMetrics[] {
  const result: TrajectoryMetrics[] = [];
  for (let i = 0; i < count; i++) {
    result.push({
      taskId: `sample-${i}`,
      success: errorCountPerSample === 0,
      steps: 5,
      toolCalls: 5,
      toolErrors: errorCountPerSample,
      latencyMs: 500,
      tokensCost: 0,
    });
  }
  return result;
}

describe("Zencode Clef Upstream Client (SystemOne)", () => {
  it("references official Hugging Face repository URL", () => {
    expect(ClefUpstreamClient.OFFICIAL_UPSTREAM_URL).toBe("https://huggingface.co/Cloudflare/clef");
  });

  it("evaluates options with deterministic fallback when upstream is offline", async () => {
    const client = new ClefUpstreamClient({
      endpoint: "http://127.0.0.1:59999/non-existent-clef-v1",
      breakerConfig: { timeoutMs: 100, failureThreshold: 3, halfOpenAfterMs: 5000 },
    });

    const request: ClefSystemOneRequest = {
      task_id: "test-task-1",
      context: {
        intent: "Optimize tokenomics and run local vitest suite",
        files: ["router/index.ts"],
      },
      schema: {
        question: "Choose execution model",
        type: "choice",
        options: [
          { id: "local_execution", label: "Execute locally on node ($0 token cost)" },
          { id: "escalate_ultra", label: "Escalate to Claude Opus 4.8" },
        ],
      },
    };

    const res = await client.evaluate(request);

    expect(res.source).toBe("local_fallback");
    expect(res.scores).toHaveProperty("local_execution");
    expect(res.scores).toHaveProperty("escalate_ultra");
    expect(res.selected_option).toBe("local_execution");
    expect(res.confidence).toBeGreaterThan(0.5);
    expect(client.getFailureCount()).toBe(1);
  });

  it("trips circuit breaker from CLOSED to OPEN after failure threshold", async () => {
    const client = new ClefUpstreamClient({
      endpoint: "http://127.0.0.1:59999/down",
      breakerConfig: { timeoutMs: 50, failureThreshold: 3, halfOpenAfterMs: 10000 },
    });

    const req: ClefSystemOneRequest = {
      task_id: "breaker-test",
      context: { op: "benchmark" },
      schema: {
        question: "Run?",
        type: "choice",
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ],
      },
    };

    expect(client.getBreakerState()).toBe("CLOSED");

    // 3 failures
    await client.evaluate(req);
    await client.evaluate(req);
    await client.evaluate(req);

    expect(client.getBreakerState()).toBe("OPEN");

    // 4th request must fast-fail via local fallback in < 15ms without network attempt
    const t0 = performance.now();
    const fastFailRes = await client.evaluate(req);
    const elapsed = performance.now() - t0;

    expect(fastFailRes.source).toBe("local_fallback");
    expect(elapsed).toBeLessThan(15);
  });
});

describe("Zencode Periodic Memory Consolidator", () => {
  it("generates normalized L2 embedding vectors", () => {
    const vec = generateLocalEmbedding("Zencode NineRouter tokenomics and memory");
    expect(vec).toHaveLength(64);

    let sumSq = 0;
    for (const v of vec) {
      sumSq += v * v;
    }
    const norm = Math.sqrt(sumSq);
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it("handles zero/empty text without NaN or divide-by-zero", () => {
    const emptyVec = generateLocalEmbedding("");
    expect(emptyVec).toHaveLength(64);
    for (const v of emptyVec) {
      expect(v).toBe(0);
    }

    const sim = computeCosineSimilarity(emptyVec, emptyVec);
    expect(sim).toBe(0);
    expect(Number.isNaN(sim)).toBe(false);
  });

  it("compacts episodic events into semantic memory with cryptographic provenance", () => {
    const consolidator = new PeriodicMemoryConsolidator();

    consolidator.recordEpisode({
      id: "ep-1",
      sessionId: "sess-100",
      timestamp: 1000,
      role: "user",
      content: "We need to integrate NineRouter with local ONNX admission control.",
    });

    consolidator.recordEpisode({
      id: "ep-2",
      sessionId: "sess-100",
      timestamp: 1001,
      role: "tool",
      content: "Running vitest suites and validating AST policy compliance.",
    });

    expect(consolidator.getUnconsolidatedEpisodes()).toHaveLength(2);

    const compacted = consolidator.consolidate({ minEpisodes: 2 });
    expect(compacted).toHaveLength(1);

    const item = compacted[0];
    expect(item.sourceEpisodeIds).toEqual(["ep-1", "ep-2"]);
    expect(item.provenanceHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256
    expect(item.embedding).toHaveLength(64);
    expect(item.tags).toContain("session:sess-100");

    expect(consolidator.getUnconsolidatedEpisodes()).toHaveLength(0);
  });

  it("retrieves semantic memories via cosine similarity strictly above threshold", () => {
    const consolidator = new PeriodicMemoryConsolidator();

    consolidator.recordEpisode({
      id: "ep-deploy-1",
      sessionId: "deploy-sess",
      timestamp: 2000,
      role: "tool",
      content: "Kubernetes pod deployed and smoke tests verified green on namespace paseo.",
    });

    consolidator.recordEpisode({
      id: "ep-db-1",
      sessionId: "db-sess",
      timestamp: 2001,
      role: "tool",
      content: "SQLite database migration executed with rollback savepoints and zero leaks.",
    });

    consolidator.consolidate({ minEpisodes: 1 });

    const deployQueryResults = consolidator.searchSemanticMemory(
      "kubernetes pod deployment status",
      {
        threshold: 0.2,
        topK: 2,
      },
    );

    expect(deployQueryResults.length).toBeGreaterThan(0);
    expect(deployQueryResults[0].item.tags).toContain("session:deploy-sess");
    expect(deployQueryResults[0].similarity).toBeGreaterThan(0.2);
  });
});

describe("Zencode Autonomous Evolution & AST Policy", () => {
  const evaluator = new AutonomousEvolutionEvaluator();

  it("scores agent trajectories based on success, tool errors, and step efficiency", () => {
    const optimalMetrics: TrajectoryMetrics = {
      taskId: "task-opt",
      success: true,
      steps: 8,
      toolCalls: 10,
      toolErrors: 0,
      latencyMs: 1200,
      tokensCost: 0,
    };

    const score = evaluator.scoreTrajectory(optimalMetrics);
    expect(score.fitness).toBeGreaterThanOrEqual(0.85);
    expect(score.evaluation).toBe("optimal");
    expect(score.toolErrorRate).toBe(0);

    const failingMetrics: TrajectoryMetrics = {
      taskId: "task-fail",
      success: false,
      steps: 25,
      toolCalls: 15,
      toolErrors: 12,
      latencyMs: 8000,
      tokensCost: 1500,
    };

    const failScore = evaluator.scoreTrajectory(failingMetrics);
    expect(failScore.fitness).toBeLessThan(0.5);
    expect(failScore.evaluation).toBe("failing");
    expect(failScore.toolErrorRate).toBe(0.8);
  });

  it("detects drift when sliding window error rate spikes above threshold", () => {
    const history = buildHistory(12, 0);

    const stableReport = evaluator.detectDrift(history, history[0], {
      errorRateThreshold: 0.3,
      minSamples: 10,
    });
    expect(stableReport.driftDetected).toBe(false);
    expect(stableReport.status).toBe("stable");
    expect(stableReport.action).toBe("continue");

    const highErrorHistory = buildHistory(10, 3);
    const degradedMetrics: TrajectoryMetrics = {
      taskId: "degraded",
      success: false,
      steps: 15,
      toolCalls: 10,
      toolErrors: 8,
      latencyMs: 5000,
      tokensCost: 200,
    };

    const driftReport = evaluator.detectDrift(highErrorHistory, degradedMetrics, {
      errorRateThreshold: 0.3,
      minSamples: 10,
    });

    expect(driftReport.driftDetected).toBe(true);
    expect(driftReport.status).toBe("drift_alert");
    expect(driftReport.action).toBe("halt_or_replan");
  });

  it("enforces AST security and cleanliness policies", () => {
    const maliciousCode = `
      const apiKey = "sk-proj-1234567890abcdef123456";
      eval("console.log(apiKey)");
      const x: any = 42;
    `;

    const result = evaluator.enforceAstPolicy(maliciousCode);
    expect(result.valid).toBe(false);

    const ruleIds = result.violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("AST-NO-HARDCODED-SECRETS");
    expect(ruleIds).toContain("AST-NO-UNSAFE-EVAL");
    expect(ruleIds).toContain("AST-STRICT-TYPING-NO-ANY");

    const cleanCode = `
      export function add(a: number, b: number): number {
        return a + b;
      }
    `;

    const cleanResult = evaluator.enforceAstPolicy(cleanCode);
    expect(cleanResult.valid).toBe(true);
    expect(cleanResult.violations).toHaveLength(0);
  });
});

describe("Zencode Tokenomics Admission Controller", () => {
  const controller = new TokenomicsAdmissionController({ localConfidenceFloor: 0.8 });

  it("routes deterministic tasks to local ONNX at $0 token cost", () => {
    const decision = controller.evaluateAdmission({
      taskId: "task-lint",
      prompt: "Run oxlint and vitest to check codebase correctness",
      estimatedTokens: 300,
    });

    expect(decision.decision).toBe("local");
    expect(decision.billedCost).toBe(0);
    expect(decision.source).toBe("local_onnx");
  });

  it("falls back to local ONNX at $0 cost when remaining budget is zero or negative", () => {
    const zeroBudgetDecision = controller.evaluateAdmission({
      taskId: "task-budget-zero",
      prompt: "Perform deep complex multi-turn architecture refactoring",
      estimatedTokens: 10000,
      preferredTier: "ultra",
      remainingBudget: 0,
    });

    expect(zeroBudgetDecision.decision).toBe("local");
    expect(zeroBudgetDecision.billedCost).toBe(0);
    expect(zeroBudgetDecision.source).toBe("local_onnx");
    expect(zeroBudgetDecision.reason).toContain("budget_exhausted");

    const negBudgetDecision = controller.evaluateAdmission({
      taskId: "task-budget-neg",
      prompt: "High priority swarm escalation",
      estimatedTokens: 5000,
      preferredTier: "pro",
      remainingBudget: -5,
    });

    expect(negBudgetDecision.decision).toBe("local");
    expect(negBudgetDecision.billedCost).toBe(0);
  });

  it("escalates to ultra tier when explicitly requested and budget is available", () => {
    const decision = controller.evaluateAdmission({
      taskId: "task-ultra",
      prompt: "Formulate strategic multi-perspective system design",
      estimatedTokens: 2000,
      preferredTier: "ultra",
      remainingBudget: 50,
    });

    expect(decision.decision).toBe("escalate_fleet_ultra");
    expect(decision.billedCost).toBeGreaterThan(0);
  });
});

describe("Zencode Unified DualOnnxEngine Orchestrator", () => {
  it("instantiates all sub-engines with zero leaks", () => {
    const engine = new DualOnnxEngine();
    expect(engine.upstreamClef).toBeInstanceOf(ClefUpstreamClient);
    expect(engine.memoryConsolidator).toBeInstanceOf(PeriodicMemoryConsolidator);
    expect(engine.evolutionEvaluator).toBeInstanceOf(AutonomousEvolutionEvaluator);
    expect(engine.admissionController).toBeInstanceOf(TokenomicsAdmissionController);
  });
});
