import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { OpenCodeFleetManager } from "./opencode-fleet-manager.js";

describe("OpenCodeFleetManager", () => {
  let testFleetDir: string;

  beforeEach(() => {
    testFleetDir = join(
      tmpdir(),
      `test-opencode-fleet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testFleetDir, "nodes"), { recursive: true });
    mkdirSync(join(testFleetDir, "bin"), { recursive: true });
    mkdirSync(join(testFleetDir, "outputs"), { recursive: true });

    // Seed mock nodes
    const nodeA = join(testFleetDir, "nodes", "node-alpha");
    mkdirSync(join(nodeA, "config"), { recursive: true });
    mkdirSync(join(nodeA, "data"), { recursive: true });
    mkdirSync(join(nodeA, "workspace"), { recursive: true });
    writeFileSync(
      join(nodeA, "node_metadata.json"),
      JSON.stringify({
        node_id: "node-alpha",
        account_email: "alpha@gmail.com",
        authenticated: true,
        auth_type: "google_oauth",
        status: "idle",
        jobs_completed: 5,
        jobs_failed: 0,
      }),
    );

    const nodeB = join(testFleetDir, "nodes", "node-beta");
    mkdirSync(join(nodeB, "config"), { recursive: true });
    mkdirSync(join(nodeB, "data"), { recursive: true });
    mkdirSync(join(nodeB, "workspace"), { recursive: true });
    writeFileSync(
      join(nodeB, "node_metadata.json"),
      JSON.stringify({
        node_id: "node-beta",
        account_email: "beta@gmail.com",
        authenticated: true,
        auth_type: "google_oauth",
        status: "idle",
        jobs_completed: 2,
        jobs_failed: 1,
      }),
    );
  });

  afterEach(() => {
    if (existsSync(testFleetDir)) {
      rmSync(testFleetDir, { recursive: true, force: true });
    }
  });

  it("discovers all seeded nodes and loads metadata correctly", async () => {
    const manager = new OpenCodeFleetManager({ fleetDir: testFleetDir });
    const nodes = await manager.getNodes();

    expect(nodes).toHaveLength(2);
    expect(nodes[0].nodeId).toBe("node-alpha");
    expect(nodes[0].accountEmail).toBe("alpha@gmail.com");
    expect(nodes[0].authenticated).toBe(true);
    expect(nodes[0].jobsCompleted).toBe(5);

    expect(nodes[1].nodeId).toBe("node-beta");
    expect(nodes[1].accountEmail).toBe("beta@gmail.com");
    expect(nodes[1].authenticated).toBe(true);
    expect(nodes[1].jobsFailed).toBe(1);
  });

  it("handles empty nodes directory gracefully", async () => {
    const emptyDir = join(tmpdir(), `empty-fleet-${Date.now()}`);
    mkdirSync(join(emptyDir, "nodes"), { recursive: true });
    try {
      const manager = new OpenCodeFleetManager({ fleetDir: emptyDir });
      const nodes = await manager.getNodes();
      expect(nodes).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("dispatches job with mock runner script", async () => {
    // Write a mock runner script
    const runnerScript = join(testFleetDir, "bin", "opencode_fleet_run.sh");
    writeFileSync(
      runnerScript,
      `#!/bin/bash
TARGET_LOG="$4"
echo "Mock run for $1 on model $2" > "$TARGET_LOG"
exit 0
`,
      { mode: 0o755 },
    );

    const manager = new OpenCodeFleetManager({ fleetDir: testFleetDir });
    const result = await manager.dispatchJob("node-alpha", "Test prompt", "test/model");

    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.nodeId).toBe("node-alpha");
    expect(result.outputPreview).toContain("Mock run for node-alpha on model test/model");

    const history = manager.getJobHistory();
    expect(history).toHaveLength(1);
    expect(history[0].jobId).toBe(result.jobId);
  });

  it("dispatches parallel swarm across multiple nodes", async () => {
    const runnerScript = join(testFleetDir, "bin", "opencode_fleet_run.sh");
    writeFileSync(
      runnerScript,
      `#!/bin/bash
TARGET_LOG="$4"
echo "Parallel mock output for node: $1" > "$TARGET_LOG"
exit 0
`,
      { mode: 0o755 },
    );

    const manager = new OpenCodeFleetManager({ fleetDir: testFleetDir });
    const parallelResult = await manager.dispatchParallel({
      prompt: "Parallel prompt",
      nodes: ["node-alpha", "node-beta"],
    });

    expect(parallelResult.totalNodes).toBe(2);
    expect(parallelResult.succeeded).toBe(2);
    expect(parallelResult.failed).toBe(0);
    expect(parallelResult.jobs).toHaveLength(2);
  });

  it("handles job failure gracefully", async () => {
    const runnerScript = join(testFleetDir, "bin", "opencode_fleet_run.sh");
    writeFileSync(
      runnerScript,
      `#!/bin/bash
TARGET_LOG="$4"
echo "Failure simulated" > "$TARGET_LOG"
exit 1
`,
      { mode: 0o755 },
    );

    const manager = new OpenCodeFleetManager({ fleetDir: testFleetDir });
    const result = await manager.dispatchJob("node-alpha", "Fail prompt");

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.outputPreview).toContain("Failure simulated");
  });
});
