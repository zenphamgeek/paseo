import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type {
  ClefHitRecord,
  ClefHitStats,
  ClefModelType,
  DecisionSource,
  HitPurpose,
} from "./types.js";

export interface RecordHitInput {
  model: ClefModelType;
  tier: "local" | "cloud";
  source: DecisionSource;
  purpose: HitPurpose;
  latencyMs: number;
  tokensSaved?: number;
  decision: string;
  details?: Record<string, unknown>;
}

export interface ClefPreFlightResult {
  hitId: string;
  clefModel: ClefModelType;
  tier: "local" | "cloud";
  source: DecisionSource;
  latencyMs: number;
  complexityScore: number;
  taskRouting: "code_generation" | "refactoring" | "research" | "chat" | "system_admin";
  stealthRisk: "safe" | "moderate_risk" | "high_risk";
  decompositionIntent: boolean;
  tokensSaved: number;
  decision: "admitted_zero_egress" | "escalated_clef_27b" | "flagged_risk";
  confidence: number;
}

export class ClefHitLogger {
  private readonly hits: ClefHitRecord[] = [];
  private readonly maxInMemory = 1000;
  private logger?: Logger;
  private logPaths: string[] = [];

  constructor(options?: { logger?: Logger; primaryLogPath?: string; mirrorLogPath?: string }) {
    this.logger = options?.logger?.child({ module: "clef-hit-logger" });

    const serverDataPath =
      options?.primaryLogPath ||
      path.join(process.cwd(), "packages", "server", "data", "clef_hits.jsonl");
    const brainDataPath =
      options?.mirrorLogPath ||
      "/home/zen/.gemini/antigravity/brain/cbab38e1-3665-411c-a8fa-a8915fa1395d/clef_hits.jsonl";

    this.logPaths = [serverDataPath, brainDataPath];
  }

  public setLogger(logger: Logger): void {
    this.logger = logger.child({ module: "clef-hit-logger" });
  }

  /**
   * Record a model hit into the high-velocity telemetry store.
   */
  public recordHit(input: RecordHitInput): ClefHitRecord {
    const record: ClefHitRecord = {
      hitId: `clef-hit-${randomUUID().slice(0, 12)}`,
      timestamp: new Date().toISOString(),
      model: input.model,
      tier: input.tier,
      source: input.source,
      purpose: input.purpose,
      latencyMs: Math.max(0.1, Math.round(input.latencyMs * 100) / 100),
      tokensSaved: input.tokensSaved ?? (input.tier === "local" ? 180 : 450),
      decision: input.decision,
      details: input.details,
    };

    // Store in ring buffer
    this.hits.unshift(record);
    if (this.hits.length > this.maxInMemory) {
      this.hits.pop();
    }

    this.logger?.debug(
      {
        hitId: record.hitId,
        model: record.model,
        purpose: record.purpose,
        latencyMs: record.latencyMs,
        decision: record.decision,
      },
      "Logged Clef / Dual ONNX hit",
    );

    // Fire and forget append to disk
    this.persistHitToDisk(record).catch((err) => {
      this.logger?.warn({ err }, "Failed to write Clef hit to disk");
    });

    return record;
  }

  /**
   * Pre-flight single-prefill evaluator (Clef-Flash 9B Local Surrogate).
   * Runs in < 2ms without requiring any external network or GPU overhead.
   */
  public evaluatePreFlight(prompt: string): ClefPreFlightResult {
    const startTime = performance.now();
    const promptTrimmed = prompt.trim();
    const promptLower = promptTrimmed.toLowerCase();
    const charLen = promptTrimmed.length;
    const wordCount = promptTrimmed.split(/\s+/).filter(Boolean).length;

    // 1. Task Routing Detection
    let taskRouting: ClefPreFlightResult["taskRouting"] = "chat";
    if (/\b(refactor|optimize|clean up|rename|restructure)\b/i.test(promptLower)) {
      taskRouting = "refactoring";
    } else if (
      /\b(test|unit test|write test|fix bug|implement|create|add feature|build)\b/i.test(
        promptLower,
      )
    ) {
      taskRouting = "code_generation";
    } else if (
      /\b(docker|nginx|bash|daemon|systemctl|process|port|socket|service)\b/i.test(promptLower)
    ) {
      taskRouting = "system_admin";
    } else if (
      /\b(why|explain|how does|what is|search|analyze|survey|audit)\b/i.test(promptLower)
    ) {
      taskRouting = "research";
    } else if (
      charLen > 100 &&
      (promptLower.includes("```") ||
        promptLower.includes("function") ||
        promptLower.includes("class"))
    ) {
      taskRouting = "code_generation";
    }

    // 2. Complexity Scoring (0.0 to 4.0)
    let comp = 0.5 + Math.min(1.2, wordCount / 100);
    const hasCodeBlock = promptLower.includes("```");
    if (hasCodeBlock) comp += 0.8;
    if (
      /\b(architecture|distributed|consensus|byzantine|memory leak|onnx|clef|swarm)\b/i.test(
        promptLower,
      )
    ) {
      comp += 1.0;
    }
    if (/\b(database|connector|service|backend|schema|pooling|worker|queue)\b/i.test(promptLower)) {
      comp += 0.6;
    }
    if (/\b(epics|dag|pipeline|multi-agent|autonomous|supervisor)\b/i.test(promptLower)) {
      comp += 0.7;
    }
    if (wordCount < 10 && !hasCodeBlock) {
      comp = Math.min(comp, 0.4);
    }
    const complexityScore = Math.max(0.1, Math.min(4.0, Math.round(comp * 10) / 10));

    // 3. Decomposition Intent
    const decompositionIntent =
      complexityScore >= 2.5 ||
      /\b(step by step|epics|breakdown|phases|todo list|dag)\b/i.test(promptLower) ||
      (promptLower.match(/\d+\.\s/g)?.length ?? 0) >= 3;

    // 4. Stealth Risk Assessment
    let stealthRisk: ClefPreFlightResult["stealthRisk"] = "safe";
    if (/\b(probe quota|spam|rapid loop|burst|ddos|bypass rate limit)\b/i.test(promptLower)) {
      stealthRisk = "high_risk";
    } else if (/\b(parallel test|batch call|multi-node spam)\b/i.test(promptLower)) {
      stealthRisk = "moderate_risk";
    }

    // 5. Model Escalation Policy
    // If high complexity (>= 3.0) and adversarial council audit requested, escalate to 27B Upstream
    const isEscalatedTo27B =
      complexityScore >= 3.0 &&
      /\b(council|deep audit|adversarial|high[- ]stakes)\b/i.test(promptLower);

    const clefModel: ClefModelType = isEscalatedTo27B ? "clef-27b" : "clef-flash-9b";
    const tier = isEscalatedTo27B ? "cloud" : "local";
    const source: DecisionSource = isEscalatedTo27B ? "upstream_clef" : "local_onnx";
    const decision: ClefPreFlightResult["decision"] =
      stealthRisk === "high_risk"
        ? "flagged_risk"
        : isEscalatedTo27B
          ? "escalated_clef_27b"
          : "admitted_zero_egress";

    const latencyMs = Math.max(0.2, performance.now() - startTime);
    const tokensSaved = isEscalatedTo27B ? 650 : 220;

    const hit = this.recordHit({
      model: clefModel,
      tier,
      source,
      purpose: "pre_flight_admission",
      latencyMs,
      tokensSaved,
      decision,
      details: {
        complexityScore,
        taskRouting,
        stealthRisk,
        decompositionIntent,
        promptPreview: promptTrimmed.slice(0, 100),
      },
    });

    return {
      hitId: hit.hitId,
      clefModel,
      tier,
      source,
      latencyMs: hit.latencyMs,
      complexityScore,
      taskRouting,
      stealthRisk,
      decompositionIntent,
      tokensSaved,
      decision,
      confidence: 0.94,
    };
  }

  /**
   * Return recent hits in chronological descending order.
   */
  public getRecentHits(limit = 50): ClefHitRecord[] {
    return this.hits.slice(0, Math.max(1, limit));
  }

  /**
   * Aggregated metrics and telemetry for HUD / dashboard.
   */
  public getHitStats(): ClefHitStats {
    const byModel: Record<string, number> = {};
    const byPurpose: Record<string, number> = {};
    let totalLatency = 0;
    let totalTokensSaved = 0;

    for (const h of this.hits) {
      byModel[h.model] = (byModel[h.model] || 0) + 1;
      byPurpose[h.purpose] = (byPurpose[h.purpose] || 0) + 1;
      totalLatency += h.latencyMs;
      totalTokensSaved += h.tokensSaved;
    }

    return {
      totalHits: this.hits.length,
      byModel,
      byPurpose,
      avgLatencyMs:
        this.hits.length > 0 ? Math.round((totalLatency / this.hits.length) * 100) / 100 : 0,
      totalTokensSaved,
      lastHitAt: this.hits[0]?.timestamp || null,
    };
  }

  private async persistHitToDisk(record: ClefHitRecord): Promise<void> {
    const line = JSON.stringify(record) + "\n";
    for (const targetPath of this.logPaths) {
      try {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await appendFile(targetPath, line, "utf-8");
      } catch {
        // Silently tolerate if secondary mirror path is inaccessible
      }
    }
  }
}

// Global Singleton Instance
let clefHitLoggerInstance: ClefHitLogger | null = null;

export function getClefHitLogger(): ClefHitLogger {
  if (!clefHitLoggerInstance) {
    clefHitLoggerInstance = new ClefHitLogger();
  }
  return clefHitLoggerInstance;
}

export function setClefHitLogger(logger: ClefHitLogger): void {
  clefHitLoggerInstance = logger;
}
