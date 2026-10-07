import { z } from "zod";

export type NodeKind = "agy" | "codex" | "opencode" | "acp" | "nebula";

export type NodeState =
  | "booting"
  | "ready"
  | "busy"
  | "throttled"
  | "quota_exhausted"
  | "degraded"
  | "dead";

export type ModelTier = "ultra" | "pro" | "standard";

export const QuotaSnapshotSchema = z.object({
  usedTokens: z.number().default(0),
  tokenLimit: z.number().default(1000000),
  quotaPercent: z.number().default(100),
  resetsAt: z.number().nullable().default(null),
  lastCheckedAt: z.number().default(0),
});
export type QuotaSnapshot = z.infer<typeof QuotaSnapshotSchema>;

export const FleetNodeConfigSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  kind: z.enum(["agy", "codex", "opencode", "acp", "nebula"]),
  tier: z.enum(["ultra", "pro", "standard"]).default("pro"),
  accountEmail: z.string().optional(),
  homeDirectory: z.string(),
  caps: z.array(z.string()).default([]),
  preferredModel: z.string().optional(),
  allowedModels: z.array(z.string()).optional(),
  maxConcurrency: z.number().default(1),
  proxyId: z.string().optional(),
});
export type FleetNodeConfig = z.infer<typeof FleetNodeConfigSchema>;

export interface FleetNodeSummary {
  id: string;
  displayName?: string;
  kind: NodeKind;
  tier: ModelTier;
  state: NodeState;
  accountEmail?: string;
  caps?: string[];
  preferredModel?: string;
  allowedModels?: string[];
  proxyId?: string;
  geminiQuotaPercent?: number;
  claudeQuotaPercent?: number;
  geminiResetTime?: string | null;
  claudeResetTime?: string | null;
  quota: QuotaSnapshot;
  activeJobs: number;
  requestsServed: number;
  errorCount: number;
  lastHeartbeat: number;
  retentionPeriod?: string;
  tokensConsumed?: number;
  usdSaved?: number;
  label?: string | null;
  domainSpecialization?: string[];
  trustScore?: number;
  ineligible?: boolean;
  ineligibleReason?: string | null;
  geminiResetCountdownS?: number;
  claudeResetCountdownS?: number;
}

export interface FleetClusterSummary {
  totalNodes: number;
  onlineNodes: number;
  busyNodes: number;
  ultraNodes: number;
  proNodes: number;
  agyNodes?: number;
  opencodeNodes?: number;
  totalTokensCapacity: number;
  totalTokensUsed: number;
  overallQuotaPercent: number;
  clusterHealth: "healthy" | "degraded" | "critical";
  autonomousEnabled: boolean;
  activeCouncilMode: string;
}

export interface FleetJobRecord {
  id: string;
  taskId: string;
  prompt: string;
  nodeId: string;
  model: string;
  status: "queued" | "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  durationMs?: number;
  tokensUsed?: number;
  outputPreview?: string;
  error?: string;
}

export const RouteRequestSchema = z.object({
  taskId: z.string(),
  prompt: z.string(),
  tokensEstimate: z.number().default(2000),
  requiredCaps: z.array(z.string()).default([]),
  preferredTier: z.enum(["ultra", "pro", "standard"]).default("pro"),
});
export type RouteRequest = z.infer<typeof RouteRequestSchema>;

export interface RouteDecision {
  nodeId: string;
  model: string;
  fallbackChain: Array<{ nodeId: string; model: string }>;
}

export const ClefGateMetadataSchema = z.object({
  model: z.string(),
  latencyMs: z.number().optional(),
  complexityScore: z.number().optional(),
  decision: z.string().optional(),
  tokensSaved: z.number().optional(),
});
export type ClefGateMetadata = z.infer<typeof ClefGateMetadataSchema>;

export const FleetExecutionMetadataSchema = z.object({
  isFleetMode: z.boolean().default(true),
  orchestratorNode: z.string(),
  orchestratorModel: z.string(),
  workerNode: z.string(),
  workerModel: z.string(),
  tier: z.enum(["ultra", "pro", "standard"]).optional(),
  taskId: z.string().optional(),
  dispatchedAt: z.string().optional(),
  clefGate: ClefGateMetadataSchema.optional(),
});
export type FleetExecutionMetadata = z.infer<typeof FleetExecutionMetadataSchema>;

export const TaskGateEnum = z.enum(["lint", "types", "unit_tests", "security_audit"]);
export type TaskGate = z.infer<typeof TaskGateEnum>;

export const TaskContractSchema = z.object({
  id: z.string(),
  goal: z.string(),
  acceptanceCriteria: z.array(z.string()).min(1),
  affectedArtifacts: z.array(z.string()).default([]),
  gates: z.array(TaskGateEnum).default(["types", "lint"]),
});
export type TaskContract = z.infer<typeof TaskContractSchema>;

export interface CouncilVerdict {
  gate: TaskGate;
  passed: boolean;
  exitCode: number;
  rawOutputHash: string;
  evidence: string;
  remediationAdvice?: string;
}

export type SubTaskStatus =
  | "pending"
  | "dispatched"
  | "verifying"
  | "remediating"
  | "done"
  | "failed";

export interface SubTaskDAG {
  id: string;
  contract: TaskContract;
  dependencies: string[];
  status: SubTaskStatus;
  assignedNodeId?: string;
  retryCount: number;
}

export type GoalState =
  | "intent_parsing"
  | "decomposing"
  | "parallel_dispatch"
  | "verifying"
  | "remediating"
  | "achieved"
  | "aborted";

export interface GoalStatusSnapshot {
  id: string;
  intent: string;
  state: GoalState;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  maxRetries: number;
  budgetTokensUsed: number;
  budgetCapTokens: number;
}

export const ClefCouncilModeSchema = z.enum(["deterministic-only", "local", "cloud", "hybrid"]);
export type ClefCouncilMode = z.infer<typeof ClefCouncilModeSchema>;

export const LlmProviderTypeSchema = z.enum([
  "ollama",
  "vllm",
  "llamacpp",
  "9router",
  "nebula",
  "openai-compatible",
]);
export type LlmProviderType = z.infer<typeof LlmProviderTypeSchema>;

export const LlmEndpointConfigSchema = z.object({
  baseUrl: z.string(),
  model: z.string(),
  provider: LlmProviderTypeSchema,
  apiKeyEnv: z.string().optional(),
  temperature: z.number().default(0.1),
  seed: z.number().int().optional(),
  maxTokens: z.number().int().default(4096),
  timeoutMs: z.number().int().default(45000),
});
export type LlmEndpointConfig = z.infer<typeof LlmEndpointConfigSchema>;

export const EscalationPolicySchema = z.object({
  enabled: z.boolean().default(true),
  minLocalConfidence: z.number().default(0.8),
  criticalTaskClasses: z
    .array(z.string())
    .default(["auth", "security", "crypto", "database", "infra"]),
  escalationPaths: z
    .array(z.string())
    .default(["**/auth/**", "**/security/**", "**/*.pem", "**/migrations/**"]),
  escalateOnAnyFlag: z.boolean().default(true),
});
export type EscalationPolicy = z.infer<typeof EscalationPolicySchema>;

export const FallbackPolicySchema = z.object({
  onLlmError: z.enum(["fail-closed", "fail-open", "degrade-to-local"]).default("degrade-to-local"),
  maxRetries: z.number().int().default(2),
  retryBackoffMs: z.number().int().default(2000),
  cloudToLocalFallback: z.boolean().default(true),
});
export type FallbackPolicy = z.infer<typeof FallbackPolicySchema>;

export const SemanticGateIdSchema = z.enum([
  "model-as-judge",
  "anti-cheat",
  "security-audit",
  "intent-adherence",
]);
export type SemanticGateId = z.infer<typeof SemanticGateIdSchema>;

export const JudgeVerdictSchema = z.object({
  gateId: SemanticGateIdSchema,
  verdict: z.enum(["pass", "fail", "flag"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  flags: z.array(z.string()).default([]),
  model: z.string(),
  tier: z.enum(["local", "cloud"]),
  latencyMs: z.number().nonnegative(),
  rawOutputHash: z.string(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export const ClefCouncilConfigSchema = z.object({
  mode: ClefCouncilModeSchema.default("hybrid"),
  deterministicGates: z
    .object({
      enabled: z.array(z.string()).default(["lint", "types", "unit_tests", "security_audit"]),
      failFast: z.boolean().default(true),
    })
    .default(() => ({
      enabled: ["lint", "types", "unit_tests", "security_audit"],
      failFast: true,
    })),
  local: z
    .object({
      members: z.array(LlmEndpointConfigSchema).default([]),
    })
    .optional(),
  cloud: z
    .object({
      members: z.array(LlmEndpointConfigSchema).default([]),
    })
    .optional(),
  escalation: EscalationPolicySchema.default(() => EscalationPolicySchema.parse({})),
  fallback: FallbackPolicySchema.default(() => FallbackPolicySchema.parse({})),
  globalSlaMs: z.number().int().default(180000),
});
export type ClefCouncilConfig = z.infer<typeof ClefCouncilConfigSchema>;
