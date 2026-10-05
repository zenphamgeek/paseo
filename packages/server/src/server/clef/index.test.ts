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
  });
});
