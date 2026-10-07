import { describe, expect, it } from "vitest";
import {
  parseFleetExecutionFromMessage,
  formatFleetExecutionLabel,
  resolveFleetExecutionDetails,
} from "./fleet-execution-label";

describe("fleet-execution-label", () => {
  it("returns null for non-fleet notification messages", () => {
    expect(parseFleetExecutionFromMessage("Command finished with exit code 0")).toBeNull();
    expect(parseFleetExecutionFromMessage("File saved successfully")).toBeNull();
    expect(parseFleetExecutionFromMessage("")).toBeNull();
    expect(parseFleetExecutionFromMessage(undefined)).toBeNull();
  });

  it("parses standard Fleet Mode label with orchestrator and worker", () => {
    const message =
      "[Fleet Mode Active] Orchestrator: zenpham@gmail.com (gemini-2.5-pro) ➔ Delegated Worker: binhthuong@gmail.com (claude-opus-5-5-high)";

    const parsed = parseFleetExecutionFromMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed?.isFleetMode).toBe(true);
    expect(parsed?.orchestratorNode).toBe("zenpham@gmail.com");
    expect(parsed?.orchestratorModel).toBe("gemini-2.5-pro");
    expect(parsed?.workerNode).toBe("binhthuong@gmail.com");
    expect(parsed?.workerModel).toBe("claude-opus-5-5-high");
  });

  it("parses Fleet Mode label with ASCII arrow ->", () => {
    const message =
      "[Fleet Mode Active] Orchestrator: Fleet Manager (gemini-2.5-pro) -> Delegated Worker: oc_sunward (claude-opus-5-5-high)";

    const parsed = parseFleetExecutionFromMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed?.orchestratorNode).toBe("Fleet Manager");
    expect(parsed?.orchestratorModel).toBe("gemini-2.5-pro");
    expect(parsed?.workerNode).toBe("oc_sunward");
    expect(parsed?.workerModel).toBe("claude-opus-5-5-high");
  });

  it("provides graceful fallback values for loosely formatted fleet notice", () => {
    const message = "[Fleet Mode Active] custom text without matching pattern";
    const parsed = parseFleetExecutionFromMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed?.isFleetMode).toBe(true);
    expect(parsed?.orchestratorNode).toBe("Fleet Orchestrator");
    expect(parsed?.workerNode).toBe("Swarm Worker");
  });

  it("formats fleet execution label correctly", () => {
    const label = formatFleetExecutionLabel({
      orchestratorNode: "zenpham@gmail.com",
      orchestratorModel: "gemini-2.5-pro",
      workerNode: "binhthuong@gmail.com",
      workerModel: "claude-opus-5-5-high",
    });

    expect(label).toBe(
      "[Fleet Mode Active] Orchestrator: zenpham@gmail.com (gemini-2.5-pro) ➔ Delegated Worker: binhthuong@gmail.com (claude-opus-5-5-high)",
    );
  });

  it("resolveFleetExecutionDetails prioritizes structured fleetExecution", () => {
    const structured = {
      isFleetMode: true,
      orchestratorNode: "orch-1",
      orchestratorModel: "model-1",
      workerNode: "worker-1",
      workerModel: "model-2",
      tier: "ultra" as const,
    };

    const resolved = resolveFleetExecutionDetails(structured, "some message");
    expect(resolved).toEqual(structured);
  });

  it("resolveFleetExecutionDetails falls back to parsing message", () => {
    const message =
      "[Fleet Mode Active] Orchestrator: node-a (model-a) ➔ Delegated Worker: node-b (model-b)";
    const resolved = resolveFleetExecutionDetails(undefined, message);
    expect(resolved).not.toBeNull();
    expect(resolved?.orchestratorNode).toBe("node-a");
    expect(resolved?.workerNode).toBe("node-b");
  });

  it("parses Clef Gate telemetry metadata when present in label", () => {
    const message =
      "[Fleet Mode Active] Orchestrator: zenpham@gmail.com (gemini-2.5-pro) ➔ Delegated Worker: binhthuong@gmail.com (claude-opus-5-5-high) | Clef Gate: clef-flash-9b (Local Surrogate) (1.2ms • complexity: 2.1/4.0)";

    const parsed = parseFleetExecutionFromMessage(message);
    expect(parsed).not.toBeNull();
    expect(parsed?.clefGate).toBeDefined();
    expect(parsed?.clefGate?.model).toContain("clef-flash-9b");
    expect(parsed?.clefGate?.latencyMs).toBe(1.2);
    expect(parsed?.clefGate?.complexityScore).toBe(2.1);
  });
});
