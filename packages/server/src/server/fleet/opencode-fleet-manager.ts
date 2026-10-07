import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Logger } from "pino";
import { getFleetAnalyticsDatabase } from "./fleet-analytics-db.js";

const execAsync = promisify(exec);

export interface OpenCodeFleetNode {
  nodeId: string;
  accountEmail: string;
  authType: "google_oauth" | "api_key" | "none";
  authenticated: boolean;
  status: "idle" | "busy" | "error";
  activeJobs: number;
  jobsCompleted: number;
  jobsFailed: number;
  lastSyncedAt?: string;
  lastJobDurationSeconds?: number;
  configPath: string;
  dataPath: string;
  workspacePath: string;
}

export interface OpenCodeJobResult {
  jobId: string;
  nodeId: string;
  model: string;
  prompt: string;
  status: "completed" | "failed" | "timeout";
  exitCode: number;
  durationMs: number;
  outputPreview: string;
  logPath: string;
  completedAt: string;
}

export interface OpenCodeParallelJobRequest {
  prompt: string;
  model?: string;
  nodes?: string[];
  timeoutMs?: number;
}

export interface OpenCodeParallelJobResult {
  batchId: string;
  totalNodes: number;
  succeeded: number;
  failed: number;
  jobs: OpenCodeJobResult[];
}

export interface OpenCodeFleetManagerOptions {
  fleetDir?: string;
  binPath?: string;
  logger?: Logger;
}

function parseNodeMetadata(metaPath: string): {
  email: string;
  authenticated: boolean;
  authType: OpenCodeFleetNode["authType"];
  status: OpenCodeFleetNode["status"];
  jobsCompleted: number;
  jobsFailed: number;
  lastSyncedAt?: string;
  lastJobDurationSeconds?: number;
} {
  const fallback = {
    email: "unknown@gmail.com",
    authenticated: false,
    authType: "none" as const,
    status: "idle" as const,
    jobsCompleted: 0,
    jobsFailed: 0,
  };

  if (!existsSync(metaPath)) return fallback;

  try {
    const raw = JSON.parse(readFileSync(metaPath, "utf-8"));
    const authenticated = Boolean(raw.authenticated);
    return {
      email: raw.account_email ?? fallback.email,
      authenticated,
      authType: raw.auth_type ?? (authenticated ? "google_oauth" : "none"),
      status: raw.status ?? "idle",
      jobsCompleted: raw.jobs_completed ?? 0,
      jobsFailed: raw.jobs_failed ?? 0,
      lastSyncedAt: raw.last_synced_at,
      lastJobDurationSeconds: raw.last_run?.duration_seconds,
    };
  } catch {
    return fallback;
  }
}

export class OpenCodeFleetManager {
  private readonly fleetDir: string;
  private readonly binPath: string;
  private readonly logger?: Logger;
  private readonly jobHistory: Map<string, OpenCodeJobResult> = new Map();

  constructor(options: OpenCodeFleetManagerOptions = {}) {
    this.fleetDir = options.fleetDir ?? "/home/zen/opencode-fleet";
    this.binPath = options.binPath ?? "/home/zen/.opencode/bin/opencode";
    this.logger = options.logger;
  }

  getFleetDir(): string {
    return this.fleetDir;
  }

  getBinPath(): string {
    return this.binPath;
  }

  async getNodes(): Promise<OpenCodeFleetNode[]> {
    const nodesDir = join(this.fleetDir, "nodes");
    if (!existsSync(nodesDir)) {
      await this.syncAccounts();
    }

    const { readdir } = await import("node:fs/promises");
    try {
      const entries = await readdir(nodesDir, { withFileTypes: true });
      const nodes: OpenCodeFleetNode[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const nodeId = entry.name;
        const nodeDir = join(nodesDir, nodeId);
        const metaPath = join(nodeDir, "node_metadata.json");
        const meta = parseNodeMetadata(metaPath);

        nodes.push({
          nodeId,
          accountEmail: meta.email,
          authType: meta.authType,
          authenticated: meta.authenticated,
          status: meta.status,
          activeJobs: 0,
          jobsCompleted: meta.jobsCompleted,
          jobsFailed: meta.jobsFailed,
          lastSyncedAt: meta.lastSyncedAt,
          lastJobDurationSeconds: meta.lastJobDurationSeconds,
          configPath: join(nodeDir, "config"),
          dataPath: join(nodeDir, "data"),
          workspacePath: join(nodeDir, "workspace"),
        });
      }

      return nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    } catch (err) {
      this.logger?.error({ err }, "Failed to read OpenCode nodes");
      return [];
    }
  }

  async syncAccounts(): Promise<{ syncedCount: number; nodes: OpenCodeFleetNode[] }> {
    const syncScript = join(this.fleetDir, "bin", "sync_nodes.py");
    if (!existsSync(syncScript)) {
      throw new Error(`Sync script not found at ${syncScript}`);
    }

    try {
      this.logger?.info("Executing OpenCode Fleet account synchronization...");
      await execAsync(`python3 "${syncScript}"`, { timeout: 30_000 });
      const nodes = await this.getNodes();
      return { syncedCount: nodes.length, nodes };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.error({ err }, "OpenCode Fleet account sync failed");
      throw new Error(`Sync failed: ${msg}`, { cause: err });
    }
  }

  async dispatchJob(
    nodeId: string,
    prompt: string,
    model = "opencode/fledge-alpha-free",
    timeoutMs = 120_000,
  ): Promise<OpenCodeJobResult> {
    let resolvedNodeId = nodeId;
    let nodeDir = join(this.fleetDir, "nodes", resolvedNodeId);
    if (!existsSync(nodeDir) && existsSync(join(this.fleetDir, "nodes", `oc_${resolvedNodeId}`))) {
      resolvedNodeId = `oc_${resolvedNodeId}`;
      nodeDir = join(this.fleetDir, "nodes", resolvedNodeId);
    }

    if (!existsSync(nodeDir)) {
      throw new Error(`Node ${nodeId} not found in OpenCode Fleet`);
    }

    const timestamp = Date.now();
    const jobId = `job_${resolvedNodeId}_${timestamp}`;
    const outputsDir = join(this.fleetDir, "outputs");
    mkdirSync(outputsDir, { recursive: true });
    const logPath = join(outputsDir, `${jobId}.log`);

    const runnerScript = join(this.fleetDir, "bin", "opencode_fleet_run.sh");
    const startTime = Date.now();

    try {
      // Escape prompt for shell argument
      const sanitizedPrompt = prompt.replace(/"/g, '\\"');
      await execAsync(
        `"${runnerScript}" "${resolvedNodeId}" "${model}" "${sanitizedPrompt}" "${logPath}"`,
        { timeout: timeoutMs },
      );

      const durationMs = Date.now() - startTime;
      let outputPreview = "";
      if (existsSync(logPath)) {
        const fullLog = readFileSync(logPath, "utf-8");
        outputPreview = fullLog.split("\n").slice(0, 10).join("\n").slice(0, 500);
      }

      const result: OpenCodeJobResult = {
        jobId,
        nodeId: resolvedNodeId,
        model,
        prompt: prompt.slice(0, 200),
        status: "completed",
        exitCode: 0,
        durationMs,
        outputPreview,
        logPath,
        completedAt: new Date().toISOString(),
      };

      this.jobHistory.set(jobId, result);

      try {
        const analyticsDb = getFleetAnalyticsDatabase();
        const tokensEstimate = Math.max(150, Math.round(durationMs * 30));
        analyticsDb.recordRequest({
          id: jobId,
          nodeId: resolvedNodeId,
          cluster: "opencode",
          tier: "free",
          model,
          promptSummary: prompt.slice(0, 300),
          status: "completed",
          exitCode: 0,
          durationMs,
          totalTokens: tokensEstimate,
          costBilledUsd: 0.0,
          costSavedUsd: Number(((tokensEstimate / 1_000_000) * 1.25).toFixed(6)),
          outputPreview,
        });
      } catch (dbErr) {
        this.logger?.warn({ dbErr }, "Failed to record request in analytics DB");
      }

      return result;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      let outputPreview = errorMsg.slice(0, 500);
      if (existsSync(logPath)) {
        try {
          outputPreview = readFileSync(logPath, "utf-8").slice(0, 500);
        } catch {
          // Fallback to error message
        }
      }

      const result: OpenCodeJobResult = {
        jobId,
        nodeId: resolvedNodeId,
        model,
        prompt: prompt.slice(0, 200),
        status: "failed",
        exitCode: 1,
        durationMs,
        outputPreview,
        logPath,
        completedAt: new Date().toISOString(),
      };

      this.jobHistory.set(jobId, result);

      try {
        const analyticsDb = getFleetAnalyticsDatabase();
        const tokensEstimate = Math.max(50, Math.round(durationMs * 15));
        analyticsDb.recordRequest({
          id: jobId,
          nodeId: resolvedNodeId,
          cluster: "opencode",
          tier: "free",
          model,
          promptSummary: prompt.slice(0, 300),
          status: "failed",
          exitCode: 1,
          durationMs,
          totalTokens: tokensEstimate,
          costBilledUsd: 0.0,
          costSavedUsd: 0.0,
          outputPreview,
          errorMessage: errorMsg,
        });
      } catch (dbErr) {
        this.logger?.warn({ dbErr }, "Failed to record failed request in analytics DB");
      }

      return result;
    }
  }

  async dispatchParallel(request: OpenCodeParallelJobRequest): Promise<OpenCodeParallelJobResult> {
    const { prompt, model = "opencode/fledge-alpha-free", timeoutMs = 180_000 } = request;
    const batchId = `batch_${Date.now()}`;

    let targetNodes = request.nodes;
    if (!targetNodes || targetNodes.length === 0) {
      const allNodes = await this.getNodes();
      targetNodes = allNodes.filter((n) => n.authenticated).map((n) => n.nodeId);
    }

    if (targetNodes.length === 0) {
      throw new Error("No authenticated OpenCode Fleet nodes available for parallel dispatch");
    }

    this.logger?.info(
      { batchId, nodeCount: targetNodes.length, model },
      "Dispatching OpenCode Fleet parallel swarm",
    );

    // Launch in parallel using Promise.all
    const jobPromises = targetNodes.map((nodeId) =>
      this.dispatchJob(nodeId, prompt, model, timeoutMs),
    );

    const jobs = await Promise.all(jobPromises);
    const succeeded = jobs.filter((j) => j.status === "completed").length;
    const failed = jobs.length - succeeded;

    return {
      batchId,
      totalNodes: targetNodes.length,
      succeeded,
      failed,
      jobs,
    };
  }

  getJobHistory(): OpenCodeJobResult[] {
    return Array.from(this.jobHistory.values()).toReversed();
  }

  getJob(jobId: string): OpenCodeJobResult | undefined {
    return this.jobHistory.get(jobId);
  }
}

let openCodeFleetManagerInstance: OpenCodeFleetManager | null = null;

export function getOpenCodeFleetManager(
  options?: OpenCodeFleetManagerOptions,
): OpenCodeFleetManager {
  if (!openCodeFleetManagerInstance) {
    openCodeFleetManagerInstance = new OpenCodeFleetManager(options);
  }
  return openCodeFleetManagerInstance;
}
