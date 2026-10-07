import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import {
  useConversationTelegramStore,
  dispatchConversationTelegramNotification,
} from "./conversation-telegram-store";

describe("Conversation Telegram Notification Store", () => {
  beforeEach(() => {
    useConversationTelegramStore.setState({ enabledConversations: {} });
    vi.restoreAllMocks();
  });

  it("defaults to false (disabled) for any new conversation ID", () => {
    const store = useConversationTelegramStore.getState();
    expect(store.isTelegramEnabled("agent-1")).toBe(false);
    expect(store.isTelegramEnabled("agent-random-999")).toBe(false);
    expect(store.isTelegramEnabled("")).toBe(false);
  });

  it("toggles telegram notification status for an agent", () => {
    const store = useConversationTelegramStore.getState();

    // Toggle from false -> true
    const next1 = store.toggleTelegram("agent-1");
    expect(next1).toBe(true);
    expect(useConversationTelegramStore.getState().isTelegramEnabled("agent-1")).toBe(true);

    // Another agent remains false
    expect(useConversationTelegramStore.getState().isTelegramEnabled("agent-2")).toBe(false);

    // Toggle from true -> false
    const next2 = store.toggleTelegram("agent-1");
    expect(next2).toBe(false);
    expect(useConversationTelegramStore.getState().isTelegramEnabled("agent-1")).toBe(false);
  });

  it("sets telegram notification status explicitly", () => {
    const store = useConversationTelegramStore.getState();
    store.setTelegramEnabled("agent-1", true);
    expect(useConversationTelegramStore.getState().isTelegramEnabled("agent-1")).toBe(true);

    store.setTelegramEnabled("agent-1", false);
    expect(useConversationTelegramStore.getState().isTelegramEnabled("agent-1")).toBe(false);
  });

  it("suppresses network calls when conversation telegram is disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await dispatchConversationTelegramNotification({
      conversationId: "agent-disabled",
      title: "My Feature",
      event: "completed",
      summary: "Finished task",
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("telegram_disabled_for_conversation");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dispatches HTTP request to /api/fleet/telegram/conversation-notify when enabled", async () => {
    useConversationTelegramStore.getState().setTelegramEnabled("agent-enabled", true);

    const mockResponse = { ok: true, json: async () => ({ sent: true, messageId: 999 }) };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as any);

    const result = await dispatchConversationTelegramNotification({
      conversationId: "agent-enabled",
      title: "Zencode Swarm",
      event: "completed",
      summary: "Refactored UI successfully",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/fleet/telegram/conversation-notify",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "agent-enabled",
          title: "Zencode Swarm",
          event: "completed",
          summary: "Refactored UI successfully",
        }),
      }),
    );
    expect(result.sent).toBe(true);
    expect(result.messageId).toBe(999);
  });
});
