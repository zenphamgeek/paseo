import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";

export interface TelegramConfig {
  botName?: string;
  token: string;
  chatId: string;
  enabled: boolean;
}

export type AlertSeverity = "critical" | "warning" | "info" | "resolved";

export interface AlertPayload {
  alertKey: string;
  severity: AlertSeverity;
  title: string;
  source: "onnx" | "fleet" | "proxy" | "hermes" | "router";
  evidence?: Record<string, unknown>;
  nodeId?: string;
}

export interface AlertStateRecord {
  state: "firing" | "resolved";
  severity: AlertSeverity;
  firstFired: number;
  lastSent: number;
  dedupCount: number;
  telegramMsgId?: number;
}

export class TelegramAlerter {
  private config: TelegramConfig;
  private readonly alertState = new Map<string, AlertStateRecord>();
  private readonly cooldownMs: number;
  private logger?: Logger;

  constructor(options?: {
    config?: Partial<TelegramConfig>;
    cooldownMs?: number;
    logger?: Logger;
  }) {
    this.cooldownMs = options?.cooldownMs ?? 300_000; // 5 min cooldown
    this.logger = options?.logger;
    this.config = this.resolveConfig(options?.config);
  }

  private resolveConfig(override?: Partial<TelegramConfig>): TelegramConfig {
    let token = process.env.TELEGRAM_BOT_TOKEN || "";
    let chatId = process.env.TELEGRAM_CHAT_ID || "";
    let botName = "Phamvuthang (@zenpham_bot)";

    // Try reading local config file from ~/.antigravity-controller/telegram_config.json
    const configPath = join(homedir(), ".antigravity-controller", "telegram_config.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.token) token = parsed.token;
        if (parsed.chatId) chatId = parsed.chatId;
        if (parsed.botName) botName = parsed.botName;
      } catch (err) {
        this.logger?.warn(
          { err },
          "Failed to parse ~/.antigravity-controller/telegram_config.json",
        );
      }
    }

    return {
      botName: override?.botName ?? botName,
      token: override?.token ?? token,
      chatId: override?.chatId ?? chatId,
      enabled: override?.enabled ?? Boolean(token && chatId),
    };
  }

  public getConfig(): Omit<TelegramConfig, "token"> & { hasToken: boolean } {
    return {
      botName: this.config.botName,
      chatId: this.config.chatId,
      enabled: this.config.enabled,
      hasToken: Boolean(this.config.token),
    };
  }

  public setConfig(newConfig: Partial<TelegramConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      enabled: newConfig.enabled ?? Boolean(newConfig.token || this.config.token),
    };
  }

  private escapeMarkdownV2(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
  }

  private getSeverityIcon(severity: AlertSeverity): string {
    switch (severity) {
      case "critical":
        return "🔴";
      case "warning":
        return "🟡";
      case "resolved":
        return "🟢";
      default:
        return "ℹ️";
    }
  }

  private checkCooldown(
    alert: AlertPayload,
    now: number,
  ): { sent: boolean; suppressed: boolean; reason: string } | null {
    const existing = this.alertState.get(alert.alertKey);
    if (!existing || existing.state !== "firing" || alert.severity === "resolved") {
      return null;
    }
    const elapsed = now - existing.lastSent;
    if (elapsed < this.cooldownMs && existing.severity === alert.severity) {
      existing.dedupCount += 1;
      return {
        sent: false,
        suppressed: true,
        reason: `cooldown_active (${Math.round((this.cooldownMs - elapsed) / 1000)}s remaining)`,
      };
    }
    return null;
  }

  private formatAlertMessage(alert: AlertPayload, now: number, dedupCount: number): string {
    const severityIcon = this.getSeverityIcon(alert.severity);
    const titleStr = `${severityIcon} *[${alert.severity.toUpperCase()}]* — ${this.escapeMarkdownV2(alert.title)}`;
    const sourceStr = `*Source*: \`${this.escapeMarkdownV2(alert.source)}\`${alert.nodeId ? ` (*Node*: \`${this.escapeMarkdownV2(alert.nodeId)}\`)` : ""}`;
    const timestampStr = `*Time*: \`${new Date(now).toISOString()}\``;

    let evidenceLines = "";
    if (alert.evidence && Object.keys(alert.evidence).length > 0) {
      const parts: string[] = [];
      for (const [key, val] of Object.entries(alert.evidence)) {
        parts.push(`• ${this.escapeMarkdownV2(key)}: \`${this.escapeMarkdownV2(String(val))}\``);
      }
      evidenceLines = `\n*Evidence*:\n${parts.join("\n")}`;
    }

    const dedupNotice =
      dedupCount > 0 ? `\n_(${dedupCount} repeat alerts suppressed during cooldown)_` : "";

    return `${titleStr}\n${sourceStr}\n${timestampStr}${evidenceLines}${dedupNotice}\n_Key_: \`${this.escapeMarkdownV2(alert.alertKey)}\``;
  }

  public async dispatchAlert(alert: AlertPayload): Promise<{
    sent: boolean;
    suppressed?: boolean;
    reason?: string;
    messageId?: number;
  }> {
    if (!this.config.enabled || !this.config.token || !this.config.chatId) {
      return { sent: false, reason: "telegram_disabled_or_unconfigured" };
    }

    const now = Date.now();
    const cooldownCheck = this.checkCooldown(alert, now);
    if (cooldownCheck) {
      return cooldownCheck;
    }

    const existing = this.alertState.get(alert.alertKey);
    const dedupCount = existing?.dedupCount ?? 0;
    const messageText = this.formatAlertMessage(alert, now, dedupCount);

    try {
      const url = `https://api.telegram.org/bot${this.config.token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text: messageText,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { sent: false, reason: `telegram_api_error_${res.status}: ${errText}` };
      }

      const resJson = (await res.json()) as { ok: boolean; result?: { message_id: number } };
      const messageId = resJson.result?.message_id;

      this.alertState.set(alert.alertKey, {
        state: alert.severity === "resolved" ? "resolved" : "firing",
        severity: alert.severity,
        firstFired: existing ? existing.firstFired : now,
        lastSent: now,
        dedupCount: 0,
        telegramMsgId: messageId,
      });

      return { sent: true, messageId };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { sent: false, reason: `network_error: ${errMsg}` };
    }
  }

  public async sendTestAlert(message?: string): Promise<{ sent: boolean; reason?: string }> {
    return this.dispatchAlert({
      alertKey: "zencode:system:manual_test",
      severity: "info",
      title: message || "Zencode Swarm Telemetry Test Alert",
      source: "router",
      evidence: {
        cluster: "Zencode Swarm",
        nodesCount: 15,
        proxySlots: 16,
        status: "All systems nominal",
      },
    });
  }
}

let alerterInstance: TelegramAlerter | null = null;

export function getTelegramAlerter(): TelegramAlerter {
  if (!alerterInstance) {
    alerterInstance = new TelegramAlerter();
  }
  return alerterInstance;
}
