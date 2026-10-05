import { spawn } from "node:child_process";
import type { Logger } from "pino";
import type { FleetNodeConfig } from "../types.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export interface AGYExecutionOptions {
  model?: string;
  timeoutMs?: number;
  dangerouslySkipPermissions?: boolean;
  extraEnv?: Record<string, string>;
}

export interface AGYExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  parsedResponse?: {
    conversation_id?: string;
    status?: string;
    response?: string;
    error?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      thinking_tokens?: number;
      total_tokens?: number;
    };
  };
}

export class AGYHomeNodeClient {
  private readonly config: FleetNodeConfig;
  private readonly logger: Logger;
  private readonly agyBin: string;

  constructor(options: { config: FleetNodeConfig; logger: Logger; agyBin?: string }) {
    this.config = options.config;
    this.logger = options.logger.child({ module: "agy-home-node", nodeId: options.config.id });
    this.agyBin = options.agyBin || process.env.AGY_BIN || "/home/zen/.local/bin/agy";
  }

  public async executePrompt(
    prompt: string,
    options: AGYExecutionOptions = {},
  ): Promise<AGYExecutionResult> {
    const model = options.model || this.config.preferredModel || "gemini-3.8-flash-high";
    const timeoutMs = options.timeoutMs || 300_000;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: this.config.homeDirectory,
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/dev/null",
      ...options.extraEnv,
    };

    const args = ["--print", prompt, "--output-format", "json", "--model", model];

    if (options.dangerouslySkipPermissions !== false) {
      args.push("--dangerously-skip-permissions");
    }

    this.logger.info(
      { model, home: this.config.homeDirectory, promptPreview: prompt.slice(0, 60) },
      "Executing prompt on AGY Home Node",
    );

    const child = spawn(this.agyBin, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    let timer: NodeJS.Timeout | null = null;
    const timeoutDeferred = createDeferred<{ code: number }>();
    timer = setTimeout(() => {
      this.logger.warn({ timeoutMs }, "AGY CLI execution timed out, killing child process");
      child.kill("SIGKILL");
      timeoutDeferred.resolve({ code: -1 });
    }, timeoutMs);

    const closeDeferred = createDeferred<{ code: number }>();
    child.once("close", (exitCode) => closeDeferred.resolve({ code: exitCode ?? -1 }));
    child.once("error", (err) => {
      stderr += String(err);
      closeDeferred.resolve({ code: -1 });
    });

    const { code } = await Promise.race([closeDeferred.promise, timeoutDeferred.promise]);
    if (timer) clearTimeout(timer);

    let parsed: AGYExecutionResult["parsedResponse"];
    try {
      if (stdout.trim()) {
        parsed = JSON.parse(stdout.trim());
      }
    } catch {
      // stdout might contain plain text or unparseable JSON
    }

    return {
      stdout,
      stderr,
      exitCode: code,
      parsedResponse: parsed,
    };
  }
}
