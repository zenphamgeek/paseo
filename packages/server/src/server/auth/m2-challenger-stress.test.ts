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
  getActiveReservedCredits,
} from "../bootstrap.js";
import { AgentConfigSession } from "../session/agent-config/agent-config-session.js";

describe("Milestone M2 Empirical Challenger Stress Harness (teamwork_preview_challenger_m2_r2_1)", () => {
  const testDir = join(
    "/tmp",
    `m2_challenger_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  );
  const dbPath = join(testDir, "test_m2_challenger.db");
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
    clearAllCreditReservations();

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

    // Modal GPU lockout guard (identical to bootstrap.ts:1925)
    app.use("/api/fleet/modal", (req, res, next) => {
      const user = resolveUser(req);
      const userTier = user ? user.tier : "free";
      const gate = assertFreeTierGating({ userTier, isModalGpuRequest: true });
      if (!gate.allowed) {
        return res.status(gate.status).json(gate.body);
      }
      next();
    });

    // Register all Modal GPU endpoints matching bootstrap.ts
    const modalEndpoints = [
      { method: "get", path: "/api/fleet/modal/summary" },
      { method: "get", path: "/api/fleet/modal/profiles" },
      { method: "get", path: "/api/fleet/modal/workers" },
      { method: "get", path: "/api/fleet/modal/workloads" },
      { method: "post", path: "/api/fleet/modal/profile/switch" },
      { method: "post", path: "/api/fleet/modal/cli/exec" },
      { method: "get", path: "/api/fleet/modal/credits" },
      { method: "get", path: "/api/fleet/modal/recommendations" },
      { method: "post", path: "/api/fleet/modal/allocate" },
      { method: "get", path: "/api/fleet/modal/logs" },
      { method: "get", path: "/api/fleet/modal/logs/metrics" },
      { method: "post", path: "/api/fleet/modal/logs/retention" },
      { method: "get", path: "/api/fleet/modal/rebalance/recommendations" },
      { method: "post", path: "/api/fleet/modal/rebalance/apply" },
    ];
    for (const ep of modalEndpoints) {
      (app as any)[ep.method](ep.path, (_req: express.Request, res: express.Response) => {
        res.json({ success: true, endpoint: ep.path });
      });
    }

    // Fleet dispatch endpoint (matching bootstrap.ts with configurable simulated delay)
    app.post("/api/fleet/dispatch", (req, res) => {
      void (async () => {
        try {
          const {
            prompt,
            model,
            tier = "pro",
            tokensEstimate,
            simulatedDelayMs = 0,
          } = req.body || {};
          if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ error: "Missing or invalid prompt" });
          }

          const user = resolveUser(req);
          const userTier = user ? user.tier : "free";
          const userId = user ? user.id : req.body?.userId || "anonymous_free_user";

          // 1. Model lockout check
          const targetModel = model || (tier === "ultra" ? "claude-opus-5-5" : undefined);
          const modelGate = assertFreeTierGating({ userTier, requestedModel: targetModel });
          if (!modelGate.allowed) {
            return res.status(modelGate.status).json(modelGate.body);
          }

          // 2. Concurrency limit check
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

          // 3. Pre-flight credit calculation & in-flight reservation
          const estimatedTokens =
            typeof tokensEstimate === "number" && tokensEstimate > 0
              ? tokensEstimate
              : Math.floor(prompt.length / 4) + 150;
          const modelMultiplier = resolveModelMultiplier(chosenModel);
          const requiredCredits = Number(
            ((estimatedTokens * modelMultiplier) / TOKENS_PER_Z_CREDIT).toFixed(4),
          );
          const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
            // Simulate async inference latency
            if (simulatedDelayMs > 0) {
              await new Promise((r) => setTimeout(r, simulatedDelayMs));
            }

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
              output: "Simulated output",
              deduction,
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

    // Agent spawn endpoint
    app.post(["/api/fleet/agents/spawn", "/api/fleet/agents/run"], (req, res) => {
      try {
        const user = resolveUser(req);
        const userTier = user ? user.tier : req.body?.tier || "free";
        const userId = user ? user.id : req.body?.userId || "anonymous_free_user";
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    });

    app.post("/api/fleet/agents/stop", (req, res) => {
      const user = resolveUser(req);
      const userId = user ? user.id : req.body?.userId || "anonymous_free_user";
      const agentId = req.body?.agentId;
      if (agentId) {
        recordUserAgentEnd(userId, agentId);
      }
      res.json({ success: true, activeRunningCount: getActiveUserAgentCount(userId) });
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
    clearAllCreditReservations();
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
  // MISSION ITEM 1: CONCURRENCY LIMIT STRESS
  // =========================================================================
  describe("Mission Item 1: Concurrency Limit Stress Testing (Max 2 Parallel Agents)", () => {
    it("empirically verifies: Launch 2 parallel agent runs simultaneously -> must pass; launch 3rd run -> MUST reject with HTTP 429", async () => {
      const userRes = ledger.createUser({ username: "concurrency_challenger_user", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Launch 2 parallel long-running agent runs simultaneously with 250ms delay
      const run1Promise = apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Parallel Task 1", model: "codex", simulatedDelayMs: 250 },
      });

      const run2Promise = apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Parallel Task 2", model: "codex", simulatedDelayMs: 250 },
      });

      // Poll until both Run 1 and Run 2 are actively executing
      const pollStart = Date.now();
      while (getActiveUserAgentCount(userRes.user.id) < 2 && Date.now() - pollStart < 150) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // At this instant, both Run 1 and Run 2 are actively executing
      expect(getActiveUserAgentCount(userRes.user.id)).toBe(2);

      // Attempt to launch 3rd run while 2 are in-flight -> MUST BE REJECTED WITH HTTP 429!
      const run3Res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Parallel Task 3 (Unauthorized)", model: "codex" },
      });

      expect(run3Res.status).toBe(429);
      expect(run3Res.body).toEqual({
        error:
          "Free tier allows a maximum of 2 Specialist Agents running concurrently (Architect + Coder)",
        upgradeUrl: "/#pricing",
      });

      // Await completion of Run 1 and Run 2
      const [res1, res2] = await Promise.all([run1Promise, run2Promise]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // After both complete, active count drops back to 0
      expect(getActiveUserAgentCount(userRes.user.id)).toBe(0);

      // Now a subsequent run MUST pass
      const run4Res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Task 4 (Should pass)", model: "codex" },
      });
      expect(run4Res.status).toBe(200);
    });

    it("verifies 10-burst concurrent swarm on /api/fleet/agents/spawn: exactly 2 succeed, exactly 8 rejected with 429", async () => {
      const userRes = ledger.createUser({ username: "burst_spawn_user", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Launch 10 simultaneous agent spawn requests
      const promises = Array.from({ length: 10 }, (_, i) => {
        return apiRequest("/api/fleet/agents/spawn", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { agentId: `agent-burst-${i}`, model: "codex" },
        });
      });

      const responses = await Promise.all(promises);
      const passed = responses.filter((r) => r.status === 200);
      const rejected = responses.filter((r) => r.status === 429);

      expect(passed.length).toBe(2);
      expect(rejected.length).toBe(8);

      for (const rej of rejected) {
        expect(rej.body).toEqual({
          error:
            "Free tier allows a maximum of 2 Specialist Agents running concurrently (Architect + Coder)",
          upgradeUrl: "/#pricing",
        });
      }

      expect(getActiveUserAgentCount(userRes.user.id)).toBe(2);
    });

    it("verifies Pro and Enterprise tier users are completely exempt from the 2-agent concurrency limit", async () => {
      const proUser = ledger.createUser({ username: "pro_unlimited_user", tier: "pro" });
      const rawKey = proUser.rawKey;
      db.upsertUserAndQuotas({ ...proUser.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Spawn 8 concurrent agents for Pro user
      const promises = Array.from({ length: 8 }, (_, i) => {
        return apiRequest("/api/fleet/agents/spawn", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { agentId: `pro-agent-${i}`, model: "codex" },
        });
      });

      const responses = await Promise.all(promises);
      const passed = responses.filter((r) => r.status === 200);
      expect(passed.length).toBe(8);
      expect(getActiveUserAgentCount(proUser.user.id)).toBe(8);
    });
  });

  // =========================================================================
  // MISSION ITEM 2: IN-FLIGHT CREDIT RESERVATION STRESS
  // =========================================================================
  describe("Mission Item 2: In-Flight Credit Reservation Stress Testing", () => {
    it("empirically verifies: Launch 2 simultaneous dispatch requests with only enough credits for 1 job -> 1st MUST succeed, 2nd MUST reject with HTTP 402 INSUFFICIENT_CREDITS before execution", async () => {
      const userRes = ledger.createUser({ username: "single_job_credit_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // User starts with 200 credits; drain to EXACTLY 1.0 credit (1 job of 2,500 tokens requires 1.0 credit)
      const drain = db.deductCredits(userId, 199.0);
      expect(drain.success).toBe(true);
      expect(db.getUserCredits(userId).balance).toBe(1.0);

      // Launch 2 simultaneous dispatch requests, each requiring 1.0 credit (2,500 tokens of Codex)
      // Request 1 has a simulated delay of 80ms to guarantee an active in-flight window
      const req1Promise = apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Job 1", model: "codex", tokensEstimate: 2500, simulatedDelayMs: 80 },
      });

      const req2Promise = apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Job 2", model: "codex", tokensEstimate: 2500, simulatedDelayMs: 80 },
      });

      const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one must be 200 (succeeded), exactly one must be 402 (rejected)
      expect(statuses).toEqual([200, 402]);

      const successRes = res1.status === 200 ? res1 : res2;
      const failureRes = res1.status === 402 ? res1 : res2;

      expect(successRes.body.deduction.success).toBe(true);
      expect(successRes.body.deduction.chargedCredits).toBe(1.0);

      expect(failureRes.status).toBe(402);
      expect(failureRes.body.error).toBe("INSUFFICIENT_CREDITS");
      expect(failureRes.body.createOrderUrl).toBe("/api/billing/create-order");

      // Verify database state: balance is exactly 0.0, NEVER negative
      const finalCredits = db.getUserCredits(userId);
      expect(finalCredits.balance).toBe(0.0);
      expect(finalCredits.totalConsumed).toBe(200.0);

      // Verify reservation ledger is completely clean (zero memory leak)
      expect(getActiveReservedCredits(userId)).toBe(0);
    });

    it("verifies fractional balance race: 1.5 credits available, two 1.0 credit jobs -> 1st succeeds, 2nd rejected with 402, balance stays 0.5", async () => {
      const userRes = ledger.createUser({ username: "fractional_race_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Set balance to exactly 1.5 credits
      db.deductCredits(userId, 198.5);
      expect(db.getUserCredits(userId).balance).toBe(1.5);

      const [res1, res2] = await Promise.all([
        apiRequest("/api/fleet/dispatch", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { prompt: "Task A", model: "codex", tokensEstimate: 2500, simulatedDelayMs: 60 },
        }),
        apiRequest("/api/fleet/dispatch", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { prompt: "Task B", model: "codex", tokensEstimate: 2500, simulatedDelayMs: 60 },
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 402]);

      const failRes = res1.status === 402 ? res1 : res2;
      expect(failRes.body.error).toBe("INSUFFICIENT_CREDITS");

      // Balance must be exactly 0.5 in database
      const creditsAfter = db.getUserCredits(userId);
      expect(creditsAfter.balance).toBe(0.5);

      // Subsequent job requiring 0.5 credit (1,250 tokens) must now succeed
      const res3 = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Task C", model: "codex", tokensEstimate: 1250 },
      });
      expect(res3.status).toBe(200);
      expect(db.getUserCredits(userId).balance).toBe(0.0);
    });

    it("verifies multi-job credit reservation race under Pro tier (5 simultaneous jobs on 2.0 credits balance -> exactly 2 succeed, 3 reject with 402, balance reaches 0.0)", async () => {
      // Pro tier has unrestricted concurrency, so all 5 jobs reach the in-flight credit reservation ledger
      const userRes = ledger.createUser({ username: "burst_credit_pro_user", tier: "pro" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Pro user starts with 1,000 credits; drain down to exactly 2.0 credits
      const current = db.getUserCredits(userId);
      db.deductCredits(userId, current.balance - 2.0);
      expect(db.getUserCredits(userId).balance).toBe(2.0);

      // Launch 5 simultaneous requests of 1.0 credit each
      const promises = Array.from({ length: 5 }, (_, i) => {
        return apiRequest("/api/fleet/dispatch", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: {
            prompt: `Burst Job ${i}`,
            model: "codex",
            tokensEstimate: 2500,
            simulatedDelayMs: 60,
          },
        });
      });

      const responses = await Promise.all(promises);
      const successes = responses.filter((r) => r.status === 200);
      const failures = responses.filter((r) => r.status === 402);

      // Invariant: exactly 2 succeed, exactly 3 fail with 402 INSUFFICIENT_CREDITS
      expect(successes.length).toBe(2);
      expect(failures.length).toBe(3);

      for (const f of failures) {
        expect(f.body.error).toBe("INSUFFICIENT_CREDITS");
      }

      // Final balance MUST be 0.0, never negative
      const finalCredits = db.getUserCredits(userId);
      expect(finalCredits.balance).toBe(0.0);
      expect(finalCredits.totalConsumed).toBe(1000.0);
      expect(getActiveReservedCredits(userId)).toBe(0);
    });

    it("verifies dual protection for Free tier: 5 simultaneous jobs on 2.0 credits balance -> exactly 2 succeed, 3 rejected with 429 (concurrency limit)", async () => {
      const userRes = ledger.createUser({ username: "burst_credit_free_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Set balance to 2.0 credits
      db.deductCredits(userId, 198.0);
      expect(db.getUserCredits(userId).balance).toBe(2.0);

      // Launch 5 simultaneous requests of 1.0 credit each
      const promises = Array.from({ length: 5 }, (_, i) => {
        return apiRequest("/api/fleet/dispatch", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: {
            prompt: `Burst Job Free ${i}`,
            model: "codex",
            tokensEstimate: 2500,
            simulatedDelayMs: 60,
          },
        });
      });

      const responses = await Promise.all(promises);
      const successes = responses.filter((r) => r.status === 200);
      const concurrencyRejections = responses.filter((r) => r.status === 429);

      // Free tier is guarded by concurrency limit first: max 2 active agents
      expect(successes.length).toBe(2);
      expect(concurrencyRejections.length).toBe(3);

      for (const r of concurrencyRejections) {
        expect(r.body.error).toContain(
          "Free tier allows a maximum of 2 Specialist Agents running concurrently",
        );
      }

      // Final balance after the 2 successful jobs complete is 0.0
      const finalCredits = db.getUserCredits(userId);
      expect(finalCredits.balance).toBe(0.0);
      expect(getActiveReservedCredits(userId)).toBe(0);
    });
  });

  // =========================================================================
  // MISSION ITEM 3: MODEL LOCKOUT VARIATIONS
  // =========================================================================
  describe("Mission Item 3: Model Lockout Variations (Claude Opus 5.5 & Modal GPU strictly HTTP 403 for Free Tier)", () => {
    const opusModelVariations = [
      "claude-opus-5-5",
      "claude-opus-5.5",
      "claude-opus-4.8",
      "claude-opus-4-8",
      "claude-3-opus-20240229",
      "claude-3-opus",
      "claude-3-5-opus",
      "claude-3.5-opus",
      "opus",
      "OPUS",
      "Opus",
      "Claude-Opus-5-5",
      "CLAUDE-OPUS",
      "anthropic/claude-opus",
      "anthropic/claude-3-opus",
      "models/claude-opus-5.5",
    ];

    for (const modelStr of opusModelVariations) {
      it(`strictly returns HTTP 403 for Free tier user requesting Claude Opus variation: '${modelStr}' at /api/fleet/dispatch`, async () => {
        const userRes = ledger.createUser({
          username: `opus_var_${Math.random().toString(36).slice(2, 6)}`,
          tier: "free",
        });
        const rawKey = userRes.rawKey;
        db.upsertUserAndQuotas({
          ...userRes.user,
          keyHash: UserKeyLedger.hashToken(rawKey),
        } as any);

        const res = await apiRequest("/api/fleet/dispatch", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { prompt: "Complex test prompt", model: modelStr },
        });

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: "Claude Opus 5.5 requires Pro or Enterprise tier",
          upgradeUrl: "/#pricing",
        });
      });
    }

    it("strictly returns HTTP 403 when Free tier user requests tier: 'ultra' with omitted model at /api/fleet/dispatch", async () => {
      const userRes = ledger.createUser({ username: "ultra_tier_user", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Ultra reasoning", tier: "ultra" },
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Claude Opus 5.5 requires Pro or Enterprise tier",
        upgradeUrl: "/#pricing",
      });
    });

    it("strictly returns HTTP 403 when Free tier user requests Claude Opus variations at /api/fleet/agents/spawn", async () => {
      const userRes = ledger.createUser({ username: "spawn_opus_user", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      for (const model of ["claude-opus-5-5", "claude-opus-5.5", "opus", "claude-3-opus"]) {
        const res = await apiRequest("/api/fleet/agents/spawn", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { model },
        });
        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: "Claude Opus 5.5 requires Pro or Enterprise tier",
          upgradeUrl: "/#pricing",
        });
      }
    });

    it("strictly rejects Opus model change requests in AgentConfigSession for Free tier across variations", async () => {
      for (const opusModel of ["claude-opus-5-5", "claude-opus-5.5", "opus", "claude-3-opus"]) {
        const emitted: any[] = [];
        const session = new AgentConfigSession({
          host: { emit: (msg) => emitted.push(msg) },
          operations: {
            ensureLoaded: async () => {},
            setMode: async () => null,
            setModel: async () => {},
            setFeature: async () => {},
            setThinking: async () => null,
          },
          logger: { info: () => {}, error: () => {} } as any,
          getUserTier: () => "free",
        });

        await session.handleSetAgentModelRequest({
          type: "set_agent_model_request",
          requestId: `req-${opusModel}`,
          agentId: "agent-test",
          modelId: opusModel,
        });

        const resp = emitted.find((e) => e.type === "set_agent_model_response");
        expect(resp).toBeDefined();
        expect(resp.payload.accepted).toBe(false);
        expect(resp.payload.error).toBe("Claude Opus 5.5 requires Pro or Enterprise tier");
      }
    });

    const modalEndpoints = [
      { method: "GET", path: "/api/fleet/modal/summary" },
      { method: "GET", path: "/api/fleet/modal/profiles" },
      { method: "GET", path: "/api/fleet/modal/workers" },
      { method: "GET", path: "/api/fleet/modal/workloads" },
      { method: "POST", path: "/api/fleet/modal/profile/switch", body: { profile: "dev" } },
      { method: "POST", path: "/api/fleet/modal/cli/exec", body: { command: "modal app list" } },
      { method: "GET", path: "/api/fleet/modal/credits" },
      { method: "GET", path: "/api/fleet/modal/recommendations" },
      { method: "POST", path: "/api/fleet/modal/allocate", body: { workers: 2 } },
      { method: "GET", path: "/api/fleet/modal/logs" },
      { method: "GET", path: "/api/fleet/modal/logs/metrics" },
      { method: "POST", path: "/api/fleet/modal/logs/retention", body: { days: 7 } },
      { method: "GET", path: "/api/fleet/modal/rebalance/recommendations" },
      { method: "POST", path: "/api/fleet/modal/rebalance/apply", body: { planId: "p1" } },
    ];

    for (const ep of modalEndpoints) {
      it(`strictly returns HTTP 403 on Modal GPU endpoint '${ep.method} ${ep.path}' for Free tier user`, async () => {
        const userRes = ledger.createUser({
          username: `modal_free_${Math.random().toString(36).slice(2, 6)}`,
          tier: "free",
        });
        const rawKey = userRes.rawKey;
        db.upsertUserAndQuotas({
          ...userRes.user,
          keyHash: UserKeyLedger.hashToken(rawKey),
        } as any);

        const res = await apiRequest(ep.path, {
          method: ep.method,
          headers: { Authorization: `Bearer ${rawKey}` },
          body: ep.body,
        });

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: "Modal GPU requires Pro or Enterprise tier",
          upgradeUrl: "/#pricing",
        });
      });

      it(`strictly returns HTTP 403 on Modal GPU endpoint '${ep.method} ${ep.path}' for unauthenticated request`, async () => {
        const res = await apiRequest(ep.path, {
          method: ep.method,
          body: ep.body,
        });

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
          error: "Modal GPU requires Pro or Enterprise tier",
          upgradeUrl: "/#pricing",
        });
      });
    }

    it("verifies Pro and Enterprise tier users have unrestricted access to Claude Opus and Modal GPU", async () => {
      const proUser = ledger.createUser({ username: "pro_privileged_user", tier: "pro" });
      const rawKey = proUser.rawKey;
      db.upsertUserAndQuotas({ ...proUser.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Pro user accessing Claude Opus -> HTTP 200
      const opusRes = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Pro Opus prompt", model: "claude-opus-5-5" },
      });
      expect(opusRes.status).toBe(200);
      expect(opusRes.body.job.model).toBe("claude-opus-5-5");

      // Pro user accessing Modal GPU -> HTTP 200
      const modalRes = await apiRequest("/api/fleet/modal/summary", {
        method: "GET",
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      expect(modalRes.status).toBe(200);
      expect(modalRes.body.success).toBe(true);
    });
  });
});
