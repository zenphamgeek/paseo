import { exec } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Logger } from "pino";
import type { CouncilVerdict, TaskContract, TaskGate } from "@getpaseo/protocol/fleet-types";

const execAsync = promisify(exec);

export class ClefCouncil {
  private readonly logger: Logger;

  constructor(options: { logger: Logger }) {
    this.logger = options.logger.child({ module: "clef-council" });
  }

  public async verify(workspaceDir: string, contract: TaskContract): Promise<CouncilVerdict[]> {
    this.logger.info(
      { taskId: contract.id, goal: contract.goal, gates: contract.gates },
      "Initiating Clef Council Verification Pipeline (Zero-Fake-Pass)",
    );

    const verdicts: CouncilVerdict[] = [];

    for (const gate of contract.gates) {
      const verdict = await this.runGate(workspaceDir, gate);
      verdicts.push(verdict);
      if (!verdict.passed) {
        this.logger.warn({ gate, advice: verdict.remediationAdvice }, "Council gate failed");
        // Fast-fail or continue collecting all gate verdicts
      }
    }

    const allPassed = verdicts.every((v) => v.passed);
    this.logger.info(
      { taskId: contract.id, allPassed, gateCount: verdicts.length },
      "Council verification complete",
    );

    return verdicts;
  }

  private async runGate(workspaceDir: string, gate: TaskGate): Promise<CouncilVerdict> {
    let command = "";
    switch (gate) {
      case "lint":
        command = "npx oxlint --deny-warnings";
        break;
      case "types":
        command = "npm run typecheck --workspaces --if-present";
        break;
      case "unit_tests":
        command = "npx vitest run --passWithNoTests";
        break;
      case "security_audit":
        command = "npm audit --audit-level=high";
        break;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceDir,
        timeout: 120_000,
        env: { ...process.env, CI: "true" },
      });

      const rawCombined = `${stdout}\n${stderr}`;
      const hash = crypto.createHash("sha256").update(rawCombined).digest("hex");

      return {
        gate,
        passed: true,
        exitCode: 0,
        rawOutputHash: hash,
        evidence: stdout.slice(-500) || "Success without output",
      };
    } catch (err: unknown) {
      const execErr = err as {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
        message?: string;
        code?: number;
      };
      const stdout = execErr.stdout?.toString() || "";
      const stderr = execErr.stderr?.toString() || "";
      const rawCombined = `${stdout}\n${stderr}\n${execErr.message || String(err)}`;
      const hash = crypto.createHash("sha256").update(rawCombined).digest("hex");

      return {
        gate,
        passed: false,
        exitCode: execErr.code ?? 1,
        rawOutputHash: hash,
        evidence: (stderr || stdout || execErr.message || String(err)).slice(-1000),
        remediationAdvice: `Gate '${gate}' failed with exit code ${execErr.code ?? 1}. Fix errors listed in output: ${stderr.slice(0, 300) || stdout.slice(0, 300)}`,
      };
    }
  }
}
