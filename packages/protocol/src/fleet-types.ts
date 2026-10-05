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
  kind: z.enum(["agy", "codex", "opencode", "acp", "nebula"]),
  tier: z.enum(["ultra", "pro", "standard"]).default("pro"),
  accountEmail: z.string().optional(),
  homeDirectory: z.string(),
  caps: z.array(z.string()).default([]),
  preferredModel: z.string().optional(),
  maxConcurrency: z.number().default(1),
  proxyId: z.string().optional(),
});
export type FleetNodeConfig = z.infer<typeof FleetNodeConfigSchema>;

export interface FleetNodeSummary {
  id: string;
  kind: NodeKind;
  tier: ModelTier;
  state: NodeState;
  accountEmail?: string;
  quota: QuotaSnapshot;
  activeJobs: number;
  requestsServed: number;
  errorCount: number;
  lastHeartbeat: number;
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
