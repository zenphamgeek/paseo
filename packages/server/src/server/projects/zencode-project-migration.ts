import { exec } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Logger } from "pino";

const execAsync = promisify(exec);

export type ProjectCategory = "development" | "infrastructure" | "content" | "platform";
export type ProjectHealthState = "HEALTHY" | "DEGRADED" | "OFFLINE" | "UNKNOWN";

export interface ProjectQualityGateDef {
  testCommand?: string;
  lintCommand?: string;
  securityScanCommand?: string;
  smokeCommand?: string;
  artCoverageCommand?: string;
  councilGateCommand?: string;
}

export interface ProjectHealthCheckDef {
  id: string;
  command: string;
  timeoutSeconds: number;
}

export interface ManagedProjectDef {
  id: string;
  displayName: string;
  rootPath: string;
  kind: "git" | "non_git";
  category: ProjectCategory;
  description: string;
  gitRemote?: string;
  qualityGates: ProjectQualityGateDef;
  healthChecks: ProjectHealthCheckDef[];
}

export interface MigratedProjectStatus extends ManagedProjectDef {
  exists: boolean;
  diskSize?: string;
  gitBranch?: string;
  healthStatus: ProjectHealthState;
  lastHealthCheck?: number;
  lastHealthOutput?: string;
}

export const MANAGED_PROJECTS: ManagedProjectDef[] = [
  {
    id: "gray_doom",
    displayName: "Gray Doom: Strategic Command",
    rootPath: "/home/zen/gray-doom",
    kind: "git",
    category: "development",
    description:
      "Near-future strategic command game with 3 factions, TravianZ engine, Docker/PostgreSQL/Redis architecture, and 220+ art assets.",
    gitRemote: "https://github.com/zenphamgeek/gray-doom.git",
    qualityGates: {
      testCommand: "cd /home/zen/gray-doom && npm test",
      artCoverageCommand: "cd /home/zen/gray-doom && node scripts/art-coverage.js",
      smokeCommand:
        "cd /home/zen/gray-doom && node --test tests/brand-assets.test.js tests/field-balance-data.test.js",
    },
    healthChecks: [
      {
        id: "gray_doom_smoke",
        command: "test -f /home/zen/gray-doom/compose.yaml && test -d /home/zen/gray-doom/src",
        timeoutSeconds: 15,
      },
    ],
  },
  {
    id: "verticalrisk_grc",
    displayName: "VerticalRisk GRC Platform",
    rootPath: "/home/zen/VerticalRisk",
    kind: "git",
    category: "development",
    description:
      "Enterprise Governance, Risk & Compliance (GRC) platform with automated schema snapshotting and security scanner.",
    qualityGates: {
      testCommand: "cd /home/zen/VerticalRisk && npx vitest run",
      securityScanCommand:
        "cd /home/zen/VerticalRisk && python3 scripts/counter_code_scanner.py --scope extensions",
    },
    healthChecks: [
      {
        id: "verticalrisk_schema_check",
        command:
          "test -f /home/zen/VerticalRisk/schema/snapshot.yaml && test -d /home/zen/VerticalRisk/extensions",
        timeoutSeconds: 15,
      },
    ],
  },
  {
    id: "insilos_odoo",
    displayName: "Insilos Enterprise (Odoo 20)",
    rootPath: "/home/zen/insilos-release-work",
    kind: "git",
    category: "development",
    description:
      "Insilos core enterprise platform (Odoo 20, Enterprise modules, Mobile app, and release engineering).",
    qualityGates: {
      testCommand: "cd /home/zen/insilos-release-work && npx vitest run",
      lintCommand: "cd /home/zen/insilos-release-work && npx eslint extensions/",
    },
    healthChecks: [
      {
        id: "insilos_workspace_check",
        command:
          "test -f /home/zen/insilos-release-work/Dockerfile && test -d /home/zen/insilos-release-work/insilos",
        timeoutSeconds: 15,
      },
    ],
  },
  {
    id: "hermes_agent",
    displayName: "Hermes Autonomous Agent & Modal GPU Fleet",
    rootPath: "/home/zen/hermes-agent",
    kind: "git",
    category: "infrastructure",
    description:
      "Autonomous AI agent runtime, Modal serverless GPU fleet monitor, SQLite persistent task memory, and skill generator.",
    qualityGates: {
      testCommand: "cd /home/zen/hermes-agent && pytest tests/ -v",
    },
    healthChecks: [
      {
        id: "hermes_agent_check",
        command: "test -f /home/zen/hermes-agent/scripts/modal_fleet_monitor.py",
        timeoutSeconds: 15,
      },
    ],
  },
  {
    id: "youtube_publishing",
    displayName: "YouTube Content Factory & VieNeu TTS",
    rootPath: "/home/zen/hermes-agent",
    kind: "git",
    category: "content",
    description:
      "Content production pipeline across 4 channels (ZENPHAM, BIẾT ĐỊA LÝ TỪ BA TÔI, TÔI ĐỌC SÁCH, REALITY DECODE) with Manim cinema and neural TTS.",
    qualityGates: {
      councilGateCommand:
        "cd /home/zen/hermes-agent && .venv/bin/pytest tests/test_council_integrity_gate.py -v",
    },
    healthChecks: [
      {
        id: "youtube_brand_kit_check",
        command: "test -d /home/zen/hermes-agent/assets/brand/zenpham-brand-kit",
        timeoutSeconds: 15,
      },
    ],
  },
  {
    id: "nine_router",
    displayName: "9Router Internet & Model Gateway",
    rootPath: "/home/zen/.9router",
    kind: "non_git",
    category: "infrastructure",
    description:
      "High-performance model gateway, multi-model catalog on port 20128, and reverse proxy multiplexer.",
    qualityGates: {},
    healthChecks: [
      {
        id: "9router_catalog_check",
        command: "test -f /home/zen/.9router/model-catalog.json",
        timeoutSeconds: 15,
      },
    ],
  },
  {
    id: "zencode_core",
    displayName: "Zencode Sovereign IDE & Swarm Engine",
    rootPath: "/home/zen/zencode/paseo",
    kind: "git",
    category: "platform",
    description:
      "Zencode unified core repository, 19-plugin matrix, 15-node fleet coordinator, Dual-ONNX intelligence, and sovereign app runtime.",
    qualityGates: {
      testCommand: "npx vitest run packages/server/src/server/projects/",
    },
    healthChecks: [
      {
        id: "zencode_core_integrity",
        command:
          "test -f /home/zen/zencode/paseo/package.json && test -d /home/zen/zencode/paseo/packages/server",
        timeoutSeconds: 15,
      },
    ],
  },
];

export class ZencodeProjectMigrationService {
  private readonly logger?: Logger;
  private readonly statusMap = new Map<string, MigratedProjectStatus>();

  constructor(options?: { logger?: Logger }) {
    this.logger = options?.logger;
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    for (const def of MANAGED_PROJECTS) {
      const exists = existsSync(def.rootPath);
      this.statusMap.set(def.id, {
        ...def,
        exists,
        healthStatus: exists ? "HEALTHY" : "OFFLINE",
        lastHealthCheck: Date.now(),
      });
    }
  }

  public async getProjects(): Promise<MigratedProjectStatus[]> {
    const list = Array.from(this.statusMap.values());

    for (const item of list) {
      if (item.exists) {
        if (!item.gitBranch && item.kind === "git") {
          try {
            const { stdout } = await execAsync("git branch --show-current", {
              cwd: item.rootPath,
              timeout: 2000,
            });
            item.gitBranch = stdout.trim() || "HEAD";
          } catch {
            item.gitBranch = "detached";
          }
        }
      }
    }

    return list;
  }

  public async checkHealth(projectId: string): Promise<MigratedProjectStatus> {
    const item = this.statusMap.get(projectId);
    if (!item) {
      throw new Error(`Project ${projectId} not found in managed registry`);
    }

    if (!existsSync(item.rootPath)) {
      item.exists = false;
      item.healthStatus = "OFFLINE";
      item.lastHealthCheck = Date.now();
      item.lastHealthOutput = "Root path does not exist on disk";
      return item;
    }

    item.exists = true;

    for (const check of item.healthChecks) {
      try {
        const { stdout } = await execAsync(check.command, {
          timeout: check.timeoutSeconds * 1000,
        });
        item.healthStatus = "HEALTHY";
        item.lastHealthCheck = Date.now();
        item.lastHealthOutput = stdout.trim() || "OK";
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        item.healthStatus = "DEGRADED";
        item.lastHealthCheck = Date.now();
        item.lastHealthOutput = `Health check failed: ${message}`;
        this.logger?.warn({ projectId, checkId: check.id, err }, "Project health check degraded");
        return item;
      }
    }

    return item;
  }

  public async checkAllHealth(): Promise<MigratedProjectStatus[]> {
    const ids = Array.from(this.statusMap.keys());
    await Promise.all(ids.map((id) => this.checkHealth(id).catch(() => null)));
    return this.getProjects();
  }

  public async runQualityGate(projectId: string): Promise<{ success: boolean; output: string }> {
    const item = this.statusMap.get(projectId);
    if (!item) {
      throw new Error(`Project ${projectId} not found in managed registry`);
    }

    const command = item.qualityGates.testCommand || item.qualityGates.smokeCommand;
    if (!command) {
      return { success: true, output: "No test command configured for this project." };
    }

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 60000 });
      return { success: true, output: stdout || stderr };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: message };
    }
  }

  public async syncToZencodeRegistries(): Promise<{
    syncedProjectsCount: number;
    targetPaths: string[];
  }> {
    const home = homedir();
    const targets = [
      join(home, ".paseo", "projects"),
      join(home, ".zencode", "projects"),
      join(process.cwd(), ".dev", "paseo-home", "projects"),
    ];

    const projectsToPersist = MANAGED_PROJECTS.map((p, idx) => ({
      projectId: `prj_zencode_${p.id}`,
      rootPath: p.rootPath,
      kind: p.kind,
      displayName: p.displayName,
      projectKey: p.gitRemote ? `remote:${p.gitRemote}` : `local:${p.id}`,
      customName: null,
      customIconRevision: null,
      createdAt: new Date(Date.now() - (MANAGED_PROJECTS.length - idx) * 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    }));

    const workspacesToPersist = MANAGED_PROJECTS.map((p) => ({
      workspaceId: `wks_zencode_${p.id}`,
      projectId: `prj_zencode_${p.id}`,
      cwd: p.rootPath,
      kind: p.kind === "git" ? ("local_checkout" as const) : ("directory" as const),
      displayName: p.displayName,
      title: p.displayName,
      branch: p.kind === "git" ? "main" : null,
      worktreeRoot: null,
      baseBranch: null,
      isPaseoOwnedWorktree: false,
      mainRepoRoot: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      autoArchivedChangeRequestUrl: null,
      pinnedAt: null,
    }));

    const syncedPaths: string[] = [];

    for (const dir of targets) {
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const prjPath = join(dir, "projects.json");
        const wspPath = join(dir, "workspaces.json");

        writeFileSync(prjPath, JSON.stringify(projectsToPersist, null, 2), "utf-8");
        writeFileSync(wspPath, JSON.stringify(workspacesToPersist, null, 2), "utf-8");
        syncedPaths.push(prjPath, wspPath);
      } catch (err) {
        this.logger?.warn({ dir, err }, "Could not sync to target projects directory");
      }
    }

    return {
      syncedProjectsCount: projectsToPersist.length,
      targetPaths: syncedPaths,
    };
  }
}

let migrationServiceInstance: ZencodeProjectMigrationService | null = null;

export function getZencodeProjectMigrationService(options?: {
  logger?: Logger;
}): ZencodeProjectMigrationService {
  if (!migrationServiceInstance) {
    migrationServiceInstance = new ZencodeProjectMigrationService(options);
  }
  return migrationServiceInstance;
}
