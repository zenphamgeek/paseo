import { describe, expect, it } from "vitest";
import pino from "pino";
import { FleetRegistry } from "../fleet/registry.js";
import { NineRouter } from "../router/index.js";
import { ClefCouncil } from "../clef/index.js";
import { GoalEngine } from "./index.js";

const logger = pino({ level: "silent" });

describe("GoalEngine", () => {
  it("should initialize and decompose goal intent into DAG", async () => {
    const registry = new FleetRegistry({ logger });
    await registry.initialize();
    const router = new NineRouter({ registry, logger });
    const council = new ClefCouncil({ logger });

    const engine = new GoalEngine({
      registry,
      router,
      council,
      logger,
      workspaceDir: process.cwd(),
    });

    const goalId = await engine.startGoal("Implement Zencode Swarm Architecture");
    expect(goalId).toBeDefined();

    const status = engine.getStatus();
    expect(status?.id).toBe(goalId);
    expect(status?.state).toBe("parallel_dispatch");

    const tasks = engine.getTasks();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].contract.id).toBe("task-01-core-contracts");

    engine.cancelGoal();
    expect(engine.getStatus()?.state).toBe("aborted");

    await registry.shutdown();
  });
});
