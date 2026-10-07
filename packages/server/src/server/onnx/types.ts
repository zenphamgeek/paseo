/**
 * Zencode Dual ONNX Substrate — Core Types
 * Upstream Reference: https://huggingface.co/Cloudflare/clef
 * Protocol: SystemOne /v1/systemone
 */

export type DecisionSource =
  | "upstream_clef"
  | "local_onnx"
  | "local_fallback"
  | "circuit_breaker"
  | "cloudflare_workers_ai";

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

export type ClefModelType =
  | "clef-flash-9b"
  | "clef-27b"
  | "dual-onnx-embed"
  | "dual-onnx-vad"
  | "cloudflare-workers-ai"
  | (string & {});

export type HitPurpose =
  | "pre_flight_admission"
  | "intent_routing"
  | "complexity_scoring"
  | "council_gate"
  | "trajectory_eval"
  | "workers_ai_swarm";

export interface ClefHitRecord {
  hitId: string;
  timestamp: string;
  model: ClefModelType;
  tier: "local" | "cloud";
  source: DecisionSource;
  purpose: HitPurpose;
  latencyMs: number;
  tokensSaved: number;
  decision: string;
  details?: Record<string, unknown>;
}

export interface ClefHitStats {
  totalHits: number;
  byModel: Record<string, number>;
  byPurpose: Record<string, number>;
  avgLatencyMs: number;
  totalTokensSaved: number;
  lastHitAt: string | null;
}

export interface CloudflareFreeAccount {
  id: string;
  email: string;
  accountId: string;
  apiToken: string;
  dailyNeuronsLimit: number; // default: 10,000 neurons/day on free tier
  neuronsUsedToday: number;
  lastResetDateUtc: string; // YYYY-MM-DD
  status: "active" | "quota_exhausted" | "rate_limited" | "error";
  lastUsedTimestamp: number;
  egressProxy?: string;
}

export interface CloudflarePoolConfig {
  accounts: CloudflareFreeAccount[];
  defaultNeuronsPerPass?: number;
  fallbackToLocal9BOnExhausted?: boolean;
}

export interface CloudflarePoolStats {
  totalAccounts: number;
  activeAccounts: number;
  exhaustedAccounts: number;
  totalDailyPoolNeurons: number; // totalAccounts * 10,000
  totalNeuronsUsedToday: number;
  totalNeuronsRemainingToday: number;
  localFallbackCount: number;
  lastResetDateUtc: string;
}

export interface CloudflareRoutingResult {
  source: "upstream_cloudflare_free" | "local_9b_fallback";
  modelUsed: ClefModelType;
  accountEmail?: string;
  neuronsConsumed: number;
  fallbackReason?: string;
}
