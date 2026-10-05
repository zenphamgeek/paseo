import fs from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import type { FleetNodeConfig } from "../types.js";

export interface NebulaExecutionOptions {
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface NebulaExecutionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  model: string;
}

export class NebulaDirectClient {
  private readonly config: FleetNodeConfig;
  private readonly logger: Logger;
  private apiKey: string = "";
  private endpoint: string = "https://api.b.ai/v1";

  constructor(options: { config: FleetNodeConfig; logger: Logger }) {
    this.config = options.config;
    this.logger = options.logger.child({ module: "nebula-direct", nodeId: options.config.id });
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      const cfgPath = path.join(this.config.homeDirectory, ".node_config.json");
      if (fs.existsSync(cfgPath)) {
        const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        this.apiKey = raw.api_key || process.env.NEBULA_API_KEY || "";
        this.endpoint = (raw.endpoint || "https://api.b.ai/v1").replace(/\/+$/, "");
      }
    } catch (err) {
      this.logger.warn({ err }, "Could not load .node_config.json for Nebula");
    }
  }

  private buildPayload(prompt: string, options: NebulaExecutionOptions, model: string) {
    const messages = [];
    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    return {
      model,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.7,
    };
  }

  private parseResponse(data: unknown, latencyMs: number, model: string): NebulaExecutionResult {
    const typedData = data as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = typedData.choices?.[0];
    const content = choice?.message?.content || "";
    const usage = typedData.usage || {};

    return {
      content,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      latencyMs,
      model,
    };
  }

  public async executeChat(
    prompt: string,
    options: NebulaExecutionOptions = {},
  ): Promise<NebulaExecutionResult> {
    if (!this.apiKey) {
      this.loadConfig();
    }
    if (!this.apiKey) {
      throw new Error("B.AI Nebula API key is not configured");
    }

    const model = options.model || this.config.preferredModel || "claude-opus-4.8";
    const timeoutMs = options.timeoutMs || 100_000;
    const payload = this.buildPayload(prompt, options, model);

    const startTime = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`B.AI Nebula API Error (HTTP ${res.status}): ${errText}`);
      }

      const data = await res.json();
      return this.parseResponse(data, latencyMs, model);
    } catch (err: unknown) {
      clearTimeout(timeout);
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        throw new Error(`B.AI Nebula request timed out after ${timeoutMs}ms`, { cause: err });
      }
      throw err;
    }
  }
}
