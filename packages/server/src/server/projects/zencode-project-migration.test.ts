import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MANAGED_PROJECTS,
  ZencodeProjectMigrationService,
  getZencodeProjectMigrationService,
} from "./zencode-project-migration.js";

describe("ZencodeProjectMigrationService", () => {
  it("defines 7 core managed projects migrated from AGY Fleet", () => {
    expect(MANAGED_PROJECTS).toHaveLength(7);
    const ids = MANAGED_PROJECTS.map((p) => p.id);
    expect(ids).toContain("gray_doom");
    expect(ids).toContain("verticalrisk_grc");
    expect(ids).toContain("insilos_odoo");
    expect(ids).toContain("hermes_agent");
    expect(ids).toContain("youtube_publishing");
    expect(ids).toContain("nine_router");
    expect(ids).toContain("zencode_core");

    for (const project of MANAGED_PROJECTS) {
      expect(project.rootPath.length).toBeGreaterThan(0);
      expect(["git", "non_git"]).toContain(project.kind);
      expect(["development", "infrastructure", "content", "platform"]).toContain(project.category);
      expect(project.healthChecks.length).toBeGreaterThan(0);
    }
  });

  it("retrieves project statuses with real filesystem detection", async () => {
    const service = getZencodeProjectMigrationService();
    const projects = await service.getProjects();

    expect(projects).toHaveLength(7);
    const zencodeCore = projects.find((p) => p.id === "zencode_core");
    expect(zencodeCore).toBeDefined();
    expect(zencodeCore?.exists).toBe(true);
    expect(zencodeCore?.kind).toBe("git");

    const hermes = projects.find((p) => p.id === "hermes_agent");
    expect(hermes).toBeDefined();
    expect(hermes?.exists).toBe(true);
  });

  it("executes health check on local projects accurately", async () => {
    const service = new ZencodeProjectMigrationService();
    const result = await service.checkHealth("zencode_core");

    expect(result.id).toBe("zencode_core");
    expect(result.healthStatus).toBe("HEALTHY");
    expect(result.lastHealthCheck).toBeGreaterThan(0);
  });

  it("synchronizes all projects to Zencode/Paseo JSON registries", async () => {
    const service = new ZencodeProjectMigrationService();
    const syncRes = await service.syncToZencodeRegistries();

    expect(syncRes.syncedProjectsCount).toBe(7);
    expect(syncRes.targetPaths.length).toBeGreaterThan(0);

    for (const filePath of syncRes.targetPaths) {
      expect(existsSync(filePath)).toBe(true);
      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(7);
    }
  });
});
