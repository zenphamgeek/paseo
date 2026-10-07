import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { ZencodeDatabase, TOKENS_PER_Z_CREDIT } from "../db/database.js";
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
} from "../bootstrap.js";

describe("Milestone M2 Empirical Adversarial Stress & Verification Harness", () => {
  const testDir = join("/tmp", `m2_stress_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const dbPath = join(testDir, "test_m2_stress.db");
  let db: ZencodeDatabase;
  let ledger: UserKeyLedger;
  let app: express.Application;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    db = new ZencodeDatabase({ dbPath });
    ledger = new UserKeyLedger({ storageDir: testDir });
    clearAllUserAgentRuns();

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

    // Modal GPU lockout guard
    app.use("/api/fleet/modal", (req, res, next) => {
      const user = resolveUser(req);
      const userTier = user ? user.tier : "free";
      const gate = assertFreeTierGating({ userTier, isModalGpuRequest: true });
      if (!gate.allowed) {
        return res.status(gate.status).json(gate.body);
      }
      next();
    });

    app.get("/api/fleet/modal/summary", (_req, res) => {
      res.json({ success: true, summary: { activeWorkers: 1 } });
    });

    // Fleet dispatch endpoint (matching bootstrap.ts production implementation)
    app.post("/api/fleet/dispatch", (req, res) => {
      const { prompt, model, tier = "pro", tokensEstimate } = req.body || {};
      const user = resolveUser(req);
      const userTier = user ? user.tier : "free";
      const userId = user ? user.id : req.body?.userId || "anon_free";

      const targetModel = model || (tier === "ultra" ? "claude-opus-5-5" : undefined);
      const modelGate = assertFreeTierGating({ userTier, requestedModel: targetModel });
      if (!modelGate.allowed) {
        return res.status(modelGate.status).json(modelGate.body);
      }

      const activeCount = getActiveUserAgentCount(userId);
      const concurrencyGate = assertFreeTierGating({ userTier, activeAgentsCount: activeCount });
      if (!concurrencyGate.allowed) {
        return res.status(concurrencyGate.status).json(concurrencyGate.body);
      }

      const chosenModel = targetModel || "codex";
      const chosenModelGate = assertFreeTierGating({ userTier, requestedModel: chosenModel });
      if (!chosenModelGate.allowed) {
        return res.status(chosenModelGate.status).json(chosenModelGate.body);
      }

      const estimatedTokens =
        typeof tokensEstimate === "number" && tokensEstimate > 0
          ? tokensEstimate
          : Math.floor((prompt?.length || 100) / 4) + 150;
      const modelMultiplier = resolveModelMultiplier(chosenModel);
      const requiredCredits = Number(
        ((estimatedTokens * modelMultiplier) / TOKENS_PER_Z_CREDIT).toFixed(4),
      );
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
          job: { id: jobId, model: chosenModel, tokensUsed },
          output: "Execution simulated successfully",
          deduction,
        });
      } finally {
        if (user) {
          releaseUserCreditReservation(user.id, jobId);
        }
        recordUserAgentEnd(userId, jobId);
      }
    });

    // Agent spawn endpoint
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

      const agentId =
        req.body?.agentId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      recordUserAgentStart(userId, agentId);

      res.json({
        success: true,
        agentId,
        activeRunningCount: getActiveUserAgentCount(userId),
      });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    clearAllUserAgentRuns();
    ledger.destroy();
    db.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const apiRequest = async (path: string, options: any = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
  };

  // =========================================================================
  // 1. EXACT CREDIT MATH & FRACTIONAL ROUNDING ACCURACY
  // =========================================================================
  describe("1. Exact Credit Math & Fractional Rounding Accuracy", () => {
    it("deducts exactly 1.0 credit for 2,500 tokens of Codex (1.0x base multiplier)", () => {
      const userRes = ledger.createUser({ username: "codex_math_user", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      expect(TOKENS_PER_Z_CREDIT).toBe(2500);

      const res = db.deductCreditsForTokens({
        userId,
        model: "codex",
        tokenCount: 2500,
      });

      expect(res.success).toBe(true);
      expect(res.chargedCredits).toBe(1.0);
      expect(res.remainingBalance).toBe(199.0);

      const current = db.getUserCredits(userId);
      expect(current.balance).toBe(199.0);
      expect(current.totalConsumed).toBe(1.0);
    });

    it("deducts exactly 2.0 credits for 5,000 tokens of Flash (1.0x base multiplier)", () => {
      const userRes = ledger.createUser({ username: "flash_math_user", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      const res = db.deductCreditsForTokens({
        userId,
        model: "gemini-2.5-flash",
        tokenCount: 5000,
      });

      expect(res.success).toBe(true);
      expect(res.chargedCredits).toBe(2.0);
      expect(res.remainingBalance).toBe(198.0);

      const current = db.getUserCredits(userId);
      expect(current.balance).toBe(198.0);
      expect(current.totalConsumed).toBe(2.0);
    });

    it("rounds fractional tokens to exactly 4 decimal places accurately", () => {
      const userRes = ledger.createUser({ username: "fractional_math_user", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // 1 token of Codex (1.0x): 1 / 2500 = 0.0004
      const res1 = db.deductCreditsForTokens({
        userId,
        model: "codex",
        tokenCount: 1,
      });
      expect(res1.success).toBe(true);
      expect(res1.chargedCredits).toBe(0.0004);

      // 3 tokens of Codex (1.0x): 3 / 2500 = 0.0012
      const res2 = db.deductCreditsForTokens({
        userId,
        model: "codex",
        tokenCount: 3,
      });
      expect(res2.success).toBe(true);
      expect(res2.chargedCredits).toBe(0.0012);

      // 1 token of Haiku (3.0x): 3 / 2500 = 0.0012
      const res3 = db.deductCreditsForTokens({
        userId,
        model: "claude-3.5-haiku",
        tokenCount: 1,
      });
      expect(res3.success).toBe(true);
      expect(res3.chargedCredits).toBe(0.0012);

      // 7 tokens of Pro (5.0x): 35 / 2500 = 0.014
      const res4 = db.deductCreditsForTokens({
        userId,
        model: "gemini-2.5-pro",
        tokenCount: 7,
      });
      expect(res4.success).toBe(true);
      expect(res4.chargedCredits).toBe(0.014);

      // 1 token of Sonnet (12.0x): 12 / 2500 = 0.0048
      const res5 = db.deductCreditsForTokens({
        userId,
        model: "claude-sonnet-4.6",
        tokenCount: 1,
      });
      expect(res5.success).toBe(true);
      expect(res5.chargedCredits).toBe(0.0048);

      // 1 token with custom multiplier 7: 7 / 2500 = 0.0028
      const res6 = db.deductCreditsForTokens({
        userId,
        model: "custom",
        tokenCount: 1,
        multiplier: 7,
      });
      expect(res6.success).toBe(true);
      expect(res6.chargedCredits).toBe(0.0028);

      const decimals = res6.chargedCredits.toString().split(".")[1] || "";
      expect(decimals.length).toBeLessThanOrEqual(4);
    });

    it("depletes exactly 200.0 credits for 500,000 base tokens (monthly limit)", () => {
      const userRes = ledger.createUser({ username: "full_month_user", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      const res = db.deductCreditsForTokens({
        userId,
        model: "codex",
        tokenCount: 500000,
      });
      expect(res.success).toBe(true);
      expect(res.chargedCredits).toBe(200.0);
      expect(res.remainingBalance).toBe(0.0);

      const current = db.getUserCredits(userId);
      expect(current.balance).toBe(0.0);
      expect(current.totalConsumed).toBe(200.0);
    });
  });

  // =========================================================================
  // 2. 0-CREDIT BALANCE EXHAUSTION REJECTION (HTTP 402 + VIETQR TOP-UP LINK)
  // =========================================================================
  describe("2. 0-Credit Balance Exhaustion & Rejection with VietQR Link", () => {
    it("reduces balance to 0 and rejects subsequent dispatch with HTTP 402 + /api/billing/create-order", async () => {
      const userRes = ledger.createUser({ username: "exhausted_dispatch_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Reduce balance to exactly 0
      const drain = db.deductCredits(userId, 200);
      expect(drain.success).toBe(true);
      expect(drain.newBalance).toBe(0);
      expect(db.getUserCredits(userId).balance).toBe(0);

      // Subsequent dispatch request MUST be rejected with HTTP 402
      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Generate backend service", model: "codex" },
      });

      expect(res.status).toBe(402);
      expect(res.body.error).toContain("Z-Credits exhausted");
      expect(res.body.createOrderUrl).toBe("/api/billing/create-order");
      expect(res.body.upgradeUrl).toBe("/#pricing");
      expect(res.body.balance).toBe(0);
    });

    it("reduces balance to 0 and rejects subsequent agent spawn with HTTP 402 + /api/billing/create-order", async () => {
      const userRes = ledger.createUser({ username: "exhausted_spawn_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Reduce balance to exactly 0
      db.deductCredits(userId, 200);
      expect(db.getUserCredits(userId).balance).toBe(0);

      // Subsequent agent spawn request MUST be rejected with HTTP 402
      const res = await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { model: "codex", agentId: "agent-exhausted" },
      });

      expect(res.status).toBe(402);
      expect(res.body.error).toContain("Z-Credits exhausted");
      expect(res.body.createOrderUrl).toBe("/api/billing/create-order");
      expect(res.body.upgradeUrl).toBe("/#pricing");
    });
  });

  // =========================================================================
  // 3. BOUNDARY TESTS (BALANCE 0.5 CREDITS REQUESTING 2,500 TOKENS / 1.0 CREDIT)
  // =========================================================================
  describe("3. Boundary Tests: Balance 0.5 Credits requesting 2,500 tokens (needs 1.0)", () => {
    it("Database layer: rejects deduction with INSUFFICIENT_CREDITS and preserves 0.5 balance", () => {
      const userRes = ledger.createUser({ username: "boundary_user", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Set user balance to exactly 0.5 credits (deduct 199.5 from 200)
      const drain = db.deductCredits(userId, 199.5);
      expect(drain.success).toBe(true);
      expect(drain.newBalance).toBe(0.5);
      expect(db.getUserCredits(userId).balance).toBe(0.5);

      // Request 2,500 tokens of Codex (needs exactly 1.0 credit)
      const deductRes = db.deductCreditsForTokens({
        userId,
        model: "codex",
        tokenCount: 2500,
      });

      // Must be rejected
      expect(deductRes.success).toBe(false);
      expect(deductRes.error).toBe("INSUFFICIENT_CREDITS");
      expect(deductRes.chargedCredits).toBe(1.0);
      expect(deductRes.remainingBalance).toBe(0.5);

      // Ensure balance in SQLite database is untouched and still 0.5
      const after = db.getUserCredits(userId);
      expect(after.balance).toBe(0.5);
      expect(after.totalConsumed).toBe(199.5);
    });

    it("HTTP boundary: Balance 0.5 credits requesting 2,500 tokens (needs 1.0) -> rejected with HTTP 402 INSUFFICIENT_CREDITS", async () => {
      const userRes = ledger.createUser({ username: "boundary_http_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Set user balance to 0.5 credits
      db.deductCredits(userId, 199.5);
      expect(db.getUserCredits(userId).balance).toBe(0.5);

      // Send dispatch request with tokensEstimate: 2500 (needs 1.0 credit)
      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Test task", model: "codex", tokensEstimate: 2500 },
      });

      // Prompt requirement: "Balance 0.5 credits requesting 2,500 tokens (needs 1.0) -> rejected with HTTP 402 INSUFFICIENT_CREDITS"
      // If server does not pre-validate token cost or reject failed deduction with 402, this assertion will catch it:
      expect(res.status).toBe(402);
      expect(JSON.stringify(res.body)).toContain("INSUFFICIENT_CREDITS");
    });
  });

  // =========================================================================
  // 4. CONCURRENCY & RACE CONDITIONS: ZERO NEGATIVE CREDIT BALANCES
  // =========================================================================
  describe("4. Concurrency & Race Conditions: Zero Negative Credit Balances", () => {
    it("Database layer: 50 concurrent deductions on 10.0 credits balance never results in negative balance", async () => {
      const userRes = ledger.createUser({ username: "race_db_user", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Set balance to exactly 10.0 credits
      db.deductCredits(userId, 190);
      expect(db.getUserCredits(userId).balance).toBe(10.0);

      // Launch 50 concurrent deduction attempts of 1.0 credit each (2,500 tokens each)
      const tasks = Array.from({ length: 50 }, (_, i) => {
        return new Promise<{ index: number; success: boolean; balance: number; error?: string }>(
          (resolve) => {
            setTimeout(
              () => {
                const res = db.deductCreditsForTokens({
                  userId,
                  model: "codex",
                  tokenCount: 2500, // 1.0 credit
                });
                resolve({
                  index: i,
                  success: res.success,
                  balance: res.remainingBalance,
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

      // Exactly 10 should succeed, 40 should fail with INSUFFICIENT_CREDITS
      expect(successes.length).toBe(10);
      expect(failures.length).toBe(40);
      for (const fail of failures) {
        expect(fail.error).toBe("INSUFFICIENT_CREDITS");
      }

      // Check final state in database: MUST BE EXACTLY 0.0, NEVER NEGATIVE
      const finalCredits = db.getUserCredits(userId);
      expect(finalCredits.balance).toBe(0.0);
      expect(finalCredits.balance).toBeGreaterThanOrEqual(0.0);
      expect(finalCredits.totalConsumed).toBe(200.0);
    });

    it("HTTP dispatch race: 20 simultaneous requests on 1.0 credit balance never produce negative balance", async () => {
      const userRes = ledger.createUser({ username: "race_http_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Set balance to exactly 1.0 credit
      db.deductCredits(userId, 199.0);
      expect(db.getUserCredits(userId).balance).toBe(1.0);

      // Fire 20 concurrent HTTP requests simultaneously, each consuming 1.0 credit (2500 tokens)
      const promises = Array.from({ length: 20 }, (_, i) => {
        return apiRequest("/api/fleet/dispatch", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { prompt: `Race task ${i}`, model: "codex", tokensEstimate: 2500 },
        });
      });

      const responses = await Promise.all(promises);

      // Invariant: Balance in database MUST NEVER be negative (< 0)
      const finalBal = db.getUserCredits(userId).balance;
      expect(finalBal).toBeGreaterThanOrEqual(0.0);

      // Check successful credit deductions across all responses
      const successfulDeductions = responses.filter(
        (r) => r.body?.deduction && r.body.deduction.success === true,
      );
      // At most 1 deduction could have succeeded since initial balance was 1.0
      expect(successfulDeductions.length).toBeLessThanOrEqual(1);
    });

    it("Floating point precision: dual-layer 4-decimal rounding eliminates IEEE-754 drift in SQLite REAL balance", () => {
      const userRes = ledger.createUser({ username: "drift_inspection_user", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Deduct 199.8 from 200.0
      db.deductCredits(userId, 199.8);
      const bal = db.getUserCredits(userId).balance;

      // With dual-layer 4-decimal rounding, balance is exactly 0.2
      expect(bal).toBe(0.2);
    });
  });
});
