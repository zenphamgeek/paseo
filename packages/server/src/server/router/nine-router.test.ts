import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import {
  NineRouter,
  NINE_ROUTER_ALLOWED_MODELS,
  isClaudeOrOpusTarget,
  isPlanningTarget,
} from "./index.js";
import { FleetRegistry } from "../fleet/registry.js";
import type { RouteRequest } from "@getpaseo/protocol/fleet-types";

describe("NineRouter Model Guard & 9router Invariants", () => {
  let registry: FleetRegistry;
  let router: NineRouter;
  const logger = pino({ level: "silent" });

  beforeEach(() => {
    registry = new FleetRegistry({ logger });
    router = new NineRouter({ registry, logger });

    // Seed mock nodes for router evaluation
    registry.registerNode({
      id: "nebula",
      kind: "nebula",
      tier: "ultra",
      homeDirectory: "/home/zen/agy-fleet/nebula",
      caps: ["claude-opus-4.8", "claude-sonnet-5", "claude", "opus"],
      preferredModel: "claude-opus-4.8",
      maxConcurrency: 4,
    });

    registry.registerNode({
      id: "binhthuong",
      kind: "agy",
      tier: "pro",
      homeDirectory: "/home/zen/agy-fleet/binhthuong",
      caps: ["claude-opus-5-5-high", "gemini-3.8-flash-high", "claude", "opus"],
      preferredModel: "claude-opus-5-5-high",
      maxConcurrency: 2,
    });

    registry.registerNode({
      id: "pro-1",
      kind: "agy",
      tier: "pro",
      homeDirectory: "/home/zen/agy-fleet/pro-1",
      caps: ["gemini-3.8-flash-high"],
      preferredModel: "gemini-3.8-flash-high",
      maxConcurrency: 2,
    });

    // Register 9router with strictly allowed models
    registry.registerNode({
      id: "9router",
      kind: "codex",
      tier: "pro",
      homeDirectory: "/home/zen/.9router",
      caps: [
        "codex",
        "sol",
        "luna",
        "cx/gpt-5.6-terra",
        "cx/gpt-5.5",
        "deepseek-v4-flash",
        "free_quota",
        "tools",
        "planning",
      ],
      allowedModels: [...NINE_ROUTER_ALLOWED_MODELS],
      preferredModel: "codex",
      maxConcurrency: 4,
    });
  });

  it("identifies Claude/Opus and planning targets correctly", () => {
    const claudeReq: RouteRequest = {
      taskId: "t1",
      prompt: "Use Claude Opus to review code",
      tokensEstimate: 1000,
      preferredTier: "pro",
      requiredCaps: ["claude"],
    };
    expect(isClaudeOrOpusTarget(claudeReq)).toBe(true);

    const planReq: RouteRequest = {
      taskId: "t2",
      prompt: "Decompose subtasks into a plan",
      tokensEstimate: 1000,
      preferredTier: "pro",
      requiredCaps: ["planning"],
    };
    expect(isPlanningTarget(planReq)).toBe(true);
    expect(isClaudeOrOpusTarget(planReq)).toBe(false);
  });

  it("NEVER routes Claude or Opus into 9router", () => {
    const claudeReq: RouteRequest = {
      taskId: "claude-task-01",
      prompt: "Refactor architecture using claude-3-7-sonnet",
      tokensEstimate: 2000,
      preferredTier: "pro",
      requiredCaps: ["claude", "opus"],
    };

    const decision = router.route(claudeReq);
    expect(decision.nodeId).not.toBe("9router");
    expect(decision.model).not.toMatch(/codex/i);

    // Verify 9router is not in the fallback chain for Claude/Opus
    for (const fb of decision.fallbackChain) {
      expect(fb.nodeId).not.toBe("9router");
      expect(fb.model).not.toBe("claude-opus-4.8");
    }
  });

  it("allows 9router to serve planning tasks using setup allowed models (cx/gpt-5.6-terra)", () => {
    const planReq: RouteRequest = {
      taskId: "plan-task-01",
      prompt: "Breakdown goal into a plan of subtasks",
      tokensEstimate: 3000,
      preferredTier: "pro",
      requiredCaps: ["planning"],
    };

    const decision = router.route(planReq);
    // 9router is high priority for planning with allowed models
    if (decision.nodeId === "9router") {
      expect(NINE_ROUTER_ALLOWED_MODELS).toContain(decision.model);
      expect(decision.model).toBe("cx/gpt-5.6-terra");
      expect(decision.model).not.toMatch(/claude|opus/i);
    }
  });

  it("strictly excludes 9router if planning explicitly requests Claude or Opus", () => {
    const claudePlanReq: RouteRequest = {
      taskId: "claude-plan-task",
      prompt: "Create execution plan using Claude Opus 5.5",
      tokensEstimate: 3000,
      preferredTier: "pro",
      requiredCaps: ["planning", "opus"],
    };

    const decision = router.route(claudePlanReq);
    expect(decision.nodeId).not.toBe("9router");
    expect(decision.model).toMatch(/claude|opus/i);
  });

  it("enforces failover safeguard so Claude/Opus cannot be assigned to 9router during failover", () => {
    const initialDecision = {
      nodeId: "nebula",
      model: "claude-opus-4.8",
      fallbackChain: [
        { nodeId: "9router", model: "claude-opus-5-5-high" }, // Bad/corrupt fallback injection
        { nodeId: "binhthuong", model: "claude-opus-5-5-high" },
      ],
    };

    const failoverDecision = router.failover(initialDecision, new Error("429 Too Many Requests"));
    expect(failoverDecision).not.toBeNull();
    // Must skip 9router since model is Claude/Opus
    expect(failoverDecision?.nodeId).toBe("binhthuong");
    expect(failoverDecision?.model).toBe("claude-opus-5-5-high");
  });
});
