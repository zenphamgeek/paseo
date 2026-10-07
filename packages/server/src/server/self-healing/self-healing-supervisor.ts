import fs from "node:fs/promises";
import path from "node:path";
import { CircuitBreaker } from "./circuit-breaker.js";
import { GitFixDispatcher, type GitFixResult } from "./git-fix-dispatcher.js";
import type {
  AutonomousHealOptions,
  AutonomousHealResult,
  CircuitBreakerStatus,
  Incident,
  IncidentReportInput,
  ProposedFix,
} from "./types.js";

export interface SelfHealingSupervisorOptions {
  storageDir?: string;
  defaultWorkspaceDir?: string;
}

export class SelfHealingSupervisor {
  private readonly incidents: Map<string, Incident> = new Map();
  private readonly circuitBreaker: CircuitBreaker;
  private readonly gitFixDispatcher: GitFixDispatcher;
  private readonly storageFilePath: string;
  private readonly defaultWorkspaceDir: string;

  constructor(options: SelfHealingSupervisorOptions = {}) {
    this.circuitBreaker = new CircuitBreaker({ threshold: 2 });
    this.gitFixDispatcher = new GitFixDispatcher();
    const baseDir = options.storageDir ?? process.cwd();
    this.storageFilePath = path.join(baseDir, "self-healing-incidents.json");
    this.defaultWorkspaceDir = options.defaultWorkspaceDir ?? process.cwd();
    void this.loadPersistedIncidents();
  }

  public getCircuitBreakerStatus(): CircuitBreakerStatus {
    return this.circuitBreaker.getStatus();
  }

  public resetCircuitBreaker(key?: string): void {
    this.circuitBreaker.reset(key);
  }

  public isHookIsolated(hookName: string): boolean {
    return this.circuitBreaker.isIsolated(hookName);
  }

  public async reportIncident(input: IncidentReportInput): Promise<Incident> {
    const cwd = input.workspaceDir ?? this.defaultWorkspaceDir;
    const sha = await this.gitFixDispatcher.getGitHeadSha(cwd);
    const id = `inc_${Date.now()}_${sha}`;

    const hookKey = input.hookName || input.toolName || "default";
    const { isTripped, isolated } = this.circuitBreaker.recordFailure(hookKey);

    const status = isolated ? "isolated" : "detected";
    const incident: Incident = {
      id,
      sha,
      timestamp: Date.now(),
      source: input.source,
      severity: input.severity ?? (isTripped ? "critical" : "warning"),
      hookName: input.hookName,
      toolName: input.toolName,
      exitCode: input.exitCode,
      stderr: input.stderr,
      stdout: input.stdout,
      command: input.command,
      workspaceDir: cwd,
      status,
      metadata: input.metadata,
    };

    this.incidents.set(id, incident);
    await this.persistIncidents();

    return incident;
  }

  public getAllIncidents(): Incident[] {
    return Array.from(this.incidents.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  public getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  /**
   * Autonomous Fix Analyzer: Inspects failure patterns (e.g. hook path not found)
   * and synthesizes a robust code patch.
   */
  public async proposeFix(incidentId: string): Promise<ProposedFix> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const stderr = incident.stderr || "";
    const cwd = incident.workspaceDir;

    // Pattern 1: Missing file in hook command (e.g. can't open file 'hooks/scripts/check_db_target.py')
    const missingFileMatch = stderr.match(/can't open file ['"]([^'"]+)['"]/);
    if (missingFileMatch) {
      const referencedPath = missingFileMatch[1];
      const fileName = path.basename(referencedPath);

      // Check candidate locations under .agents or workspace
      const candidatePaths = [
        path.join(".agents", "hooks", "scripts", fileName),
        path.join(".agents", referencedPath),
        path.join("scripts", fileName),
      ];

      let resolvedRelPath = candidatePaths[0];
      for (const cand of candidatePaths) {
        try {
          await fs.access(path.join(cwd, cand));
          resolvedRelPath = cand;
          break;
        } catch {
          // continue checking
        }
      }

      // Check if .agents/hooks.json exists
      const hooksJsonPath = path.join(cwd, ".agents", "hooks.json");
      let oldHooksContent = "";
      try {
        oldHooksContent = await fs.readFile(hooksJsonPath, "utf8");
      } catch {
        // ignore
      }

      const newHooksContent = oldHooksContent.replace(
        new RegExp(referencedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        resolvedRelPath,
      );

      const fix: ProposedFix = {
        summary: `Fix incorrect script path '${referencedPath}' to '${resolvedRelPath}' in .agents/hooks.json`,
        rootCause: `PreToolUse hook script was invoked relative to root but located in '${resolvedRelPath}'. Python threw exit status 2, causing tool deadlock.`,
        patchFiles: [
          {
            path: ".agents/hooks.json",
            oldContent: oldHooksContent,
            newContent: newHooksContent || oldHooksContent,
            diff: `--- a/.agents/hooks.json\n+++ b/.agents/hooks.json\n@@ -1 +1 @@\n- ${referencedPath}\n+ ${resolvedRelPath}`,
          },
        ],
        suggestedCommitMessage: `fix(agent-hooks): correct script path to ${resolvedRelPath} [${incident.id}]`,
        verificationSteps: [
          `Verify file exists: test -f "${resolvedRelPath}"`,
          `Simulate hook execution: echo '{"toolCall":{"args":{"CommandLine":"pwd"}}}' | python3 "${resolvedRelPath}"`,
          `Check exit code is 0 with {"decision":"allow"}`,
        ],
        createdAt: Date.now(),
      };

      incident.proposedFix = fix;
      incident.status = "patch_proposed";
      await this.persistIncidents();
      return fix;
    }

    // Generic fallback fix proposal
    const fallbackFix: ProposedFix = {
      summary: `Diagnose and isolate error in ${incident.hookName || incident.toolName || "agent runtime"}`,
      rootCause: stderr.slice(0, 200) || "Unhandled execution error with non-zero exit code.",
      patchFiles: [],
      suggestedCommitMessage: `fix(self-healing): remediate ${incident.hookName || incident.source} [${incident.id}]`,
      verificationSteps: [
        "Run test suite and verify agent tool execution succeeds without throwing.",
      ],
      createdAt: Date.now(),
    };

    incident.proposedFix = fallbackFix;
    incident.status = "patch_proposed";
    await this.persistIncidents();
    return fallbackFix;
  }

  /**
   * Executes the full Self-Healing dispatch: creates branch `zencode/fix_{sha}`,
   * applies patch, commits, and optionally pushes to remote.
   */
  public async healAndCreateBranch(
    incidentId: string,
    pushToRemote = false,
  ): Promise<GitFixResult> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    let fix = incident.proposedFix;
    if (!fix) {
      fix = await this.proposeFix(incidentId);
    }

    const result = await this.gitFixDispatcher.createFixBranchAndCommit(incident, fix);
    incident.branchName = result.branchName;
    incident.status = "branch_created";

    if (pushToRemote && !result.error) {
      const pushRes = await this.gitFixDispatcher.pushFixBranch(
        incident.workspaceDir,
        result.branchName,
      );
      if (pushRes.success) {
        result.pushed = true;
        incident.status = "branch_pushed";
      } else {
        result.error = pushRes.error;
      }
    }

    await this.persistIncidents();
    return result;
  }

  /**
   * Autonomous Self-Healing Lifecycle with Automated Verification, Auto-Merge, and Auto-Revert.
   * 1. Creates fix branch & commits proposed patch.
   * 2. Runs verification testCommand (if provided).
   * 3. If tests pass (100%): auto-merges into targetBranch (or current branch).
   * 4. If tests fail: auto-reverts immediately to original SHA, prunes fix branch, leaves repo pristine.
   */
  public async autonomousHeal(
    incidentId: string,
    options: AutonomousHealOptions = {},
  ): Promise<AutonomousHealResult> {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    const cwd = incident.workspaceDir || this.defaultWorkspaceDir;
    const originalSha = await this.gitFixDispatcher.getGitHeadSha(cwd);
    const targetBranch =
      options.targetBranch || (await this.gitFixDispatcher.getCurrentBranch(cwd)) || "main";

    let fix = incident.proposedFix;
    if (!fix) {
      fix = await this.proposeFix(incidentId);
    }

    // 1. Create fix branch and commit
    const branchRes = await this.gitFixDispatcher.createFixBranchAndCommit(incident, fix);
    if (branchRes.error) {
      incident.status = "isolated";
      await this.persistIncidents();
      return {
        incidentId,
        success: false,
        branchName: branchRes.branchName,
        targetBranch,
        originalSha,
        testPassed: false,
        merged: false,
        reverted: true,
        error: branchRes.error,
      };
    }

    incident.branchName = branchRes.branchName;
    incident.status = "branch_created";

    // 2. Verification step
    let testPassed = true;
    let testOutput = "";

    if (options.testCommand) {
      incident.status = "verifying";
      await this.persistIncidents();

      const verifyRes = await this.gitFixDispatcher.runTestVerification(
        cwd,
        options.testCommand,
        options.timeoutMs ?? 60000,
      );
      testPassed = verifyRes.passed;
      testOutput = verifyRes.output;
    }

    // 3. Evaluation: Auto-Merge if Passed, Auto-Revert if Failed
    if (testPassed) {
      const shouldMerge = options.autoMerge !== false;
      let mergeCommitSha: string | undefined;

      if (shouldMerge) {
        const mergeRes = await this.gitFixDispatcher.autoMergeBranch(
          cwd,
          branchRes.branchName,
          targetBranch,
        );

        if (!mergeRes.success) {
          // Merge failed (conflict), auto-revert
          await this.gitFixDispatcher.autoRevertFix(
            cwd,
            branchRes.branchName,
            originalSha,
            targetBranch,
          );
          incident.status = "reverted";
          await this.persistIncidents();
          return {
            incidentId,
            success: false,
            branchName: branchRes.branchName,
            targetBranch,
            originalSha,
            testPassed: true,
            testOutput,
            merged: false,
            reverted: true,
            error: mergeRes.error,
          };
        }

        mergeCommitSha = mergeRes.mergeCommitSha;
        incident.status = "auto_merged";

        if (options.pushToRemote) {
          await this.gitFixDispatcher.pushFixBranch(cwd, targetBranch);
        }

        // Reset circuit breaker on successful heal
        const hookKey = incident.hookName || incident.toolName;
        if (hookKey) {
          this.circuitBreaker.reset(hookKey);
        }
      } else {
        incident.status = "branch_created";
      }

      await this.persistIncidents();
      return {
        incidentId,
        success: true,
        branchName: branchRes.branchName,
        targetBranch,
        originalSha,
        testPassed: true,
        testOutput,
        merged: shouldMerge,
        reverted: false,
        mergeCommitSha,
      };
    } else {
      // Test failed: Instant Transactional Auto-Revert
      await this.gitFixDispatcher.autoRevertFix(
        cwd,
        branchRes.branchName,
        originalSha,
        targetBranch,
      );
      incident.status = "reverted";

      // Trip or record failure
      const hookKey = incident.hookName || incident.toolName;
      if (hookKey) {
        this.circuitBreaker.recordFailure(hookKey);
      }

      await this.persistIncidents();
      return {
        incidentId,
        success: false,
        branchName: branchRes.branchName,
        targetBranch,
        originalSha,
        testPassed: false,
        testOutput,
        merged: false,
        reverted: true,
        error: `Verification tests failed (exit code non-zero). Fix was automatically reverted: ${testOutput.slice(0, 300)}`,
      };
    }
  }

  private async loadPersistedIncidents(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storageFilePath, "utf8");
      const list = JSON.parse(raw) as Incident[];
      for (const item of list) {
        this.incidents.set(item.id, item);
      }
    } catch {
      // file might not exist yet
    }
  }

  private async persistIncidents(): Promise<void> {
    try {
      const list = Array.from(this.incidents.values());
      await fs.writeFile(this.storageFilePath, JSON.stringify(list, null, 2), "utf8");
    } catch {
      // ignore write errors in transient tests
    }
  }
}
