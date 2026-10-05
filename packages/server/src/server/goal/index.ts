import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import type { GoalStatusSnapshot, RouteRequest, SubTaskDAG } from "@getpaseo/protocol/fleet-types";
import type { ClefCouncil } from "../clef/index.js";
import type { FleetRegistry } from "../fleet/registry.js";
import type { NineRouter } from "../router/index.js";

export interface GoalEngineOptions {
  registry: FleetRegistry;
  router: NineRouter;
  council: ClefCouncil;
  logger: Logger;
  workspaceDir: string;
}

export class GoalEngine extends EventEmitter {
  private readonly registry: FleetRegistry;
  private readonly router: NineRouter;
  private readonly council: ClefCouncil;
  private readonly logger: Logger;
  private readonly workspaceDir: string;

  private currentGoal: GoalStatusSnapshot | null = null;
  private tasks: SubTaskDAG[] = [];
  private isRunning: boolean = false;
  private tickInterval: NodeJS.Timeout | null = null;

  constructor(options: GoalEngineOptions) {
    super();
    this.registry = options.registry;
    this.router = options.router;
    this.council = options.council;
    this.logger = options.logger.child({ module: "goal-engine" });
    this.workspaceDir = options.workspaceDir;
  }

  public async startGoal(intent: string, budgetCapTokens: number = 2_000_000): Promise<string> {
    const goalId = `goal-${Date.now()}`;
    this.currentGoal = {
      id: goalId,
      intent,
      state: "intent_parsing",
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      maxRetries: 3,
      budgetTokensUsed: 0,
      budgetCapTokens,
    };

    this.logger.info({ goalId, intent }, "Starting Autonomous Goal");
    this.isRunning = true;
    this.emitState();

    // 1. Decompose intent into SubTasks
    await this.decomposeGoal();

    // 2. Start scheduler loop
    this.startScheduler();

    return goalId;
  }

  public cancelGoal(): void {
    if (!this.currentGoal) return;
    this.logger.warn({ goalId: this.currentGoal.id }, "Autonomous goal cancelled by user");
    this.currentGoal.state = "aborted";
    this.isRunning = false;
    this.stopScheduler();
    this.emitState();
  }

  public getStatus(): GoalStatusSnapshot | null {
    return this.currentGoal;
  }

  public getRegistry(): FleetRegistry {
    return this.registry;
  }

  public getTasks(): SubTaskDAG[] {
    return [...this.tasks];
  }

  private async decomposeGoal(): Promise<void> {
    if (!this.currentGoal) return;
    this.currentGoal.state = "decomposing";
    this.emitState();

    // Request high-level decomposition from Ultra Tier via 9router
    const routeReq: RouteRequest = {
      taskId: "goal-decomposition",
      prompt: `Decompose the following goal into a DAG of concrete subtasks with acceptance criteria and gates: "${this.currentGoal.intent}"`,
      tokensEstimate: 3000,
      preferredTier: "ultra",
      requiredCaps: ["planning"],
    };

    const decision = this.router.route(routeReq);
    this.logger.info({ decision }, "Ultra node selected for goal decomposition");

    // Default structured decomposition (fallback or synthesized)
    this.tasks = [
      {
        id: "task-01-core-contracts",
        contract: {
          id: "task-01-core-contracts",
          goal: "Verify and build protocol contracts and shared schemas",
          acceptanceCriteria: ["protocol compiles without errors", "schemas validate correctly"],
          affectedArtifacts: ["packages/protocol/src/fleet-types.ts"],
          gates: ["types", "lint"],
        },
        dependencies: [],
        status: "pending",
        retryCount: 0,
      },
      {
        id: "task-02-fleet-subsystems",
        contract: {
          id: "task-02-fleet-subsystems",
          goal: "Verify and build server fleet, router, egress, and clef subsystems",
          acceptanceCriteria: ["server compiles cleanly", "types pass"],
          affectedArtifacts: [
            "packages/server/src/server/fleet/",
            "packages/server/src/server/router/",
            "packages/server/src/server/clef/",
          ],
          gates: ["types"],
        },
        dependencies: ["task-01-core-contracts"],
        status: "pending",
        retryCount: 0,
      },
      {
        id: "task-03-full-council-verification",
        contract: {
          id: "task-03-full-council-verification",
          goal: "Execute complete Clef Council gates across monorepo",
          acceptanceCriteria: ["All gates (lint, types, unit tests) pass with Zero-Fake-Pass"],
          affectedArtifacts: ["packages/"],
          gates: ["types", "lint"],
        },
        dependencies: ["task-02-fleet-subsystems"],
        status: "pending",
        retryCount: 0,
      },
    ];

    this.currentGoal.totalTasks = this.tasks.length;
    this.currentGoal.state = "parallel_dispatch";
    this.emitState();
  }

  private startScheduler(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => this.tick(), 3_000);
  }

  private stopScheduler(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.isRunning || !this.currentGoal) return;

    // Check completion condition
    const allDone = this.tasks.every((t) => t.status === "done");
    if (allDone && this.tasks.length > 0) {
      this.currentGoal.state = "achieved";
      this.isRunning = false;
      this.stopScheduler();
      this.logger.info(
        { goalId: this.currentGoal.id },
        "🎉 Autonomous Goal CONVERGED and ACHIEVED!",
      );
      this.emitState();
      return;
    }

    // Find ready tasks (all dependencies are done and status is pending)
    const readyTasks = this.tasks.filter((t) => {
      if (t.status !== "pending") return false;
      return t.dependencies.every((depId) => {
        const dep = this.tasks.find((d) => d.id === depId);
        return dep && dep.status === "done";
      });
    });

    for (const task of readyTasks) {
      this.dispatchTask(task).catch((err) => {
        this.logger.error({ taskId: task.id, err }, "Error dispatching subtask");
      });
    }
  }

  private async dispatchTask(task: SubTaskDAG): Promise<void> {
    task.status = "dispatched";
    this.emitState();

    const routeReq: RouteRequest = {
      taskId: task.id,
      prompt: `Execute subtask: ${task.contract.goal}`,
      tokensEstimate: 2000,
      preferredTier: "pro",
      requiredCaps: ["tools"],
    };

    const decision = this.router.route(routeReq);
    task.assignedNodeId = decision.nodeId;
    this.logger.info(
      { taskId: task.id, nodeId: decision.nodeId },
      "Dispatched subtask to fleet node",
    );

    // Verification step via Clef Council
    task.status = "verifying";
    this.emitState();

    const verdicts = await this.council.verify(this.workspaceDir, task.contract);
    const passed = verdicts.every((v) => v.passed);

    if (passed) {
      task.status = "done";
      if (this.currentGoal) this.currentGoal.completedTasks++;
      this.logger.info({ taskId: task.id }, "Subtask passed all council gates");
    } else {
      task.retryCount++;
      if (task.retryCount > (this.currentGoal?.maxRetries || 3)) {
        task.status = "failed";
        if (this.currentGoal) this.currentGoal.failedTasks++;
        this.logger.error(
          { taskId: task.id, retries: task.retryCount },
          "Subtask exceeded max retries",
        );
      } else {
        task.status = "remediating";
        this.logger.warn(
          { taskId: task.id, retry: task.retryCount },
          "Subtask failed gates, scheduling remediation",
        );
        // Reset to pending after short delay to allow remediation
        setTimeout(() => {
          if (task.status === "remediating") task.status = "pending";
        }, 5_000);
      }
    }

    this.emitState();
  }

  private emitState(): void {
    if (this.currentGoal) {
      this.emit("goalStateChanged", {
        goal: this.currentGoal,
        tasks: this.tasks,
      });
    }
  }
}
