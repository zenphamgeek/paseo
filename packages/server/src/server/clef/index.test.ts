import { describe, expect, it } from "vitest";
import pino from "pino";
import { ClefCouncil } from "./index.js";
import { TaskContractSchema } from "@getpaseo/protocol/fleet-types";

const logger = pino({ level: "silent" });

describe("ClefCouncil", () => {
  it("should validate TaskContract with Zod schema", () => {
    const validContract = {
      id: "task-test-01",
      goal: "Implement type safe feature",
      acceptanceCriteria: ["Feature compiles and passes tests"],
      affectedArtifacts: ["src/feature.ts"],
      gates: ["types", "lint"] as const,
    };

    const parsed = TaskContractSchema.parse(validContract);
    expect(parsed.id).toBe("task-test-01");
    expect(parsed.gates).toContain("types");
  });

  it("should initialize with default hybrid mode and parse config correctly", () => {
    const council = new ClefCouncil({ logger });
    const cfg = council.getConfig();
    expect(cfg.mode).toBe("hybrid");
    expect(cfg.escalation.enabled).toBe(true);
    expect(cfg.escalation.criticalTaskClasses).toContain("auth");
  });

  it("should skip Tier 2 semantic evaluation in deterministic-only mode", async () => {
    const council = new ClefCouncil({ logger, config: { mode: "deterministic-only" } });
    const contract = {
      id: "task-det-only",
      goal: "Run pure static checks",
      acceptanceCriteria: ["Passes typecheck"],
      affectedArtifacts: [],
      gates: ["lint"] as const,
    };

    const verdicts = await council.evaluateSemantic("const x = 1;", contract);
    expect(verdicts).toEqual([]);
  });

  it("should detect anti-cheat flags in local evaluation and escalate in hybrid mode", async () => {
    const council = new ClefCouncil({ logger, config: { mode: "hybrid" } });
    const contract = {
      id: "task-auth-check",
      goal: "Update auth token validation",
      acceptanceCriteria: ["Secure token checking"],
      affectedArtifacts: ["src/auth/token.ts"],
      gates: ["lint"] as const,
    };

    // Diff contains suspicious cheat pattern
    const suspiciousDiff = `
+ test('bypasses checks', () => {
+   expect(true).toBe(true);
+ });
    `;

    const verdicts = await council.evaluateSemantic(suspiciousDiff, contract);
    // Should have both local pre-filter verdict with flag AND escalated cloud verdict
    expect(verdicts.length).toBe(2);

    const localVerdict = verdicts.find((v) => v.tier === "local");
    const cloudVerdict = verdicts.find((v) => v.tier === "cloud");

    expect(localVerdict?.verdict).toBe("flag");
    expect(localVerdict?.flags).toContain("expect(true).toBe(true)");
    expect(cloudVerdict?.tier).toBe("cloud");
    expect(cloudVerdict?.gateId).toBe("security-audit");
  });

  it("should run council gate and return verdict with sha256 output hash", async () => {
    const council = new ClefCouncil({ logger });

    const contract = {
      id: "task-quick-check",
      goal: "Verify repository lint status",
      acceptanceCriteria: ["Lint execution completes"],
      affectedArtifacts: [],
      gates: ["lint"] as const,
    };

    const verdicts = await council.verify(process.cwd(), contract);
    expect(verdicts.length).toBe(1);

    const v = verdicts[0];
    expect(v.gate).toBe("lint");
    expect(v.rawOutputHash).toBeDefined();
    expect(v.rawOutputHash.length).toBe(64); // SHA-256 length
  }, 15000);
});
