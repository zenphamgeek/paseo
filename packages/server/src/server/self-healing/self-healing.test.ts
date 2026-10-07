import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { CircuitBreaker } from "./circuit-breaker.js";
import { GitFixDispatcher } from "./git-fix-dispatcher.js";
import { SelfHealingSupervisor } from "./self-healing-supervisor.js";

describe("Self-Healing Circuit Breaker", () => {
  it("isolates broken hook after 2 consecutive failures to prevent agent deadlock", () => {
    const cb = new CircuitBreaker({ threshold: 2 });
    const hookKey = "jsonhook__db-target-guard_PreToolUse_0_0";

    expect(cb.isIsolated(hookKey)).toBe(false);

    // 1st failure
    const res1 = cb.recordFailure(hookKey);
    expect(res1.isTripped).toBe(false);
    expect(cb.isIsolated(hookKey)).toBe(false);

    // 2nd failure -> Tripped & Isolated
    const res2 = cb.recordFailure(hookKey);
    expect(res2.isTripped).toBe(true);
    expect(res2.isolated).toBe(true);
    expect(cb.isIsolated(hookKey)).toBe(true);

    const status = cb.getStatus();
    expect(status.isTripped).toBe(true);
    expect(status.isolatedHooks).toContain(hookKey);
    expect(status.failureCounts[hookKey]).toBe(2);

    // Reset allows hook to recover
    cb.reset(hookKey);
    expect(cb.isIsolated(hookKey)).toBe(false);
  });
});

describe("GitFixDispatcher & SelfHealingSupervisor", () => {
  it("analyzes hook path error from stderr and synthesizes fix proposal", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "self-heal-test-"));
    const agentsDir = path.join(tempDir, ".agents", "hooks", "scripts");
    await fs.mkdir(agentsDir, { recursive: true });

    // Create the target script at its real location
    const targetScript = path.join(agentsDir, "check_db_target.py");
    await fs.writeFile(targetScript, "# test script", "utf8");

    // Create buggy .agents/hooks.json pointing to wrong relative path
    const hooksJson = path.join(tempDir, ".agents", "hooks.json");
    await fs.writeFile(
      hooksJson,
      JSON.stringify({
        "db-target-guard": {
          PreToolUse: [{ hooks: [{ command: "python3 hooks/scripts/check_db_target.py" }] }],
        },
      }),
      "utf8",
    );

    const supervisor = new SelfHealingSupervisor({
      storageDir: tempDir,
      defaultWorkspaceDir: tempDir,
    });

    // Report the exact incident from the user screenshot
    const incident = await supervisor.reportIncident({
      source: "hook",
      hookName: "jsonhook__db-target-guard_PreToolUse_0_0",
      exitCode: 2,
      stderr:
        "/usr/bin/python3: can't open file 'hooks/scripts/check_db_target.py': [Errno 2] No such file or directory",
      command: "python3 hooks/scripts/check_db_target.py",
      workspaceDir: tempDir,
    });

    expect(incident.id).toContain("inc_");
    expect(incident.sha).toBeDefined();

    // Propose automated fix
    const fix = await supervisor.proposeFix(incident.id);
    expect(fix.patchFiles).toHaveLength(1);
    expect(fix.patchFiles[0].path).toBe(".agents/hooks.json");
    expect(fix.patchFiles[0].newContent).toContain(".agents/hooks/scripts/check_db_target.py");
    expect(fix.suggestedCommitMessage).toContain("fix(agent-hooks)");
    expect(fix.verificationSteps.length).toBeGreaterThan(0);

    // Verify dispatcher PR description generation
    const dispatcher = new GitFixDispatcher();
    const branchName = `zencode/fix_${incident.sha}`;
    const prBody = dispatcher.generatePrDescription(incident, fix, branchName);

    expect(prBody).toContain(branchName);
    expect(prBody).toContain("git checkout " + branchName);
    expect(prBody).toContain("git merge " + branchName);
  });

  it("autonomousHeal: executes tests, auto-merges on pass, and updates incident status to auto_merged", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "self-heal-automerge-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@zencode.ai"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Zencode Agent"], { cwd: tempDir });

    const agentsDir = path.join(tempDir, ".agents", "hooks", "scripts");
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(path.join(agentsDir, "check_db_target.py"), "# target", "utf8");

    const hooksJson = path.join(tempDir, ".agents", "hooks.json");
    await fs.writeFile(
      hooksJson,
      JSON.stringify({
        guard: {
          PreToolUse: [{ hooks: [{ command: "python3 hooks/scripts/check_db_target.py" }] }],
        },
      }),
      "utf8",
    );

    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: tempDir });

    const supervisor = new SelfHealingSupervisor({
      storageDir: tempDir,
      defaultWorkspaceDir: tempDir,
    });
    const incident = await supervisor.reportIncident({
      source: "hook",
      hookName: "jsonhook__guard_0",
      stderr: "can't open file 'hooks/scripts/check_db_target.py'",
      workspaceDir: tempDir,
    });

    // Run autonomous heal with a passing test command
    const res = await supervisor.autonomousHeal(incident.id, {
      testCommand: "node -e 'process.exit(0)'",
      targetBranch: "main",
      autoMerge: true,
    });

    expect(res.success).toBe(true);
    expect(res.testPassed).toBe(true);
    expect(res.merged).toBe(true);
    expect(res.reverted).toBe(false);
    expect(res.mergeCommitSha).toBeDefined();

    const updatedIncident = supervisor.getIncident(incident.id);
    expect(updatedIncident?.status).toBe("auto_merged");

    // Verify hooks.json in main was actually updated
    const finalHooks = await fs.readFile(hooksJson, "utf8");
    expect(finalHooks).toContain(".agents/hooks/scripts/check_db_target.py");
  });

  it("autonomousHeal: executes tests, auto-reverts on failure, and leaves workspace pristine", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "self-heal-autorevert-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@zencode.ai"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Zencode Agent"], { cwd: tempDir });

    const testFile = path.join(tempDir, "sample.txt");
    await fs.writeFile(testFile, "original content", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: tempDir });

    const { stdout: initialSha } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: tempDir,
    });

    const supervisor = new SelfHealingSupervisor({
      storageDir: tempDir,
      defaultWorkspaceDir: tempDir,
    });
    const incident = await supervisor.reportIncident({
      source: "tool",
      toolName: "broken_tool",
      stderr: "SyntaxError: Unexpected token in broken_tool",
      workspaceDir: tempDir,
    });

    // Manually specify a mock proposed fix that modifies sample.txt
    incident.proposedFix = {
      summary: "Bad fix that fails verification",
      rootCause: "Mock bug",
      patchFiles: [
        {
          path: "sample.txt",
          newContent: "bad corrupted content",
          diff: "- original\n+ bad",
        },
      ],
      suggestedCommitMessage: "fix(mock): bad fix",
      verificationSteps: ["node -e 'process.exit(1)'"],
      createdAt: Date.now(),
    };

    // Run autonomous heal with a FAILING test command
    const res = await supervisor.autonomousHeal(incident.id, {
      testCommand: "node -e 'console.error(\"Mock test suite failed!\"); process.exit(1)'",
      targetBranch: "main",
      autoMerge: true,
    });

    expect(res.success).toBe(false);
    expect(res.testPassed).toBe(false);
    expect(res.merged).toBe(false);
    expect(res.reverted).toBe(true);
    expect(res.error).toContain("Verification tests failed");

    const updatedIncident = supervisor.getIncident(incident.id);
    expect(updatedIncident?.status).toBe("reverted");

    // Verify workspace was completely restored to original SHA with no dirty files
    const { stdout: currentSha } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: tempDir,
    });
    expect(currentSha.trim()).toBe(initialSha.trim());

    const content = await fs.readFile(testFile, "utf8");
    expect(content).toBe("original content");

    // Verify fix branch was deleted
    const { stdout: branches } = await execFileAsync("git", ["branch"], { cwd: tempDir });
    expect(branches).not.toContain(res.branchName);
  });
});
