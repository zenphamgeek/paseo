import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { ZencodeDatabase, TOKENS_PER_Z_CREDIT, roundCreditPrecision } from "../db/database.js";
import { UserKeyLedger, resolveModelMultiplier } from "./user-key-ledger.js";
import {
  assertFreeTierGating,
  getActiveUserAgentCount,
  recordUserAgentStart,
  recordUserAgentEnd,
  clearAllUserAgentRuns,
  tryReserveUserCredits,
  releaseUserCreditReservation,
  clearAllCreditReservations,
  getActiveReservedCredits,
} from "../bootstrap.js";

describe("Challenger 2 Empirical Verification: M2 R2 Precision & Boundary Harness", () => {
  const testDir = join(
    "/tmp",
    `m2_challenger_empirical_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  );
  const dbPath = join(testDir, "challenger_empirical.db");
  let db: ZencodeDatabase;
  let ledger: UserKeyLedger;
  let app: express.Application;
  let server: http.Server;
  let baseUrl: string;

  let executionSpy: { remoteCalls: number; localSimulations: number };

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    db = new ZencodeDatabase({ dbPath });
    ledger = new UserKeyLedger({ storageDir: testDir });
    clearAllUserAgentRuns();
    clearAllCreditReservations();

    executionSpy = { remoteCalls: 0, localSimulations: 0 };

    app = express();
    app.use(express.json());

    const resolveUser = (req: express.Request) => {
      const auth = req.headers.authorization;
      if (auth && auth.startsWith("Bearer ")) {
        const token = auth.slice(7).trim();
        const user = ledger.findUserByToken(token);
        if (user) return user;
        const keyHash = UserKeyLedger.hashToken(token);
        const row = (db as any).db
          ?.prepare("SELECT id FROM users WHERE key_hash = ?")
          .get(keyHash) as { id: string } | undefined;
        if (row) return db.getUserById(row.id);
      }
      const userId = (req.query.userId as string) || (req.body?.userId as string);
      if (userId) {
        return db.getUserById(userId) || ledger.getUser(userId);
      }
      return null;
    };

    // Dispatch endpoint mirroring bootstrap.ts with execution spy
    app.post("/api/fleet/dispatch", (req, res) => {
      void (async () => {
        try {
          const { prompt, model, tier = "pro", tokensEstimate } = req.body || {};
          if (!prompt || typeof prompt !== "string") {
            res.status(400).json({ error: "Missing or invalid prompt" });
            return;
          }

          const user = resolveUser(req);
          const userTier = user ? user.tier : "free";
          const userId = user ? user.id : req.body?.userId || "anon_free";

          const targetModel = model || (tier === "ultra" ? "claude-opus-5-5" : undefined);
          const modelGate = assertFreeTierGating({ userTier, requestedModel: targetModel });
          if (!modelGate.allowed) {
            return res.status(modelGate.status).json(modelGate.body);
          }

          const activeCount = getActiveUserAgentCount(userId);
          const concurrencyGate = assertFreeTierGating({
            userTier,
            activeAgentsCount: activeCount,
          });
          if (!concurrencyGate.allowed) {
            return res.status(concurrencyGate.status).json(concurrencyGate.body);
          }

          const chosenModel = targetModel || "codex";
          const chosenModelGate = assertFreeTierGating({ userTier, requestedModel: chosenModel });
          if (!chosenModelGate.allowed) {
            return res.status(chosenModelGate.status).json(chosenModelGate.body);
          }

          // Pre-Flight Credit Balance & Required Tokens Calculation
          const estimatedTokens =
            typeof tokensEstimate === "number" && tokensEstimate > 0
              ? tokensEstimate
              : Math.floor(prompt.length / 4) + 150;
          const modelMultiplier = resolveModelMultiplier(chosenModel);
          const requiredCredits = Number(
            ((estimatedTokens * modelMultiplier) / TOKENS_PER_Z_CREDIT).toFixed(4),
          );
          const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          if (user) {
            const credits = db.getUserCredits(user.id);

            // 0-Credit Exhaustion Check
            if (credits.balance <= 0) {
              return res.status(402).json({
                error:
                  "Z-Credits exhausted. Free monthly quota reached (200 Z-Credits / 500,000 tokens). Please top up via VietQR SePay to continue.",
                balance: 0,
                upgradeUrl: "/#pricing",
                createOrderUrl: "/api/billing/create-order",
              });
            }

            // Insufficient Credits Pre-flight Check
            if (credits.balance < requiredCredits) {
              return res.status(402).json({
                error: "INSUFFICIENT_CREDITS",
                message: `Insufficient Z-Credits: required ${requiredCredits}, current balance ${credits.balance}. Please top up via VietQR SePay.`,
                createOrderUrl: "/api/billing/create-order",
                upgradeUrl: "/#pricing",
                requiredCredits,
                balance: credits.balance,
              });
            }

            // In-Flight Reservation Ledger
            const reservation = tryReserveUserCredits({
              userId: user.id,
              jobId,
              requiredCredits,
              model: chosenModel,
              currentBalance: credits.balance,
            });

            if (!reservation.success) {
              return res.status(402).json({
                error: "INSUFFICIENT_CREDITS",
                message: `Insufficient Z-Credits: required ${requiredCredits}, current balance ${credits.balance}. Please top up via VietQR SePay.`,
                createOrderUrl: "/api/billing/create-order",
                upgradeUrl: "/#pricing",
                requiredCredits,
                balance: reservation.availableBalance,
              });
            }
          }

          recordUserAgentStart(userId, jobId);

          try {
            // Execution block (tracked by spy)
            executionSpy.localSimulations++;

            const tokensUsed = estimatedTokens;
            let deduction: any = undefined;
            if (user) {
              deduction = db.deductCreditsForTokens({
                userId: user.id,
                model: chosenModel,
                tokenCount: tokensUsed,
              });
              ledger.recordModelUsage(user.id, chosenModel, tokensUsed);

              if (!deduction.success) {
                return res.status(402).json({
                  error: "INSUFFICIENT_CREDITS",
                  message: `Credit deduction failed: required ${deduction.chargedCredits}, remaining balance ${deduction.remainingBalance}. Please top up via VietQR SePay.`,
                  requiredCredits: deduction.chargedCredits,
                  balance: deduction.remainingBalance,
                  createOrderUrl: "/api/billing/create-order",
                  upgradeUrl: "/#pricing",
                });
              }
            }

            res.json({
              job: { id: jobId, model: chosenModel, tokensUsed, status: "completed" },
              output: `Execution output for ${jobId}`,
              creditDeduction: deduction,
            });
          } finally {
            if (user) {
              releaseUserCreditReservation(user.id, jobId);
            }
            recordUserAgentEnd(userId, jobId);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: message });
        }
      })();
    });

    // Agent Spawn endpoint mirroring bootstrap.ts
    app.post("/api/fleet/agents/spawn", (req, res) => {
      const user = resolveUser(req);
      const userTier = user ? user.tier : req.body?.tier || "free";
      const userId = user ? user.id : req.body?.userId || "anon_free";
      const requestedModel = req.body?.model;

      const modelGate = assertFreeTierGating({ userTier, requestedModel });
      if (!modelGate.allowed) {
        return res.status(modelGate.status).json(modelGate.body);
      }

      const activeCount = getActiveUserAgentCount(userId);
      const concurrencyGate = assertFreeTierGating({ userTier, activeAgentsCount: activeCount });
      if (!concurrencyGate.allowed) {
        return res.status(concurrencyGate.status).json(concurrencyGate.body);
      }

      if (user) {
        const credits = db.getUserCredits(user.id);
        if (credits.balance <= 0) {
          return res.status(402).json({
            error:
              "Z-Credits exhausted. Free monthly quota reached (200 Z-Credits / 500,000 tokens). Please top up via VietQR SePay to continue.",
            balance: 0,
            upgradeUrl: "/#pricing",
            createOrderUrl: "/api/billing/create-order",
          });
        }

        const tokensEstimate = req.body?.tokensEstimate;
        if (typeof tokensEstimate === "number" && tokensEstimate > 0) {
          const modelToUse = requestedModel || "codex";
          const requiredCredits = Number(
            ((tokensEstimate * resolveModelMultiplier(modelToUse)) / TOKENS_PER_Z_CREDIT).toFixed(
              4,
            ),
          );
          if (credits.balance < requiredCredits) {
            return res.status(402).json({
              error: "INSUFFICIENT_CREDITS",
              message: `Insufficient Z-Credits: required ${requiredCredits}, current balance ${credits.balance}. Please top up via VietQR SePay.`,
              createOrderUrl: "/api/billing/create-order",
              upgradeUrl: "/#pricing",
              requiredCredits,
              balance: credits.balance,
            });
          }
        }
      }

      const agentId = req.body?.agentId || `agent-${Date.now()}`;
      recordUserAgentStart(userId, agentId);

      res.json({
        success: true,
        agentId,
        tier: userTier,
        activeRunningCount: getActiveUserAgentCount(userId),
      });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(testDir, { recursive: true, force: true });
  });

  async function apiRequest(
    path: string,
    options: { method: string; headers?: Record<string, string>; body?: any },
  ) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const status = res.status;
    const json = await res.json().catch(() => ({}));
    return { status, body: json };
  }

  // =========================================================================
  // 1. RE-VERIFY CHALLENGER 2 PREVIOUSLY FAILED TEST & ZERO LEAKED COMPUTE
  // =========================================================================
  describe("1. Re-verify Challenger 2 previously failed test & Zero Leaked Compute", () => {
    it("Balance 0.5 credits requesting 2,500 tokens (needs 1.0 credit) -> MUST reject with HTTP 402 INSUFFICIENT_CREDITS", async () => {
      const userRes = ledger.createUser({ username: "challenger_boundary_05", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Set user balance to exactly 0.5 credits
      const drain = db.deductCredits(userId, 199.5);
      expect(drain.success).toBe(true);
      expect(drain.newBalance).toBe(0.5);
      expect(db.getUserCredits(userId).balance).toBe(0.5);

      // Request 2,500 tokens of Codex (needs 1.0 credit)
      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Implement microservice", model: "codex", tokensEstimate: 2500 },
      });

      // 1. MUST reject with HTTP 402
      expect(res.status).toBe(402);
      expect(res.body.error).toBe("INSUFFICIENT_CREDITS");
      expect(res.body.requiredCredits).toBe(1.0);
      expect(res.body.balance).toBe(0.5);
      expect(res.body.createOrderUrl).toBe("/api/billing/create-order");
      expect(res.body.upgradeUrl).toBe("/#pricing");

      // 2. Verify NO remote execution or simulation is leaked for free
      expect(executionSpy.localSimulations).toBe(0);
      expect(res.body.output).toBeUndefined();
      expect(res.body.job).toBeUndefined();

      // 3. Verify database balance remains 0.5 without deduction
      const creditsAfter = db.getUserCredits(userId);
      expect(creditsAfter.balance).toBe(0.5);
      expect(creditsAfter.totalConsumed).toBe(199.5);
    });

    it("Implicit token calculation: prompt length 10,000 chars (2650 tokens = 1.06 credits) on 0.5 balance rejects with 402", async () => {
      const userRes = ledger.createUser({ username: "challenger_long_prompt", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      db.deductCredits(userId, 199.5);
      expect(db.getUserCredits(userId).balance).toBe(0.5);

      const longPrompt = "X".repeat(10000);
      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: longPrompt, model: "codex" },
      });

      expect(res.status).toBe(402);
      expect(res.body.error).toBe("INSUFFICIENT_CREDITS");
      expect(res.body.requiredCredits).toBe(1.06);
      expect(executionSpy.localSimulations).toBe(0);
      expect(db.getUserCredits(userId).balance).toBe(0.5);
    });

    it("Exact boundary verification: balance 0.5 requesting exactly 1250 tokens (0.5 credits) succeeds, but 1251 tokens (0.5004 credits) rejects", async () => {
      const userRes = ledger.createUser({ username: "challenger_exact_boundary", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      db.deductCredits(userId, 199.5);
      expect(db.getUserCredits(userId).balance).toBe(0.5);

      // 1251 tokens requires (1251 / 2500) = 0.5004 credits > 0.5 balance -> must be rejected
      const resReject = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Edge check", model: "codex", tokensEstimate: 1251 },
      });
      expect(resReject.status).toBe(402);
      expect(resReject.body.error).toBe("INSUFFICIENT_CREDITS");
      expect(resReject.body.requiredCredits).toBe(0.5004);
      expect(executionSpy.localSimulations).toBe(0);

      // 1250 tokens requires exactly 0.5 credits == 0.5 balance -> must succeed!
      const resSuccess = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Exact check", model: "codex", tokensEstimate: 1250 },
      });
      expect(resSuccess.status).toBe(200);
      expect(executionSpy.localSimulations).toBe(1);
      expect(db.getUserCredits(userId).balance).toBe(0.0);
    });

    it("Balance 0.0 exhaustion -> MUST reject with HTTP 402 and VietQR SePay top-up URL on dispatch and spawn", async () => {
      const userRes = ledger.createUser({ username: "challenger_zero_exhaustion", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Drain balance to 0.0
      db.deductCredits(userId, 200.0);
      expect(db.getUserCredits(userId).balance).toBe(0.0);

      // Dispatch endpoint check
      const resDispatch = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Quick test", model: "codex" },
      });
      expect(resDispatch.status).toBe(402);
      expect(resDispatch.body.error).toContain("Z-Credits exhausted");
      expect(resDispatch.body.createOrderUrl).toBe("/api/billing/create-order");
      expect(resDispatch.body.upgradeUrl).toBe("/#pricing");
      expect(resDispatch.body.balance).toBe(0);
      expect(executionSpy.localSimulations).toBe(0);

      // Agent spawn endpoint check
      const resSpawn = await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { model: "codex", agentId: "agent-exhaustion-check" },
      });
      expect(resSpawn.status).toBe(402);
      expect(resSpawn.body.error).toContain("Z-Credits exhausted");
      expect(resSpawn.body.createOrderUrl).toBe("/api/billing/create-order");
      expect(resSpawn.body.upgradeUrl).toBe("/#pricing");
      expect(resSpawn.body.balance).toBe(0);
    });
  });

  // =========================================================================
  // 2. SQLITE FLOATING-POINT PRECISION: 200.0 - 199.8 == 0.2 & 4-DECIMAL PRECISION
  // =========================================================================
  describe("2. SQLite Floating-Point Precision: 200.0 - 199.8 == 0.2 & 4-Decimal Invariants", () => {
    it("Verifies that 200.0 - 199.8 evaluates cleanly to 0.2 without binary drift in SQLite", () => {
      const userRes = ledger.createUser({ username: "challenger_float_drift", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      expect(db.getUserCredits(userId).balance).toBe(200.0);

      const deductRes = db.deductCredits(userId, 199.8);
      expect(deductRes.success).toBe(true);
      expect(deductRes.newBalance).toBe(0.2);

      // Direct SQL raw query check to verify database storage value
      const rawRow = (db as any).db
        .prepare("SELECT balance, total_consumed FROM user_credits WHERE user_id = ?")
        .get(userId) as any;
      expect(rawRow.balance).toBe(0.2);
      expect(rawRow.total_consumed).toBe(199.8);

      const entity = db.getUserCredits(userId);
      expect(entity.balance).toBe(0.2);
      expect(entity.totalConsumed).toBe(199.8);
    });

    it("Maintains exact 4-decimal precision across multiple sequential fractional operations", () => {
      const userRes = ledger.createUser({
        username: "challenger_sequential_fraction",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Perform 50 sequential deductions of 0.0001
      for (let i = 0; i < 50; i++) {
        const r = db.deductCredits(userId, 0.0001);
        expect(r.success).toBe(true);
      }
      // 200.0 - (50 * 0.0001) = 200.0 - 0.0050 = 199.995
      expect(db.getUserCredits(userId).balance).toBe(199.995);

      // Add 0.0012 credits
      const added = db.addCredits(userId, 0.0012);
      // 199.995 + 0.0012 = 199.9962
      expect(added.balance).toBe(199.9962);
      expect(db.getUserCredits(userId).balance).toBe(199.9962);

      // Deduct 1 token (0.0004 credits)
      const tokenDeduct = db.deductCreditsForTokens({
        userId,
        model: "codex",
        tokenCount: 1,
      });
      expect(tokenDeduct.success).toBe(true);
      expect(tokenDeduct.chargedCredits).toBe(0.0004);
      // 199.9962 - 0.0004 = 199.9958
      expect(tokenDeduct.remainingBalance).toBe(199.9958);
      expect(db.getUserCredits(userId).balance).toBe(199.9958);
    });

    it("Schema CHECK and SQLite triggers strictly block negative balance injection", () => {
      const userRes = ledger.createUser({ username: "challenger_trigger_guard", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Direct SQL update with negative balance must throw SQLite trigger abort
      expect(() => {
        (db as any).db
          .prepare("UPDATE user_credits SET balance = -0.5 WHERE user_id = ?")
          .run(userId);
      }).toThrow(/cannot be negative/);

      // Direct SQL insert with negative balance must throw SQLite trigger abort
      expect(() => {
        (db as any).db
          .prepare(
            "INSERT INTO user_credits (user_id, balance, total_deposited, total_consumed, updated_at) VALUES (?, -1.0, 0, 0, ?)",
          )
          .run("bad_user", Date.now());
      }).toThrow(/cannot be negative/);
    });
  });

  // =========================================================================
  // 3. CONCURRENCY RACE CHECKS: 50 DEDUCTIONS ON 10.0 CREDITS NEVER NEGATIVE
  // =========================================================================
  describe("3. Concurrency Race Checks: 50 Deductions on 10.0 Credits Never Negative", () => {
    it("50 concurrent deductions of 1.0 credit on 10.0 credits balance never result in negative balance", async () => {
      const userRes = ledger.createUser({ username: "challenger_race_50", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Set balance to exactly 10.0 credits
      db.deductCredits(userId, 190.0);
      expect(db.getUserCredits(userId).balance).toBe(10.0);

      // Launch 50 concurrent deductions of 1.0 credit each (2,500 tokens)
      const tasks = Array.from({ length: 50 }, (_, i) => {
        return new Promise<{ id: number; success: boolean; remaining: number; error?: string }>(
          (resolve) => {
            setTimeout(
              () => {
                const res = db.deductCreditsForTokens({
                  userId,
                  model: "codex",
                  tokenCount: 2500,
                });
                resolve({
                  id: i,
                  success: res.success,
                  remaining: res.remainingBalance,
                  error: res.error,
                });
              },
              Math.floor(Math.random() * 20),
            );
          },
        );
      });

      const results = await Promise.all(tasks);
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(10);
      expect(failures.length).toBe(40);
      for (const fail of failures) {
        expect(fail.error).toBe("INSUFFICIENT_CREDITS");
      }

      const finalState = db.getUserCredits(userId);
      expect(finalState.balance).toBe(0.0);
      expect(finalState.balance).toBeGreaterThanOrEqual(0.0);
      expect(finalState.totalConsumed).toBe(200.0);
    });

    it("Extreme concurrency: 100 concurrent workers with random variable credit amounts on 15.0 credits balance", async () => {
      const userRes = ledger.createUser({ username: "challenger_race_100_var", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      db.deductCredits(userId, 185.0);
      expect(db.getUserCredits(userId).balance).toBe(15.0);

      const amounts = [0.25, 0.5, 0.75, 1.0, 1.25, 2.0];
      const tasks = Array.from({ length: 100 }, (_, i) => {
        const amt = amounts[i % amounts.length];
        return new Promise<{ id: number; amt: number; success: boolean; remaining: number }>(
          (resolve) => {
            setTimeout(
              () => {
                const res = db.deductCredits(userId, amt);
                resolve({ id: i, amt, success: res.success, remaining: res.newBalance });
              },
              Math.floor(Math.random() * 30),
            );
          },
        );
      });

      const results = await Promise.all(tasks);
      const successes = results.filter((r) => r.success);
      const totalDeducted = roundCreditPrecision(successes.reduce((acc, r) => acc + r.amt, 0));

      const finalCredits = db.getUserCredits(userId);
      expect(finalCredits.balance).toBeGreaterThanOrEqual(0.0);
      expect(roundCreditPrecision(15.0 - totalDeducted)).toBe(finalCredits.balance);
    });

    it("HTTP dispatch concurrency race: in-flight reservation ledger guarantees at most 1 execution on 1.0 balance", async () => {
      const userRes = ledger.createUser({
        username: "challenger_http_race_in_flight",
        tier: "free",
      });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Set balance to 1.0 credit
      db.deductCredits(userId, 199.0);
      expect(db.getUserCredits(userId).balance).toBe(1.0);

      // 20 concurrent HTTP requests simultaneously, each requiring 1.0 credit (2500 tokens)
      const promises = Array.from({ length: 20 }, (_, i) => {
        return apiRequest("/api/fleet/dispatch", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { prompt: `Race task ${i}`, model: "codex", tokensEstimate: 2500 },
        });
      });

      const responses = await Promise.all(promises);
      const successes = responses.filter((r) => r.status === 200);
      const rejections = responses.filter((r) => r.status === 402);

      // At most 1 can succeed, at least 19 must be rejected with 402
      expect(successes.length).toBeLessThanOrEqual(1);
      expect(rejections.length).toBeGreaterThanOrEqual(19);

      // Invariant: Balance never negative
      const finalBal = db.getUserCredits(userId).balance;
      expect(finalBal).toBeGreaterThanOrEqual(0.0);

      // Invariant: All reservations released
      expect(getActiveReservedCredits(userId)).toBe(0);
    });
  });
});
