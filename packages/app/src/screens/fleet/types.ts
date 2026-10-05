import type {
  FleetClusterSummary,
  FleetJobRecord,
  FleetNodeSummary,
  ModelTier,
  NodeState,
} from "@getpaseo/protocol/fleet-types";

export type { FleetClusterSummary, FleetJobRecord, FleetNodeSummary, ModelTier, NodeState };

export type FleetActiveTab = "nodes" | "autonomous" | "council" | "runner" | "jobs";

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
