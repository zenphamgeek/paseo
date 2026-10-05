import { describe, expect, it } from "vitest";
import pino from "pino";
import { FleetRegistry } from "./registry.js";

const logger = pino({ level: "silent" });

describe("FleetRegistry", () => {
  it("should initialize and auto-discover nodes", async () => {
    const registry = new FleetRegistry({ logger });
    await registry.initialize();

    const nodes = registry.getAllNodes();
    expect(nodes.length).toBeGreaterThan(0);

    // Verify Nebula is registered as Ultra tier
    const nebula = registry.getNode("nebula");
    expect(nebula).toBeDefined();
    expect(nebula?.config.tier).toBe("ultra");
    expect(nebula?.config.preferredModel).toBe("claude-opus-4.8");

    // Verify available nodes can be queried
    const ultraNodes = registry.getAvailableNodes("ultra");
    expect(ultraNodes.length).toBeGreaterThan(0);

    const proNodes = registry.getAvailableNodes("pro");
    expect(proNodes.length).toBeGreaterThan(0);

    await registry.shutdown();
  });

  it("should transition state on job lifecycle and errors", async () => {
    const registry = new FleetRegistry({ logger });
    await registry.initialize();

    registry.recordJobStart("nebula");
    let node = registry.getNode("nebula");
    expect(node?.activeJobs).toBe(1);

    // Record success
    registry.recordJobResult("nebula", true);
    node = registry.getNode("nebula");
    expect(node?.activeJobs).toBe(0);
    expect(node?.requestsServed).toBe(1);

    // Record 429 / quota error
    registry.recordJobResult("nebula", false, "quota_exhausted");
    node = registry.getNode("nebula");
    expect(node?.state).toBe("quota_exhausted");

    await registry.shutdown();
  });
});
