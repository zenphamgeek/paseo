import { randomUUID } from "node:crypto";
import type { ClefSystemOneRequest, ClefSystemOneResponse, DecisionSource } from "./types.js";

/**
 * Cloudflare Clef Upstream Client
 * Upstream Reference: https://huggingface.co/Cloudflare/clef
 * SystemOne Single-Pass Typed Schema Evaluator with Fast-Fail Circuit Breaker
 */
export interface BreakerConfig {
  timeoutMs: number;
  failureThreshold: number;
  halfOpenAfterMs: number;
}

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class ClefUpstreamClient {
  public static readonly OFFICIAL_UPSTREAM_URL = "https://huggingface.co/Cloudflare/clef";

  private readonly endpoint: string;
  private readonly apiToken?: string;
  private readonly breakerConfig: BreakerConfig;

  private breakerState: BreakerState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(options?: {
    endpoint?: string;
    apiToken?: string;
    breakerConfig?: Partial<BreakerConfig>;
  }) {
    this.endpoint =
      options?.endpoint ||
      process.env.ZENCODE_CLEF_ENDPOINT ||
      "https://api.cloudflare.com/client/v4/accounts/clef/v1/systemone";
    this.apiToken = options?.apiToken || process.env.ZENCODE_CLEF_API_TOKEN;
    this.breakerConfig = {
      timeoutMs: options?.breakerConfig?.timeoutMs ?? 1500,
      failureThreshold: options?.breakerConfig?.failureThreshold ?? 5,
      halfOpenAfterMs: options?.breakerConfig?.halfOpenAfterMs ?? 30000,
    };
  }

  public getBreakerState(): BreakerState {
    this.checkHalfOpenTransition();
    return this.breakerState;
  }

  public getFailureCount(): number {
    return this.failureCount;
  }

  public resetBreaker(): void {
    this.breakerState = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  private checkHalfOpenTransition(): void {
    if (this.breakerState === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.breakerConfig.halfOpenAfterMs) {
        this.breakerState = "HALF_OPEN";
      }
    }
  }

  public async evaluate(req: ClefSystemOneRequest): Promise<ClefSystemOneResponse> {
    const startTime = performance.now();
    this.checkHalfOpenTransition();

    // Circuit breaker fast-fail when OPEN
    if (this.breakerState === "OPEN") {
      return this.localFallbackEvaluation(req, performance.now() - startTime, "local_fallback");
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.breakerConfig.timeoutMs);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Zencode-Upstream": ClefUpstreamClient.OFFICIAL_UPSTREAM_URL,
      };
      if (this.apiToken) {
        headers["Authorization"] = `Bearer ${this.apiToken}`;
      }

      const res = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        throw new Error(`Upstream Clef HTTP ${res.status}: ${res.statusText}`);
      }

      const json = (await res.json()) as Partial<ClefSystemOneResponse>;
      if (!json.scores || !json.selected_option) {
        throw new Error("Invalid SystemOne response schema from upstream Clef");
      }

      // Success: reset failure count
      if (this.breakerState === "HALF_OPEN") {
        this.breakerState = "CLOSED";
      }
      this.failureCount = 0;

      return {
        decision_id: json.decision_id || `clef-${randomUUID()}`,
        schema_version: json.schema_version || "clef.systemone.v1",
        scores: json.scores,
        selected_option: json.selected_option,
        confidence: json.confidence ?? 0.95,
        latency_ms: Math.round(performance.now() - startTime),
        cost_tokens: json.cost_tokens ?? 0,
        source: "upstream_clef",
        upstream_url: ClefUpstreamClient.OFFICIAL_UPSTREAM_URL,
      };
    } catch {
      this.recordFailure();
      return this.localFallbackEvaluation(req, performance.now() - startTime, "local_fallback");
    }
  }

  private recordFailure(): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.breakerConfig.failureThreshold) {
      this.breakerState = "OPEN";
    }
  }

  /**
   * Deterministic local fallback schema evaluator when upstream Clef is unreachable or times out
   */
  public localFallbackEvaluation(
    req: ClefSystemOneRequest,
    latencyMs: number,
    source: DecisionSource = "local_fallback",
  ): ClefSystemOneResponse {
    const options = req.schema.options;
    if (options.length === 0) {
      return {
        decision_id: `fallback-${randomUUID()}`,
        schema_version: "clef.systemone.v1",
        scores: {},
        selected_option: "default",
        confidence: 0.5,
        latency_ms: Math.max(1, Math.round(latencyMs)),
        cost_tokens: 0,
        source,
      };
    }

    // Deterministic heuristic scoring across context tokens
    const contextStr = JSON.stringify(req.context).toLowerCase();
    const scores: Record<string, number> = {};
    let totalScore = 0;

    for (const opt of options) {
      const optKey = opt.id.toLowerCase();
      const labelKey = opt.label.toLowerCase();

      let matchCount = 1; // base prior
      for (const word of optKey.split(/[_-]/)) {
        if (word && contextStr.includes(word)) matchCount += 3;
      }
      for (const word of labelKey.split(/\s+/)) {
        if (word && contextStr.includes(word)) matchCount += 2;
      }

      scores[opt.id] = matchCount;
      totalScore += matchCount;
    }

    // Normalize scores to probabilities
    let highestScore = -1;
    let selectedOption = options[0].id;
    for (const opt of options) {
      const normalized = Math.round((scores[opt.id] / totalScore) * 100) / 100;
      scores[opt.id] = normalized;
      if (normalized > highestScore) {
        highestScore = normalized;
        selectedOption = opt.id;
      }
    }

    return {
      decision_id: `fallback-${randomUUID()}`,
      schema_version: "clef.systemone.v1",
      scores,
      selected_option: selectedOption,
      confidence: highestScore > 0 ? highestScore : 0.8,
      latency_ms: Math.max(1, Math.round(latencyMs)),
      cost_tokens: 0,
      source,
    };
  }
}
