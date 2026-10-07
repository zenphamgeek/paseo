import { memo, useCallback } from "react";
import { Pressable, View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TelegramIcon } from "@/components/icons/telegram-icon";
import { useConversationTelegramStore } from "@/stores/conversation-telegram-store";
import { useToast } from "@/contexts/toast-context";
import { playVibeSound } from "@/utils/vibe-audio";

export interface TelegramNotificationToggleProps {
  conversationId?: string;
  compact?: boolean;
}

export const TelegramNotificationToggle = memo(function TelegramNotificationToggle({
  conversationId,
  compact = false,
}: TelegramNotificationToggleProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const toast = useToast();

  const isEnabled = useConversationTelegramStore((state) =>
    conversationId ? state.isTelegramEnabled(conversationId) : false,
  );
  const toggleTelegram = useConversationTelegramStore((state) => state.toggleTelegram);

  const handleToggle = useCallback(() => {
    if (!conversationId) return;
    const nextState = toggleTelegram(conversationId);
    playVibeSound("vibe_start");

    if (nextState) {
      toast.show("Telegram notifications enabled for this conversation (notifying @zenpham_bot)", {
        variant: "info",
        durationMs: 3000,
      });
    } else {
      toast.show("Telegram notifications disabled for this conversation", {
        variant: "info",
        durationMs: 2500,
      });
    }
  }, [conversationId, toast, toggleTelegram]);

  if (!conversationId) {
    return null;
  }

  const tooltipText = isEnabled
    ? "Telegram Alerts: ON (Click to turn off for this conversation)"
    : "Telegram Alerts: OFF (Click to receive notifications on Telegram)";

  const activeColor = "#20E9C3"; // Zencode Mint
  const inactiveColor = theme.colors.foregroundMuted;

  return (
    <Tooltip>
      <TooltipTrigger>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tooltipText}
          accessibilityState={{ checked: isEnabled }}
          testID="conversation-telegram-toggle"
          onPress={handleToggle}
          style={({ pressed, hovered }) => [
            styles.container,
            isEnabled && styles.activeContainer,
            (pressed || hovered) && styles.hoveredContainer,
            compact && styles.compactContainer,
          ]}
        >
          <TelegramIcon size={compact ? 13 : 15} color={isEnabled ? activeColor : inactiveColor} />
          {isEnabled ? <View style={styles.activeDot} testID="telegram-active-badge" /> : null}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top">
        <Text style={styles.tooltipLabel}>{tooltipText}</Text>
      </TooltipContent>
    </Tooltip>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "transparent",
    position: "relative",
    borderWidth: 1,
    borderColor: "transparent",
  },
  compactContainer: {
    width: 24,
    height: 24,
    borderRadius: 5,
  },
  activeContainer: {
    backgroundColor: "rgba(32, 233, 195, 0.12)",
    borderColor: "rgba(32, 233, 195, 0.35)",
  },
  hoveredContainer: {
    backgroundColor: theme.colors.surface3,
  },
  activeDot: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#20E9C3",
  },
  tooltipLabel: {
    fontSize: 12,
    color: theme.colors.foreground,
  },
}));
