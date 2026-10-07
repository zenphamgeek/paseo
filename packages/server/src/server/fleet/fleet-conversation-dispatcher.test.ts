import { describe, expect, it, vi } from "vitest";
import {
  extractPromptText,
  formatFleetExecutionLabel,
  isFleetExecutionActive,
  stripFleetPromptPrefix,
  dispatchFleetExecutionForConversation,
} from "./fleet-conversation-dispatcher.js";
import { FleetRegistry, setFleetRegistry } from "./registry.js";
import { NineRouter, setNineRouter } from "../router/index.js";
import pino from "pino";

describe("fleet-conversation-dispatcher", () => {
  const logger = pino({ level: "silent" });
  const registry = new FleetRegistry({ logger });
  const router = new NineRouter({ registry, logger });
  setFleetRegistry(registry);
  setNineRouter(router);

  describe("isFleetExecutionActive", () => {
    it("detects fleet mode when sessionMode is 'fleet'", () => {
      expect(isFleetExecutionActive("build app", null, "fleet")).toBe(true);
    });

    it("detects fleet mode when currentModeId is 'fleet'", () => {
      expect(isFleetExecutionActive("build app", "fleet", null)).toBe(true);
    });

    it("detects /fleet slash command prefix", () => {
      expect(isFleetExecutionActive("/fleet run epic tests", "build", null)).toBe(true);
      expect(isFleetExecutionActive("/fleet_run verify matrix", "build", null)).toBe(true);
      expect(isFleetExecutionActive("fleet_run optimize quotas", "build", null)).toBe(true);
      expect(isFleetExecutionActive("#fleet do task", "build", null)).toBe(true);
    });

    it("detects fleet mode in structured prompt blocks", () => {
      const prompt = [{ type: "text" as const, text: "/fleet analyze latency" }];
      expect(isFleetExecutionActive(prompt, "build", null)).toBe(true);
    });

    it("detects fleet mode in runOptions", () => {
      expect(isFleetExecutionActive("hello", "build", null, { fleetMode: true } as any)).toBe(true);
    });

    it("returns false for regular prompts and modes", () => {
      expect(isFleetExecutionActive("hello world", "build", null)).toBe(false);
      expect(isFleetExecutionActive("npm run build", "plan", null)).toBe(false);
    });
  });

  describe("stripFleetPromptPrefix", () => {
    it("strips /fleet prefix from string prompts", () => {
      expect(stripFleetPromptPrefix("/fleet build ui")).toBe("build ui");
      expect(stripFleetPromptPrefix("/fleet_run audit security")).toBe("audit security");
      expect(stripFleetPromptPrefix("fleet_run sync nodes")).toBe("sync nodes");
      expect(stripFleetPromptPrefix("#fleet fix lint")).toBe("fix lint");
    });

    it("strips /fleet prefix from structured blocks", () => {
      const blocks = [{ type: "text" as const, text: "/fleet run migrations" }];
      expect(stripFleetPromptPrefix(blocks)).toEqual([{ type: "text", text: "run migrations" }]);
    });

    it("leaves prompts without fleet prefix untouched", () => {
      expect(stripFleetPromptPrefix("normal prompt")).toBe("normal prompt");
    });
  });

  describe("formatFleetExecutionLabel", () => {
    it("formats human-readable label with orchestrator and worker details", () => {
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
  });

  describe("dispatchFleetExecutionForConversation", () => {
    it("does nothing if fleet mode is not active", async () => {
      const appendTimelineItem = vi.fn();
      const mockAgentManager = {
        getAgent: vi.fn().mockReturnValue({ id: "agent-1", currentModeId: "build" }),
        appendTimelineItem,
      };

      const result = await dispatchFleetExecutionForConversation({
        agentManager: mockAgentManager as any,
        agentId: "agent-1",
        prompt: "regular prompt",
        logger,
      });

      expect(result.isFleetMode).toBe(false);
      expect(result.fleetExecution).toBeNull();
      expect(appendTimelineItem).not.toHaveBeenCalled();
    });

    it("logs a Fleet Mode label with Orchestrator and Worker to Conversation timeline", async () => {
      const appendTimelineItem = vi.fn().mockResolvedValue({ seq: 1, epoch: "1" });
      const mockAgentManager = {
        getAgent: vi.fn().mockReturnValue({
          id: "agent-fleet-1",
          model: "gemini-2.5-pro",
          currentModeId: "fleet",
          labels: {
            orchestratorNode: "zenpham@gmail.com",
            fleetTier: "ultra",
          },
        }),
        appendTimelineItem,
      };

      const result = await dispatchFleetExecutionForConversation({
        agentManager: mockAgentManager as any,
        agentId: "agent-fleet-1",
        prompt: "/fleet execute critical database migration",
        mode: "fleet",
        logger,
      });

      expect(result.isFleetMode).toBe(true);
      expect(result.cleanPrompt).toBe("execute critical database migration");
      expect(result.fleetExecution).not.toBeNull();
      expect(result.fleetExecution?.isFleetMode).toBe(true);
      expect(result.fleetExecution?.orchestratorNode).toBe("zenpham@gmail.com");
      expect(result.fleetExecution?.orchestratorModel).toBe("gemini-2.5-pro");
      expect(result.fleetExecution?.workerNode).toBeDefined();
      expect(result.fleetExecution?.workerModel).toBeDefined();

      // Verify appendTimelineItem was invoked with notification and fleetExecution
      expect(appendTimelineItem).toHaveBeenCalledTimes(1);
      const [calledAgentId, item] = appendTimelineItem.mock.calls[0];
      expect(calledAgentId).toBe("agent-fleet-1");
      expect(item.type).toBe("notification");
      expect(item.level).toBe("info");
      expect(item.message).toContain("[Fleet Mode Active]");
      expect(item.message).toContain("Orchestrator: zenpham@gmail.com (gemini-2.5-pro)");
      expect(item.fleetExecution).toEqual(result.fleetExecution);
    });
  });
});
