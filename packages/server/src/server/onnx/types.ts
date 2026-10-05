/**
 * Zencode Dual ONNX Substrate — Core Types
 * Upstream Reference: https://huggingface.co/Cloudflare/clef
 * Protocol: SystemOne /v1/systemone
 */

export type DecisionSource = "upstream_clef" | "local_onnx" | "local_fallback";

export interface ClefOption {
  id: string;
  label: string;
}

export interface ClefSchema {
  question: string;
  type: "choice" | "score" | "boolean";
  options: ClefOption[];
}

export interface ClefSystemOneRequest {
  task_id: string;
  context: Record<string, unknown>;
  schema: ClefSchema;
}

export interface ClefSystemOneResponse {
  decision_id: string;
  schema_version: string;
  scores: Record<string, number>;
  selected_option: string;
  confidence: number;
  latency_ms: number;
  cost_tokens: number;
  source: DecisionSource;
  upstream_url?: string;
}

export interface EpisodicMemoryEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  role: "user" | "agent" | "tool" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  consolidated?: boolean;
}

export interface SemanticMemoryItem {
  id: string;
  summary: string;
  embedding: number[]; // L2-normalized vector
  sourceEpisodeIds: string[];
  provenanceHash: string;
  createdAt: number;
  tags: string[];
}

export interface TrajectoryMetrics {
  taskId: string;
  success: boolean;
  steps: number;
  toolCalls: number;
  toolErrors: number;
  latencyMs: number;
  tokensCost: number;
}

export interface TrajectoryScore {
  fitness: number; // 0.0 to 1.0
  toolErrorRate: number;
  stepEfficiency: number;
  evaluation: "optimal" | "acceptable" | "suboptimal" | "failing";
}

export interface DriftReport {
  driftDetected: boolean;
  status: "stable" | "insufficient_samples" | "drift_alert";
  currentErrorRate: number;
  baselineErrorRate: number;
  sampleCount: number;
  action: "continue" | "halt_or_replan" | "tune_policy";
}

export interface AstPolicyRule {
  id: string;
  severity: "error" | "warning";
  pattern: RegExp;
  description: string;
}

export interface AstCheckResult {
  valid: boolean;
  violations: Array<{ ruleId: string; description: string; match?: string }>;
}

export interface AdmissionRequest {
  taskId: string;
  prompt: string;
  estimatedTokens: number;
  preferredTier?: "local" | "pro" | "ultra";
  remainingBudget?: number;
}

export interface AdmissionDecision {
  decision: "local" | "escalate_clef" | "escalate_fleet_pro" | "escalate_fleet_ultra";
  reason: string;
  billedCost: number;
  confidence: number;
  source: DecisionSource;
}
