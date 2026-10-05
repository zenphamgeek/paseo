import { createHash, randomUUID } from "node:crypto";
import type {
  AdmissionDecision,
  AdmissionRequest,
  AstCheckResult,
  AstPolicyRule,
  DriftReport,
  EpisodicMemoryEvent,
  SemanticMemoryItem,
  TrajectoryMetrics,
  TrajectoryScore,
} from "./types.js";

// Dimension for local semantic embedding space
const EMBEDDING_DIM = 64;

/**
 * Generate a deterministic L2-normalized pseudo-embedding vector for text.
 * Runs at $0 marginal cost in-process without cloud API calls.
 */
export function generateLocalEmbedding(text: string): number[] {
  if (!text || text.trim().length === 0) {
    return Array.from<number>({ length: EMBEDDING_DIM }).fill(0);
  }

  const vector = Array.from<number>({ length: EMBEDDING_DIM }).fill(0);
  const normalizedText = text.toLowerCase().trim();
  const words = normalizedText.split(/[\s,._\-:;!?/\\]+/).filter(Boolean);

  if (words.length === 0) {
    return Array.from<number>({ length: EMBEDDING_DIM }).fill(0);
  }

  for (const word of words) {
    const h = createHash("sha256").update(word).digest();
    const bucket = h.readUInt16BE(0) % EMBEDDING_DIM;
    const sign = h[2] & 1 ? 1 : -1;
    vector[bucket] += sign;

    // Subword n-grams for morphological overlap (e.g. deploy in deployed/deployment)
    if (word.length >= 3) {
      for (let len = 3; len <= Math.min(6, word.length); len++) {
        const subword = word.slice(0, len);
        const subH = createHash("sha256").update(subword).digest();
        const subBucket = subH.readUInt16BE(0) % EMBEDDING_DIM;
        const subSign = subH[2] & 1 ? 1 : -1;
        vector[subBucket] += subSign * 0.6;
      }
    }
  }

  // Compute L2 norm: ||v||
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    sumSq += vector[i] * vector[i];
  }

  if (sumSq === 0) {
    return Array.from<number>({ length: EMBEDDING_DIM }).fill(0);
  }

  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    vector[i] = vector[i] / norm;
  }

  return vector;
}

/**
 * Compute cosine similarity between two L2-normalized vectors.
 * Returns 0 if either vector is zero-magnitude.
 */
export function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dotProduct = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normASq += vecA[i] * vecA[i];
    normBSq += vecB[i] * vecB[i];
  }

  if (normASq === 0 || normBSq === 0) return 0;
  const similarity = dotProduct / (Math.sqrt(normASq) * Math.sqrt(normBSq));
  return Number.isFinite(similarity) ? similarity : 0;
}

/**
 * 1. Periodic Memory Consolidator
 * Compacting raw episodic interaction logs into semantic memory embeddings
 */
export class PeriodicMemoryConsolidator {
  private readonly episodes: EpisodicMemoryEvent[] = [];
  private readonly semanticStore: SemanticMemoryItem[] = [];

  public recordEpisode(event: EpisodicMemoryEvent): void {
    this.episodes.push({ ...event, consolidated: false });
  }

  public getUnconsolidatedEpisodes(): EpisodicMemoryEvent[] {
    return this.episodes.filter((e) => !e.consolidated);
  }

  public getAllSemanticMemories(): SemanticMemoryItem[] {
    return [...this.semanticStore];
  }

  /**
   * Compaction cycle: groups unconsolidated episodes, produces semantic summary,
   * hashes provenance, generates L2 embedding, and commits to semantic store.
   */
  public consolidate(options?: {
    minEpisodes?: number;
    summaryPrefix?: string;
  }): SemanticMemoryItem[] {
    const minEpisodes = options?.minEpisodes ?? 1;
    const unconsolidated = this.getUnconsolidatedEpisodes();

    if (unconsolidated.length < minEpisodes) {
      return [];
    }

    // Group episodes by session
    const sessions = new Map<string, EpisodicMemoryEvent[]>();
    for (const ep of unconsolidated) {
      const list = sessions.get(ep.sessionId) || [];
      list.push(ep);
      sessions.set(ep.sessionId, list);
    }

    const createdItems: SemanticMemoryItem[] = [];

    for (const [sessionId, eps] of sessions) {
      const episodeIds = eps.map((e) => e.id).sort();
      const contentDigest = eps.map((e) => `${e.role}:${e.content}`).join("\n");

      // RFC 8785 deterministic provenance hash
      const provenanceHash = createHash("sha256")
        .update(JSON.stringify({ sessionId, episodeIds, contentDigest }))
        .digest("hex");

      const summaryText =
        (options?.summaryPrefix ? `${options.summaryPrefix}: ` : "") +
        `Session ${sessionId} compacted ${eps.length} events: ` +
        eps
          .slice(-3)
          .map((e) => `[${e.role}] ${e.content.slice(0, 100)}`)
          .join(" | ");

      const embedding = generateLocalEmbedding(summaryText);

      // Extract high-value tags from roles and keywords
      const tags = Array.from(
        new Set([
          `session:${sessionId}`,
          ...eps.map((e) => e.role),
          ...(eps
            .map((e) => e.content)
            .join(" ")
            .toLowerCase()
            .match(/\b(router|onnx|clef|vitest|build|fleet|handoff|deploy|database)\b/g) || []),
        ]),
      );

      const item: SemanticMemoryItem = {
        id: `sem-${randomUUID()}`,
        summary: summaryText,
        embedding,
        sourceEpisodeIds: episodeIds,
        provenanceHash,
        createdAt: Date.now(),
        tags,
      };

      this.semanticStore.push(item);
      createdItems.push(item);

      // Mark source episodes as consolidated
      for (const ep of eps) {
        ep.consolidated = true;
      }
    }

    return createdItems;
  }

  /**
   * Search semantic memory by cosine similarity
   * Strict filtering: similarity > threshold (default 0.70)
   */
  public searchSemanticMemory(
    query: string,
    options?: { topK?: number; threshold?: number },
  ): Array<{ item: SemanticMemoryItem; similarity: number }> {
    const topK = options?.topK ?? 5;
    const threshold = options?.threshold ?? 0.7;

    const queryVec = generateLocalEmbedding(query);

    // Guard: zero-vector queries return empty results
    let isZero = true;
    for (const val of queryVec) {
      if (val !== 0) {
        isZero = false;
        break;
      }
    }
    if (isZero) return [];

    const scored = this.semanticStore
      .map((item) => {
        const similarity = computeCosineSimilarity(queryVec, item.embedding);
        return { item, similarity };
      })
      .filter((entry) => entry.similarity > threshold);

    // Sort descending by similarity, tie-breaking deterministically by recency and id
    scored.sort((a, b) => {
      if (Math.abs(b.similarity - a.similarity) > 1e-6) {
        return b.similarity - a.similarity;
      }
      if (b.item.createdAt !== a.item.createdAt) {
        return b.item.createdAt - a.item.createdAt;
      }
      return a.item.id.localeCompare(b.item.id);
    });

    return scored.slice(0, topK);
  }
}

/**
 * 2. Autonomous Evolution & AST Policy Evaluator
 * Trajectory scoring, sliding window drift detection, and AST policy checks
 */
export class AutonomousEvolutionEvaluator {
  private readonly defaultRules: AstPolicyRule[] = [
    {
      id: "AST-NO-HARDCODED-SECRETS",
      severity: "error",
      pattern:
        /(?:api[_-]?key|secret|password|bearer|auth[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/i,
      description:
        "Hardcoded secret or token detected. Use environment variables or secret manager.",
    },
    {
      id: "AST-NO-UNSAFE-EVAL",
      severity: "error",
      pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
      description: "Unsafe dynamic code execution (`eval` or `new Function`) is prohibited.",
    },
    {
      id: "AST-STRICT-TYPING-NO-ANY",
      severity: "warning",
      pattern: /:\s*any\b|\bas\s+any\b/,
      description: "Unchecked `any` type assertion detected. Use precise interfaces or `unknown`.",
    },
  ];

  public scoreTrajectory(metrics: TrajectoryMetrics): TrajectoryScore {
    const toolCalls = Math.max(1, metrics.toolCalls);
    const toolErrorRate = metrics.toolErrors / toolCalls;

    // Fitness calculation:
    // Success: 0.60, Clean Tool Rate: up to 0.25, Step Efficiency: up to 0.15
    const successBonus = metrics.success ? 0.6 : 0.0;
    const errorScore = Math.max(0, (1 - toolErrorRate) * 0.25);
    const stepPenalty = Math.max(0, (metrics.steps - 10) * 0.01);
    const stepScore = Math.max(0, 0.15 - stepPenalty);

    const fitness = Math.min(1.0, Math.max(0.0, successBonus + errorScore + stepScore));

    let evaluation: TrajectoryScore["evaluation"] = "failing";
    if (fitness >= 0.85) evaluation = "optimal";
    else if (fitness >= 0.7) evaluation = "acceptable";
    else if (fitness >= 0.5) evaluation = "suboptimal";

    return {
      fitness: Math.round(fitness * 100) / 100,
      toolErrorRate: Math.round(toolErrorRate * 100) / 100,
      stepEfficiency: Math.round(stepScore * 100) / 100,
      evaluation,
    };
  }

  public detectDrift(
    history: TrajectoryMetrics[],
    current: TrajectoryMetrics,
    config?: {
      windowSize?: number;
      errorRateThreshold?: number;
      minSamples?: number;
    },
  ): DriftReport {
    const windowSize = config?.windowSize ?? 20;
    const errorRateThreshold = config?.errorRateThreshold ?? 0.3;
    const minSamples = config?.minSamples ?? 10;

    const fullHistory = [...history, current];
    const recentWindow = fullHistory.slice(-windowSize);

    if (recentWindow.length < minSamples) {
      return {
        driftDetected: false,
        status: "insufficient_samples",
        currentErrorRate: 0,
        baselineErrorRate: 0,
        sampleCount: recentWindow.length,
        action: "continue",
      };
    }

    let totalCalls = 0;
    let totalErrors = 0;
    for (const m of recentWindow) {
      totalCalls += Math.max(1, m.toolCalls);
      totalErrors += m.toolErrors;
    }

    const currentRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
    const isDrifting = currentRate > errorRateThreshold;

    return {
      driftDetected: isDrifting,
      status: isDrifting ? "drift_alert" : "stable",
      currentErrorRate: Math.round(currentRate * 100) / 100,
      baselineErrorRate: errorRateThreshold,
      sampleCount: recentWindow.length,
      action: isDrifting ? "halt_or_replan" : "continue",
    };
  }

  public enforceAstPolicy(codeSnippet: string, customRules?: AstPolicyRule[]): AstCheckResult {
    const rules = customRules || this.defaultRules;
    const violations: Array<{ ruleId: string; description: string; match?: string }> = [];

    for (const rule of rules) {
      const match = rule.pattern.exec(codeSnippet);
      if (match) {
        violations.push({
          ruleId: rule.id,
          description: rule.description,
          match: match[0].slice(0, 50),
        });
      }
    }

    return {
      valid:
        violations.filter((v) => {
          const r = rules.find((rule) => rule.id === v.ruleId);
          return r?.severity === "error";
        }).length === 0,
      violations,
    };
  }
}

/**
 * 3. Tokenomics Admission Controller
 * Zero-marginal token cost routing & gating for Project Swarm
 */
export class TokenomicsAdmissionController {
  private readonly localConfidenceFloor: number;

  constructor(options?: { localConfidenceFloor?: number }) {
    this.localConfidenceFloor = options?.localConfidenceFloor ?? 0.8;
  }

  public evaluateAdmission(req: AdmissionRequest): AdmissionDecision {
    // 1. Budget depletion guard: remaining budget <= 0 always falls back safely to local ONNX at $0 cost!
    if (req.remainingBudget !== undefined && req.remainingBudget <= 0) {
      return {
        decision: "local",
        reason: "budget_exhausted_failover_to_local_onnx",
        billedCost: 0,
        confidence: 0.9,
        source: "local_onnx",
      };
    }

    // 2. Deterministic / local code tasks: always route local ($0)
    const lowerPrompt = req.prompt.toLowerCase();
    const isLocalCandidate =
      /\b(lint|oxlint|format|test|vitest|typecheck|status|git|commit|build|check)\b/.test(
        lowerPrompt,
      );

    if (isLocalCandidate && (!req.preferredTier || req.preferredTier === "local")) {
      return {
        decision: "local",
        reason: "deterministic_task_handled_locally_zero_token_cost",
        billedCost: 0,
        confidence: 0.95,
        source: "local_onnx",
      };
    }

    // 3. Ultra tier explicit escalation (Claude Opus / Deep reasoning)
    if (req.preferredTier === "ultra") {
      return {
        decision: "escalate_fleet_ultra",
        reason: "preferred_tier_ultra_deep_reasoning_requested",
        billedCost: Math.round(req.estimatedTokens * 0.000015 * 1000) / 1000,
        confidence: 0.98,
        source: "local_onnx",
      };
    }

    // 4. Pro tier explicit escalation (Gemini 3.8 Flash High)
    if (req.preferredTier === "pro") {
      return {
        decision: "escalate_fleet_pro",
        reason: "preferred_tier_pro_fleet_requested",
        billedCost: Math.round(req.estimatedTokens * 0.000005 * 1000) / 1000,
        confidence: 0.95,
        source: "local_onnx",
      };
    }

    // 5. High complexity / token volume gating
    if (
      req.estimatedTokens > 5000 ||
      /\b(architect|council|multi-perspective|refactor-all)\b/.test(lowerPrompt)
    ) {
      return {
        decision: "escalate_clef",
        reason: "high_stakes_architectural_judgment_requires_clef",
        billedCost: 0, // Clef structured judgment forward pass is token-neutral
        confidence: 0.85,
        source: "local_onnx",
      };
    }

    // Default: local execution at $0 cost
    return {
      decision: "local",
      reason: "standard_complexity_admitted_to_local_onnx",
      billedCost: 0,
      confidence: this.localConfidenceFloor,
      source: "local_onnx",
    };
  }
}
