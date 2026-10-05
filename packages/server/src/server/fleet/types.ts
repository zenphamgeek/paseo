export * from "@getpaseo/protocol/fleet-types";
import type {
  FleetNodeConfig,
  FleetNodeSummary,
  NodeState,
  QuotaSnapshot,
} from "@getpaseo/protocol/fleet-types";
import type { AgentClient } from "../agent/agent-sdk-types.js";

export interface FleetNodeRuntime {
  config: FleetNodeConfig;
  state: NodeState;
  quota: QuotaSnapshot;
  client?: AgentClient;
  activeJobs: number;
  requestsServed: number;
  errorCount: number;
  lastHeartbeat: number;
  consecutiveFailures: number;
  proxyBinding?: string;
  geminiQuotaPercent?: number;
  claudeQuotaPercent?: number;
  geminiResetTime?: string | null;
  claudeResetTime?: string | null;
}

export interface FleetRegistryEvents {
  nodeRegistered: (node: FleetNodeSummary) => void;
  nodeStateChanged: (nodeId: string, state: NodeState) => void;
  quotaUpdated: (nodeId: string, quota: QuotaSnapshot) => void;
}
