export type IncidentSource = "hook" | "tool" | "agent_runtime" | "manual";
export type IncidentSeverity = "info" | "warning" | "critical";
export type IncidentStatus =
  | "detected"
  | "isolated"
  | "analyzing"
  | "patch_proposed"
  | "branch_created"
  | "branch_pushed"
  | "verifying"
  | "auto_merged"
  | "verification_failed"
  | "reverted"
  | "resolved"
  | "dismissed";

export interface AutonomousHealOptions {
  testCommand?: string;
  targetBranch?: string;
  autoMerge?: boolean;
  pushToRemote?: boolean;
  timeoutMs?: number;
}

export interface AutonomousHealResult {
  incidentId: string;
  success: boolean;
  branchName: string;
  targetBranch: string;
  originalSha: string;
  testPassed: boolean;
  testOutput?: string;
  merged: boolean;
  reverted: boolean;
  mergeCommitSha?: string;
  error?: string;
}

export interface PatchFile {
  path: string;
  oldContent?: string;
  newContent: string;
  diff: string;
}

export interface ProposedFix {
  summary: string;
  rootCause: string;
  patchFiles: PatchFile[];
  suggestedCommitMessage: string;
  verificationSteps: string[];
  createdAt: number;
}

export interface Incident {
  id: string;
  sha: string;
  timestamp: number;
  source: IncidentSource;
  severity: IncidentSeverity;
  hookName?: string;
  toolName?: string;
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  command?: string;
  workspaceDir: string;
  status: IncidentStatus;
  proposedFix?: ProposedFix;
  branchName?: string;
  prUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface IncidentReportInput {
  source: IncidentSource;
  severity?: IncidentSeverity;
  hookName?: string;
  toolName?: string;
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  command?: string;
  workspaceDir?: string;
  metadata?: Record<string, unknown>;
}

export interface CircuitBreakerStatus {
  isTripped: boolean;
  isolatedHooks: string[];
  failureCounts: Record<string, number>;
  threshold: number;
}
