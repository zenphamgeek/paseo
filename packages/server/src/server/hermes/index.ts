import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface SqliteDatabaseSync {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  };
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabaseSync;
}

function getDatabaseSync():
  | (new (path: string, options?: { readOnly?: boolean }) => SqliteDatabaseSync)
  | null {
  try {
    const localRequire = createRequire(import.meta.url);
    const mod = localRequire("node:sqlite") as SqliteModule;
    return mod.DatabaseSync;
  } catch {
    return null;
  }
}

const DatabaseSync = getDatabaseSync();

export interface HermesTaskSummary {
  totalTasks: number;
  byStatus: Record<string, number>;
  latestTask?: {
    id: string;
    title: string;
    status: string;
    updatedAt?: number;
  };
}

export interface HermesStateSummary {
  totalSessions: number;
  latestSessionId?: string;
  totalMessages: number;
}

export interface HermesEvidenceSummary {
  totalEvents: number;
  latestState?: string;
}

export interface HermesHealthStatus {
  installed: boolean;
  version?: string;
  homeDir: string;
  kanban: HermesTaskSummary;
  state: HermesStateSummary;
  evidence: HermesEvidenceSummary;
  gateway?: {
    active: boolean;
    channels?: string[];
  };
}

export class HermesManager {
  private readonly hermesHome: string;
  private readonly binaryPath: string;

  constructor(options?: { hermesHome?: string; binaryPath?: string }) {
    this.hermesHome = options?.hermesHome || join(homedir(), ".hermes");
    this.binaryPath = options?.binaryPath || join(homedir(), ".local", "bin", "hermes");
  }

  public isInstalled(): boolean {
    return existsSync(this.binaryPath);
  }

  public async getVersion(): Promise<string | undefined> {
    if (!this.isInstalled()) return undefined;
    try {
      const { stdout } = await execFileAsync(this.binaryPath, ["--version"]);
      return stdout.trim().split("\n")[0];
    } catch {
      return undefined;
    }
  }

  public getKanbanSummary(): HermesTaskSummary {
    const dbPath = join(this.hermesHome, "kanban.db");
    if (!DatabaseSync || !existsSync(dbPath)) {
      return { totalTasks: 0, byStatus: {} };
    }

    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db
        .prepare("SELECT status, count(*) as count FROM tasks GROUP BY status")
        .all() as Array<{
        status: string;
        count: number;
      }>;

      const byStatus: Record<string, number> = {};
      let totalTasks = 0;
      for (const row of rows) {
        byStatus[row.status] = Number(row.count);
        totalTasks += Number(row.count);
      }

      const latest = db
        .prepare("SELECT id, title, status, created_at FROM tasks ORDER BY created_at DESC LIMIT 1")
        .get() as { id: string; title: string; status: string; created_at?: number } | undefined;

      return {
        totalTasks,
        byStatus,
        latestTask: latest
          ? {
              id: String(latest.id),
              title: String(latest.title),
              status: String(latest.status),
              updatedAt: latest.created_at ? Number(latest.created_at) : undefined,
            }
          : undefined,
      };
    } catch {
      return { totalTasks: 0, byStatus: {} };
    }
  }

  public getStateSummary(): HermesStateSummary {
    const dbPath = join(this.hermesHome, "state.db");
    if (!DatabaseSync || !existsSync(dbPath)) {
      return { totalSessions: 0, totalMessages: 0 };
    }

    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const sessionCountRow = db.prepare("SELECT count(*) as count FROM sessions").get() as
        | { count: number }
        | undefined;
      const messageCountRow = db.prepare("SELECT count(*) as count FROM messages").get() as
        | { count: number }
        | undefined;
      const latestSessionRow = db
        .prepare("SELECT id FROM sessions ORDER BY rowid DESC LIMIT 1")
        .get() as { id: string } | undefined;

      return {
        totalSessions: sessionCountRow ? Number(sessionCountRow.count) : 0,
        totalMessages: messageCountRow ? Number(messageCountRow.count) : 0,
        latestSessionId: latestSessionRow?.id ? String(latestSessionRow.id) : undefined,
      };
    } catch {
      return { totalSessions: 0, totalMessages: 0 };
    }
  }

  public getEvidenceSummary(): HermesEvidenceSummary {
    const dbPath = join(this.hermesHome, "verification_evidence.db");
    if (!DatabaseSync || !existsSync(dbPath)) {
      return { totalEvents: 0 };
    }

    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const countRow = db.prepare("SELECT count(*) as count FROM verification_events").get() as
        | { count: number }
        | undefined;
      const latestStateRow = db
        .prepare(
          "SELECT session_id, root, last_edit_at FROM verification_state ORDER BY rowid DESC LIMIT 1",
        )
        .get() as
        | {
            session_id: string;
            root: string;
            last_edit_at?: string;
          }
        | undefined;

      return {
        totalEvents: countRow ? Number(countRow.count) : 0,
        latestState: latestStateRow
          ? `${latestStateRow.session_id} (${latestStateRow.root})`
          : undefined,
      };
    } catch {
      return { totalEvents: 0 };
    }
  }

  public getGatewayState(): { active: boolean; channels?: string[] } | undefined {
    const jsonPath = join(this.hermesHome, "gateway_state.json");
    if (!existsSync(jsonPath)) return undefined;

    try {
      const raw = readFileSync(jsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        active: Boolean(parsed.active ?? true),
        channels: Array.isArray(parsed.channels) ? parsed.channels : ["telegram"],
      };
    } catch {
      return undefined;
    }
  }

  public async getHealthStatus(): Promise<HermesHealthStatus> {
    const version = await this.getVersion();
    return {
      installed: this.isInstalled(),
      version,
      homeDir: this.hermesHome,
      kanban: this.getKanbanSummary(),
      state: this.getStateSummary(),
      evidence: this.getEvidenceSummary(),
      gateway: this.getGatewayState(),
    };
  }

  public async executeOneShot(
    prompt: string,
    model?: string,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    if (!this.isInstalled()) {
      return { success: false, output: "", error: "hermes_binary_not_found" };
    }

    const args = ["-z", prompt];
    if (model) {
      args.push("-m", model);
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.binaryPath, args, {
        timeout: 60_000,
        env: { ...process.env, HERMES_HOME: this.hermesHome },
      });
      return { success: true, output: stdout.trim(), error: stderr.trim() || undefined };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: errorMsg };
    }
  }
}

let hermesInstance: HermesManager | null = null;

export function getHermesManager(): HermesManager {
  if (!hermesInstance) {
    hermesInstance = new HermesManager();
  }
  return hermesInstance;
}
