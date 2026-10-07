import type {
  FleetClusterSummary,
  FleetJobRecord,
  FleetNodeSummary,
  ModelTier,
  NodeState,
} from "@getpaseo/protocol/fleet-types";

export type { FleetClusterSummary, FleetJobRecord, FleetNodeSummary, ModelTier, NodeState };

export type FleetActiveTab =
  | "onboarding"
  | "nodes"
  | "autonomous"
  | "analytics"
  | "gpu_swarm"
  | "council"
  | "runner"
  | "jobs"
  | "telemetry"
  | "auth"
  | "self_healing";

export interface IncidentRecord {
  id: string;
  sha: string;
  timestamp: number;
  source: string;
  severity: "info" | "warning" | "critical";
  hookName?: string;
  toolName?: string;
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  command?: string;
  workspaceDir: string;
  status: string;
  proposedFix?: {
    summary: string;
    rootCause: string;
    patchFiles: Array<{ path: string; diff: string }>;
    suggestedCommitMessage: string;
    verificationSteps: string[];
    createdAt: number;
  };
  branchName?: string;
  prUrl?: string;
}

export interface CircuitBreakerUIStatus {
  isTripped: boolean;
  isolatedHooks: string[];
  failureCounts: Record<string, number>;
  threshold: number;
}

export type EcosystemType = "agy" | "opencode" | "codex" | "paseo" | "infra" | "workspace";

export interface PluginOAuthStatus {
  provider: string;
  label: string;
  ecosystem?: EcosystemType;
  status: "authenticated" | "discovered" | "unconfigured";
  authType: "oauth" | "api_key" | "cli_session" | "none";
  source?: string;
  account?: string;
  maskedToken?: string;
  configuredAt?: number;
}

export type FleetAuthMatrix = Record<string, PluginOAuthStatus>;

export type NodeAttentionLevel = "critical" | "warning" | "active" | "healthy";

export interface NodeAttentionMeta {
  level: NodeAttentionLevel;
  badgeLabel: string;
  reason?: string;
  isAttentionRequired: boolean;
}

export type NodeTierFilter = "all" | "attention" | "active" | "agy" | "opencode" | "ultra" | "pro";

export interface CouncilModelInfo {
  primary: string;
  nodes?: string[];
  provider?: string;
  role: string;
}

export interface CouncilGateInfo {
  id: string;
  name: string;
  passRate: string;
}

export interface FleetCouncilData {
  mode: string;
  consensusThreshold: string;
  models: {
    ultra: CouncilModelInfo;
    pro: CouncilModelInfo;
    local: CouncilModelInfo;
  };
  gates: CouncilGateInfo[];
}

export interface DispatchTaskPayload {
  prompt: string;
  targetNode?: string;
  tier?: "ultra" | "pro" | "standard";
  model?: string;
}

export interface DualOnnxTelemetry {
  clefBreakerState: "CLOSED" | "OPEN" | "HALF_OPEN";
  clefFailureCount: number;
  semanticMemoriesCount: number;
  unconsolidatedEpisodesCount: number;
  driftStatus: string;
  tokenomicsLocalDecisions: number;
  tokenomicsEstimatedSavingsUsd: number;
}

export interface EgressProxySlot {
  slot: number;
  url: string;
  port: number;
  isHealthy: boolean;
  latencyMs: number;
  status: string;
  assignedNodes: string[];
}

export interface EgressPoolStatus {
  enabled: boolean;
  defaultProxyUrl: string;
  poolSize: number;
  healthyCount: number;
  strategy: string;
  noProxy: string[];
  slots: EgressProxySlot[];
  correlationRiskScore: number;
  correlationRiskLabel: string;
}

export interface HermesTaskSummary {
  totalTasks: number;
  byStatus: Record<string, number>;
  latestTask?: {
    id: string;
    title: string;
    status: string;
    updatedAt?: number;
  };
}

export interface HermesHealthStatus {
  installed: boolean;
  version?: string;
  homeDir: string;
  kanban: HermesTaskSummary;
  state: {
    totalSessions: number;
    latestSessionId?: string;
    totalMessages: number;
  };
  evidence: {
    totalEvents: number;
    latestState?: string;
  };
  gateway?: {
    active: boolean;
    channels?: string[];
  };
}

export interface SwarmTelemetrySnapshot {
  timestamp: number;
  clusterStatus: "healthy" | "degraded" | "critical";
  onlineNodes: number;
  totalNodes: number;
  dualOnnx: DualOnnxTelemetry;
  egress: EgressPoolStatus;
  hermes: HermesHealthStatus;
  telegram: {
    enabled: boolean;
    chatId: string;
    botName?: string;
    hasToken: boolean;
  };
}

export type AnalyticsTimeRange = "1h" | "24h" | "7d" | "30d" | "all";

export interface AnalyticsSummary {
  timeRange: AnalyticsTimeRange;
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  successRate: number;
  totalTokens: number;
  totalBilledUsd: number;
  totalSavedUsd: number;
  avgDurationMs: number;
  activeNodesCount: number;
  tokenVelocityTps: number;
  tokenVelocityTpm: number;
}

export interface NodeUtilizationMetric {
  nodeId: string;
  cluster: "opencode" | "agy" | "api";
  tier: "ultra" | "pro" | "free" | "standard";
  requestsCount: number;
  sharePercent: number;
  tokensConsumed: number;
  usdSaved: number;
  avgDurationMs: number;
  errorCount: number;
  errorRate: number;
  status: "optimal" | "hotspot" | "underutilized" | "idle";
}

export interface TimelineBucket {
  timestamp: number;
  timeLabel: string;
  requests: number;
  tokens: number;
  costSavedUsd: number;
  errors: number;
  avgDurationMs: number;
}

export interface FleetRequestRecordUI {
  id: string;
  batchId?: string;
  nodeId: string;
  cluster: "opencode" | "agy" | "api";
  tier: "ultra" | "pro" | "free" | "standard";
  model: string;
  promptSummary?: string;
  status: "completed" | "failed" | "timeout";
  exitCode: number;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costBilledUsd?: number;
  costSavedUsd?: number;
  quotaPercentAfter?: number;
  outputPreview?: string;
  errorMessage?: string;
  createdAt?: number;
  createdIso?: string;
}

export interface RetentionLogRecord {
  id: number;
  cleanedAt: number;
  cleanedIso: string;
  recordsDeleted: number;
  filesDeleted: number;
  retentionDays: number;
}

export interface ModelAnalyticsMetric {
  model: string;
  tier: "ultra" | "pro" | "free" | "standard";
  cluster: "opencode" | "agy" | "api";
  requestsCount: number;
  sharePercent: number;
  totalTokens: number;
  tokenSharePercent: number;
  costBilledUsd: number;
  costSavedUsd: number;
  avgDurationMs: number;
  errorCount: number;
  errorRate: number;
  nodeCount: number;
  nodes: string[];
}

export interface ModelAnalyticsTotals {
  totalRequests: number;
  totalTokens: number;
  totalBilledUsd: number;
  totalSavedUsd: number;
  avgDurationMs: number;
  activeModelsCount: number;
  mostActiveModel: string;
  highestSavingsModel: string;
}

export interface NodeModelDistribution {
  nodeId: string;
  cluster: "opencode" | "agy" | "api";
  tier: "ultra" | "pro" | "free" | "standard";
  totalRequests: number;
  totalTokens: number;
  models: Array<{
    model: string;
    requestsCount: number;
    tokens: number;
    sharePercent: number;
    tokenSharePercent: number;
  }>;
}

export interface ModalGpuWorkerUI {
  appId: string;
  name: string;
  workspace: string;
  state: "deployed" | "running" | "stopped" | "failed";
  hardware: string;
  endpoint: string;
  tasks: number;
  createdAt: string;
  endpoints?: Record<string, { url: string; method: string; action: string }>;
}

export interface ModalGpuProfileUI {
  profile: string;
  workspace: string;
  tokenIdMasked?: string;
  isActive: boolean;
  workerCount: number;
}

export interface ModalWorkloadUI {
  appId: string;
  name: string;
  description: string;
  targetGpu: string;
  defaultUrlTemplate: string;
  candidateWorkspaces: string[];
}

export interface ModalGpuSwarmSummaryUI {
  available: boolean;
  totalProfiles: number;
  activeProfile: string;
  totalWorkers: number;
  totalRunningContainers: number;
  hardwareSpectrum: Record<string, number>;
  clusterHealth: "healthy" | "idle" | "degraded";
  latencyMs: number;
  endpoint: string;
  cliVersion?: string;
}

export interface ModalCliRunResultUI {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timestamp: number;
}

export interface ModalWorkspaceCreditUI {
  workspace: string;
  accountEmail: string;
  gpuTier: string;
  configuredLimitUsd: number;
  currentSpendUsd: number;
  headroomUsd: number;
  headroomPercent: number;
  utilizationPercent: number;
  intellisenseScore: number;
  canDeploy: boolean;
  billingStatus: "nominal" | "warning" | "exhausted" | "unconfigured_limit";
  alarm: string | null;
  circuitState: "CLOSED" | "HALF_OPEN" | "OPEN";
  lastProbed: number;
}

export interface ModalIntelliSenseSummaryUI {
  totalBudgetUsd: number;
  totalSpendUsd: number;
  totalHeadroomUsd: number;
  totalHeadroomPercent: number;
  healthyWorkspacesCount: number;
  warningWorkspacesCount: number;
  exhaustedWorkspacesCount: number;
  stealthMode: {
    enabled: boolean;
    swrCacheTtlSeconds: number;
    passiveInterpolation: boolean;
    jitterDelayRangeMs: [number, number];
    lastSyncTimestamp: number;
  };
  integrity: {
    circuitBreakersTripped: number;
    autoFailoverEnabled: boolean;
    minHeadroomThresholdUsd: number;
    enforceRunawayProtection: boolean;
  };
}

export interface ModalWorkloadRecommendationUI {
  appId: string;
  appTitle: string;
  hardwareTierNeeded: string;
  recommendedWorkspace: string;
  recommendedAccount: string;
  workspaceHeadroomUsd: number;
  recommendationReason: string;
  priority: number;
  estimatedCostPerHour: number;
}

export interface ModalAllocationResultUI {
  success: boolean;
  appId: string;
  allocatedWorkspace: string;
  previousWorkspace: string;
  headroomUsd: number;
  message: string;
}

export interface ModalExecutionLogUI {
  id: number;
  db_id: number;
  node_id: string;
  workspace: string;
  level: string;
  message: string;
  timestamp: number;
  time_str: string;
  time_full: string;
  app_id: string;
  gpu_tier: string;
  duration_s: number;
  duration_ms: number;
  cost_usd: number;
  status: string;
  run_id: string;
  details: Record<string, unknown>;
}

export interface ModalRetentionPolicyUI {
  retention_policy_days: number;
  policy_type: string;
  total_modal_logs: number;
  oldest_log_timestamp: number | null;
  newest_log_timestamp: number | null;
  oldest_log_age_days: number;
  auto_prune_enabled: boolean;
}

export interface ModalLogsResponseUI {
  status: string;
  logs: ModalExecutionLogUI[];
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
  has_next: boolean;
  retention: ModalRetentionPolicyUI;
}

export interface ModalLogMetricsUI {
  status: string;
  time_window_hours: string | number;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  failover_requests: number;
  self_healing_requests: number;
  success_rate_percent: number;
  total_cost_usd: number;
  avg_duration_s: number;
  estimated_mesh_savings_usd: number;
  gpu_breakdown: Record<string, { requests: number; cost_usd: number; total_duration_s: number }>;
  app_breakdown: Record<string, { requests: number; cost_usd: number; total_duration_s: number }>;
  workspace_breakdown: Record<string, { requests: number; cost_usd: number }>;
}

export interface SmartCrossMeshRecommendationUI {
  id: string;
  type:
    | "repatriate_to_mesh"
    | "offload_to_modal"
    | "template_cost_opt"
    | "workspace_failover"
    | "idle_prune";
  category: string;
  title: string;
  app_template_id: string;
  app_title: string;
  source: string;
  target: string;
  reason: string;
  estimated_cost_delta_usd: number;
  savings_percent: number;
  latency_impact: string;
  urgency: "critical" | "high" | "medium" | "low";
  action_type: string;
  action_payload: Record<string, unknown>;
  created_at: number;
}

export interface SmartRebalanceStatusUI {
  status: string;
  stealth_mode: boolean;
  audit_jitter_range_s: [number, number];
  last_audit_timestamp: number;
  time_until_next_audit_s: number;
  recommendations_count: number;
  recommendations: SmartCrossMeshRecommendationUI[];
  total_potential_savings_usd_per_hour: number;
}
