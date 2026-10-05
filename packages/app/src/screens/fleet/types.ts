import type {
  FleetClusterSummary,
  FleetJobRecord,
  FleetNodeSummary,
  ModelTier,
  NodeState,
} from "@getpaseo/protocol/fleet-types";

export type { FleetClusterSummary, FleetJobRecord, FleetNodeSummary, ModelTier, NodeState };

export type FleetActiveTab = "nodes" | "autonomous" | "council" | "runner" | "jobs" | "telemetry";

export type NodeTierFilter = "all" | "ultra" | "pro";

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
