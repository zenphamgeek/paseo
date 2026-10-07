import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export interface ConversationTelegramStoreState {
  enabledConversations: Record<string, boolean>;
  isTelegramEnabled: (conversationId: string) => boolean;
  setTelegramEnabled: (conversationId: string, enabled: boolean) => void;
  toggleTelegram: (conversationId: string) => boolean;
}

const ConversationTelegramPersistedStateSchema = z.strictObject({
  enabledConversations: z.record(z.string(), z.boolean()).default({}),
});

type ConversationTelegramPersistedState = z.infer<typeof ConversationTelegramPersistedStateSchema>;

export const useConversationTelegramStore = create<ConversationTelegramStoreState>()(
  persist(
    (set, get) => ({
      enabledConversations: {},

      isTelegramEnabled: (conversationId: string): boolean => {
        if (!conversationId) return false;
        // Default is strictly false (OFF) per system requirements
        return Boolean(get().enabledConversations[conversationId]);
      },

      setTelegramEnabled: (conversationId: string, enabled: boolean) => {
        if (!conversationId) return;
        set((state) => ({
          enabledConversations: {
            ...state.enabledConversations,
            [conversationId]: enabled,
          },
        }));
      },

      toggleTelegram: (conversationId: string): boolean => {
        if (!conversationId) return false;
        const current = Boolean(get().enabledConversations[conversationId]);
        const next = !current;
        set((state) => ({
          enabledConversations: {
            ...state.enabledConversations,
            [conversationId]: next,
          },
        }));
        return next;
      },
    }),
    {
      name: "zencode:conversation:telegram:settings",
      storage: createValidatedPersistStorage<ConversationTelegramPersistedState>(
        AsyncStorage,
        ConversationTelegramPersistedStateSchema,
      ),
      partialize: (state) => ({
        enabledConversations: state.enabledConversations,
      }),
    },
  ),
);

/**
 * Dispatches a Telegram notification for a conversation event (completed, attention_needed, error).
 * Strictly checks that Telegram notifications are explicitly enabled for this conversationId.
 * If disabled (the default), exits immediately with zero network overhead.
 */
export async function dispatchConversationTelegramNotification(params: {
  conversationId: string;
  title?: string;
  event: "completed" | "attention_needed" | "error";
  summary?: string;
}): Promise<{ sent: boolean; reason?: string; messageId?: number }> {
  if (!params.conversationId) {
    return { sent: false, reason: "missing_conversation_id" };
  }

  const isEnabled = useConversationTelegramStore
    .getState()
    .isTelegramEnabled(params.conversationId);

  if (!isEnabled) {
    return { sent: false, reason: "telegram_disabled_for_conversation" };
  }

  try {
    const res = await fetch("/api/fleet/telegram/conversation-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { sent: false, reason: `http_${res.status}: ${errText}` };
    }

    const data = (await res.json()) as { sent: boolean; reason?: string; messageId?: number };
    return data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sent: false, reason: `network_error: ${msg}` };
  }
}
