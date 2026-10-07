import type { FleetExecutionMetadata } from "@getpaseo/protocol/fleet-types";

export type { FleetExecutionMetadata };

export function parseFleetExecutionFromMessage(
  message: string | null | undefined,
): FleetExecutionMetadata | null {
  if (!message || typeof message !== "string" || !message.includes("[Fleet Mode Active]")) {
    return null;
  }

  // Regex pattern matching:
  // [Fleet Mode Active] Orchestrator: <node> (<model>) ➔ Delegated Worker: <node> (<model>)
  const match = message.match(
    /\[Fleet Mode Active\]\s*Orchestrator:\s*([^(]+?)\s*\(([^)]+?)\)\s*(?:➔|->)\s*Delegated Worker:\s*([^(]+?)\s*\(([^)]+?)\)/i,
  );

  if (!match) {
    return {
      isFleetMode: true,
      orchestratorNode: "Fleet Orchestrator",
      orchestratorModel: "gemini-2.5-pro",
      workerNode: "Swarm Worker",
      workerModel: "claude-opus-5-5-high",
      tier: "pro",
    };
  }

  // Parse optional Clef Gate section: | Clef Gate: <model> (<lat> • complexity: <comp>)
  const clefParts = message.split(/\|\s*Clef Gate:\s*/i);
  let clefGate: FleetExecutionMetadata["clefGate"] = undefined;
  if (clefParts.length > 1) {
    const clefSection = clefParts[1].trim();
    const latMatch = clefSection.match(/([\d.]+)ms/i);
    const compMatch = clefSection.match(/complexity:\s*([\d.]+)/i);
    const model = clefSection.split(/\s*\([\d.]+/)[0]?.trim() || "clef-flash-9b";
    clefGate = {
      model,
      latencyMs: latMatch ? parseFloat(latMatch[1]) : undefined,
      complexityScore: compMatch ? parseFloat(compMatch[1]) : undefined,
    };
  }

  return {
    isFleetMode: true,
    orchestratorNode: match[1]?.trim() ?? "Fleet Orchestrator",
    orchestratorModel: match[2]?.trim() ?? "gemini-2.5-pro",
    workerNode: match[3]?.trim() ?? "Swarm Worker",
    workerModel: match[4]?.trim() ?? "claude-opus-5-5-high",
    tier: "pro",
    clefGate,
  };
}

export function formatFleetExecutionLabel(meta: {
  orchestratorNode: string;
  orchestratorModel: string;
  workerNode: string;
  workerModel: string;
}): string {
  return `[Fleet Mode Active] Orchestrator: ${meta.orchestratorNode} (${meta.orchestratorModel}) ➔ Delegated Worker: ${meta.workerNode} (${meta.workerModel})`;
}

export function resolveFleetExecutionDetails(
  fleetExecution?: FleetExecutionMetadata,
  message?: string,
): FleetExecutionMetadata | null {
  if (fleetExecution && fleetExecution.isFleetMode) {
    return fleetExecution;
  }
  if (message) {
    return parseFleetExecutionFromMessage(message);
  }
  return null;
}
