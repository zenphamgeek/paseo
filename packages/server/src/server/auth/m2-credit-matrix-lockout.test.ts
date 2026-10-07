import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { ZencodeDatabase, TOKENS_PER_Z_CREDIT } from "../db/database.js";
import { UserKeyLedger, resolveModelMultiplier } from "./user-key-ledger.js";
import { GoogleOAuthService } from "./google-oauth-service.js";
import {
  assertFreeTierGating,
  clearAllUserAgentRuns,
  getActiveUserAgentCount,
  recordUserAgentEnd,
  recordUserAgentStart,
} from "../bootstrap.js";
import { AgentConfigSession } from "../session/agent-config/agent-config-session.js";

describe("Milestone 2: Credit Cost Matrix, Concurrency Limit & Strict Lockout Suite", () => {
  const testDir = join("/tmp", `m2_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const dbPath = join(testDir, "test_m2.db");
  let db: ZencodeDatabase;
  let ledger: UserKeyLedger;
  let app: express.Express;
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    db = new ZencodeDatabase({ dbPath });
    ledger = new UserKeyLedger({ storageDir: testDir });
    clearAllUserAgentRuns();

    // Spin up an Express test server with the gating middleware & endpoints
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

    app.post("/api/fleet/modal/profile/switch", (_req, res) => {
      res.json({ success: true, profile: "dev" });
    });

    // Fleet dispatch endpoint
    app.post("/api/fleet/dispatch", (req, res) => {
      const { prompt, model, tier = "pro" } = req.body || {};
      const user = resolveUser(req);
      const userTier = user ? user.tier : "free";
      const userId = user ? user.id : req.body?.userId || "anon_free";

      const targetModel = model || (tier === "ultra" ? "claude-opus-5-5" : undefined);
      const modelGate = assertFreeTierGating({ userTier, requestedModel: targetModel });
      if (!modelGate.allowed) {
        return res.status(modelGate.status).json(modelGate.body);
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
      }

      const activeCount = getActiveUserAgentCount(userId);
      const concurrencyGate = assertFreeTierGating({ userTier, activeAgentsCount: activeCount });
      if (!concurrencyGate.allowed) {
        return res.status(concurrencyGate.status).json(concurrencyGate.body);
      }

      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      recordUserAgentStart(userId, jobId);

      const chosenModel = targetModel || "codex";
      const tokensUsed = Math.floor((prompt?.length || 100) / 4) + 150;

      let deduction: any = undefined;
      if (user) {
        deduction = db.deductCreditsForTokens({
          userId: user.id,
          model: chosenModel,
          tokenCount: tokensUsed,
        });
        ledger.recordModelUsage(user.id, chosenModel, tokensUsed);
      }

      recordUserAgentEnd(userId, jobId);

      res.json({
        job: { id: jobId, model: chosenModel, tokensUsed },
        output: "Execution simulated successfully",
        deduction,
      });
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

    app.post("/api/fleet/agents/stop", (req, res) => {
      const user = resolveUser(req);
      const userId = user ? user.id : req.body?.userId || "anon_free";
      const agentId = req.body?.agentId;
      if (agentId) {
        recordUserAgentEnd(userId, agentId);
      }
      res.json({ success: true, activeRunningCount: getActiveUserAgentCount(userId) });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    ledger.destroy();
    db.close();
    clearAllUserAgentRuns();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const apiRequest = async (
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: any } = {},
  ) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };

  // =========================================================================
  // 1. CREDIT COST MATRIX & REAL-TIME DEDUCTION
  // =========================================================================
  describe("1. Credit Cost Matrix & Real-time Deduction", () => {
    it("satisfies the base conversion formula: 1 Z-Credit = 2,500 base tokens", () => {
      expect(TOKENS_PER_Z_CREDIT).toBe(2500);

      // Multipliers
      expect(resolveModelMultiplier("codex")).toBe(1.0);
      expect(resolveModelMultiplier("gemini-2.5-flash")).toBe(1.0);
      expect(resolveModelMultiplier("claude-3.5-haiku")).toBe(3.0);
      expect(resolveModelMultiplier("gemini-2.5-pro")).toBe(5.0);
      expect(resolveModelMultiplier("cx/gpt-5.6-terra")).toBe(8.0);
      expect(resolveModelMultiplier("claude-sonnet-4.6")).toBe(12.0);
      expect(resolveModelMultiplier("claude-opus-5-5")).toBe(35.0);
      expect(resolveModelMultiplier("claude-opus-4.8")).toBe(35.0);
      expect(resolveModelMultiplier("cloudflare-clef")).toBe(0.0);
    });

    it("deducts exact credits for base model (Flash/Codex): 2,500 tokens = 1.0 Credit", () => {
      const userRes = ledger.createUser({ username: "flash_coder", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Initial balance is 200 credits
      const initial = db.getUserCredits(userId);
      expect(initial.balance).toBe(200);

      // Deduct 2,500 tokens of Flash (1.0x) -> exactly 1.0 credit
      const res1 = db.deductCreditsForTokens({
        userId,
        model: "gemini-2.5-flash",
        tokenCount: 2500,
      });
      expect(res1.success).toBe(true);
      expect(res1.chargedCredits).toBe(1.0);
      expect(res1.remainingBalance).toBe(199.0);

      // Deduct 50,000 tokens of Codex (1.0x) -> exactly 20.0 credits
      const res2 = db.deductCreditsForTokens({
        userId,
        model: "codex",
        tokenCount: 50000,
      });
      expect(res2.success).toBe(true);
      expect(res2.chargedCredits).toBe(20.0);
      expect(res2.remainingBalance).toBe(179.0);

      // Verify SQLite state
      const after = db.getUserCredits(userId);
      expect(after.balance).toBe(179.0);
      expect(after.totalConsumed).toBe(21.0);
    });

    it("scales deduction accurately by model multiplier (Haiku 3x, Pro 5x, Sonnet 12x)", () => {
      const userRes = ledger.createUser({ username: "pro_caller", tier: "pro" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Haiku (3x): 2,500 tokens * 3.0 / 2,500 = 3.0 credits
      const haikuRes = db.deductCreditsForTokens({
        userId,
        model: "claude-3.5-haiku",
        tokenCount: 2500,
      });
      expect(haikuRes.chargedCredits).toBe(3.0);

      // Gemini Pro (5x): 2,500 tokens * 5.0 / 2,500 = 5.0 credits
      const proRes = db.deductCreditsForTokens({
        userId,
        model: "gemini-2.5-pro",
        tokenCount: 2500,
      });
      expect(proRes.chargedCredits).toBe(5.0);

      // Claude Sonnet 4.6 (12x): 2,500 tokens * 12.0 / 2,500 = 12.0 credits
      const sonnetRes = db.deductCreditsForTokens({
        userId,
        model: "claude-sonnet-4.6",
        tokenCount: 2500,
      });
      expect(sonnetRes.chargedCredits).toBe(12.0);

      // Free pool Clef (0x): 10,000 tokens = 0 credits charged
      const clefRes = db.deductCreditsForTokens({
        userId,
        model: "cloudflare-clef",
        tokenCount: 10000,
      });
      expect(clefRes.chargedCredits).toBe(0.0);
    });

    it("verifies 500,000 base tokens equals exactly 200 Z-Credits monthly allotment", () => {
      const userRes = ledger.createUser({ username: "monthly_consumer", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Exactly 500,000 base tokens consumes 200 credits
      const res = db.deductCreditsForTokens({
        userId,
        model: "gemini-2.5-flash",
        tokenCount: 500000,
      });
      expect(res.success).toBe(true);
      expect(res.chargedCredits).toBe(200.0);
      expect(res.remainingBalance).toBe(0.0);

      const credits = db.getUserCredits(userId);
      expect(credits.balance).toBe(0.0);
      expect(credits.totalConsumed).toBe(200.0);
    });

    it("executes real-time credit deduction during /api/fleet/dispatch", async () => {
      const userRes = ledger.createUser({ username: "dispatch_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      const balBefore = db.getUserCredits(userId).balance;
      expect(balBefore).toBe(200);

      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Implement auth module", model: "gemini-2.5-flash" },
      });

      expect(res.status).toBe(200);
      expect(res.body.deduction).toBeDefined();
      expect(res.body.deduction.success).toBe(true);

      const balAfter = db.getUserCredits(userId).balance;
      expect(balAfter).toBeLessThan(balBefore);
      expect(balAfter).toBe(res.body.deduction.remainingBalance);
    });
  });

  // =========================================================================
  // 2. 0-CREDIT EXHAUSTION REJECTION & VIETQR SEPAY TOP-UP
  // =========================================================================
  describe("2. 0-Credit Exhaustion & VietQR SePay Instructions", () => {
    it("fails db deduction when credit balance reaches 0", () => {
      const userRes = ledger.createUser({ username: "exhausted_user", tier: "free" });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Drain all 200 credits
      db.deductCredits(userId, 200);
      expect(db.getUserCredits(userId).balance).toBe(0);

      const res = db.deductCreditsForTokens({
        userId,
        model: "codex",
        tokenCount: 1000,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("INSUFFICIENT_CREDITS");
      expect(res.remainingBalance).toBe(0);
    });

    it("rejects dispatch with HTTP 402 and top-up instructions when credits are exhausted", async () => {
      const userRes = ledger.createUser({ username: "exhausted_http_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Drain credits to 0
      db.deductCredits(userId, 200);

      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Refactor database", model: "codex" },
      });

      expect(res.status).toBe(402);
      expect(res.body.error).toContain("Z-Credits exhausted");
      expect(res.body.balance).toBe(0);
      expect(res.body.upgradeUrl).toBe("/#pricing");
      expect(res.body.createOrderUrl).toBe("/api/billing/create-order");
    });

    it("rejects agent spawn with HTTP 402 when credits are exhausted", async () => {
      const userRes = ledger.createUser({ username: "exhausted_spawn_user", tier: "free" });
      const userId = userRes.user.id;
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      db.deductCredits(userId, 200);

      const res = await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { model: "codex" },
      });

      expect(res.status).toBe(402);
      expect(res.body.error).toContain("Z-Credits exhausted");
      expect(res.body.createOrderUrl).toBe("/api/billing/create-order");
    });
  });

  // =========================================================================
  // 3. SPECIALIST AGENT CONCURRENCY LIMIT FOR FREE TIER (MAX 2)
  // =========================================================================
  describe("3. Specialist Agent Concurrency Limit for Free Tier (Max 2)", () => {
    it("allows up to 2 concurrent Specialist Agents for Free Tier", async () => {
      const userRes = ledger.createUser({ username: "concurrency_user", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Agent 1: Architect -> Success
      const res1 = await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-architect", model: "codex" },
      });
      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.activeRunningCount).toBe(1);

      // Agent 2: Coder -> Success
      const res2 = await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-coder", model: "codex" },
      });
      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.activeRunningCount).toBe(2);
    });

    it("rejects 3rd Specialist Agent attempt with HTTP 429 and exact error payload", async () => {
      const userRes = ledger.createUser({ username: "concurrency_limit_user", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Start 2 concurrent agents (Architect + Coder)
      await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-1-arch", model: "codex" },
      });
      await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-2-code", model: "codex" },
      });

      // Attempt 3rd agent (e.g. Reviewer) -> MUST BE REJECTED WITH 429
      const res3 = await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-3-reviewer", model: "codex" },
      });

      expect(res3.status).toBe(429);
      expect(res3.body).toEqual({
        error:
          "Free tier allows a maximum of 2 Specialist Agents running concurrently (Architect + Coder)",
        upgradeUrl: "//#pricing".replace("//", "/"),
      });

      // Also verify assertFreeTierGating helper directly
      const gate = assertFreeTierGating({ userTier: "free", activeAgentsCount: 2 });
      expect(gate.allowed).toBe(false);
      expect(gate.status).toBe(429);
      expect(gate.body).toEqual({
        error:
          "Free tier allows a maximum of 2 Specialist Agents running concurrently (Architect + Coder)",
        upgradeUrl: "/#pricing",
      });
    });

    it("allows spawning a new agent once an existing active agent completes/stops", async () => {
      const userRes = ledger.createUser({ username: "concurrency_recovery_user", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Start 2 agents
      await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-a", model: "codex" },
      });
      await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-b", model: "codex" },
      });

      // 3rd fails
      const failRes = await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-c", model: "codex" },
      });
      expect(failRes.status).toBe(429);

      // Stop agent-a
      const stopRes = await apiRequest("/api/fleet/agents/stop", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-a" },
      });
      expect(stopRes.status).toBe(200);
      expect(stopRes.body.activeRunningCount).toBe(1);

      // Now agent-c succeeds
      const successRes = await apiRequest("/api/fleet/agents/spawn", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { agentId: "agent-c", model: "codex" },
      });
      expect(successRes.status).toBe(200);
      expect(successRes.body.success).toBe(true);
    });

    it("does not restrict concurrency for Pro or Enterprise users", async () => {
      const proUser = ledger.createUser({ username: "pro_swarm_user", tier: "pro" });
      const rawKey = proUser.rawKey;
      db.upsertUserAndQuotas({ ...proUser.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      // Spawn 4 concurrent agents for Pro user without failure
      for (let i = 1; i <= 4; i++) {
        const res = await apiRequest("/api/fleet/agents/spawn", {
          method: "POST",
          headers: { Authorization: `Bearer ${rawKey}` },
          body: { agentId: `pro-agent-${i}`, model: "codex" },
        });
        expect(res.status).toBe(200);
      }

      const gate = assertFreeTierGating({ userTier: "pro", activeAgentsCount: 5 });
      expect(gate.allowed).toBe(true);
    });
  });

  // =========================================================================
  // 4. STRICT MODEL LOCKOUT: CLAUDE OPUS 5.5
  // =========================================================================
  describe("4. Strict Model Lockout (Claude Opus 5.5 -> HTTP 403)", () => {
    it("rejects claude-opus-5-5 for free tier at /api/fleet/dispatch with exact payload", async () => {
      const userRes = ledger.createUser({ username: "opus_seeker", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Deep architectural reasoning", model: "claude-opus-5-5" },
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Claude Opus 5.5 requires Pro or Enterprise tier",
        upgradeUrl: "/#pricing",
      });
    });

    it("rejects claude-opus-4.8 and generic opus aliases for free tier with HTTP 403", async () => {
      const userRes = ledger.createUser({ username: "opus_alias_user", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      const res1 = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Deep logic", model: "claude-opus-4.8" },
      });
      expect(res1.status).toBe(403);
      expect(res1.body).toEqual({
        error: "Claude Opus 5.5 requires Pro or Enterprise tier",
        upgradeUrl: "/#pricing",
      });

      const res2 = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Deep logic", model: "opus" },
      });
      expect(res2.status).toBe(403);
      expect(res2.body).toEqual({
        error: "Claude Opus 5.5 requires Pro or Enterprise tier",
        upgradeUrl: "/#pricing",
      });

      // Ultra tier request defaults to Opus and must also be 403
      const res3 = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Deep logic", tier: "ultra" },
      });
      expect(res3.status).toBe(403);
      expect(res3.body).toEqual({
        error: "Claude Opus 5.5 requires Pro or Enterprise tier",
        upgradeUrl: "/#pricing",
      });
    });

    it("rejects Opus model changes in AgentConfigSession for free tier", async () => {
      const emitted: any[] = [];
      const configSession = new AgentConfigSession({
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

      await configSession.handleSetAgentModelRequest({
        type: "set_agent_model_request",
        requestId: "req-opus-test",
        agentId: "agent-123",
        modelId: "claude-opus-5-5",
      });

      const responseEvent = emitted.find((e) => e.type === "set_agent_model_response");
      expect(responseEvent).toBeDefined();
      expect(responseEvent.payload.accepted).toBe(false);
      expect(responseEvent.payload.error).toBe("Claude Opus 5.5 requires Pro or Enterprise tier");
    });

    it("allows Claude Opus for Pro or Enterprise tier users", async () => {
      const proUser = ledger.createUser({ username: "opus_entitled", tier: "pro" });
      const rawKey = proUser.rawKey;
      db.upsertUserAndQuotas({ ...proUser.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      const res = await apiRequest("/api/fleet/dispatch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { prompt: "Enterprise complex reasoning", model: "claude-opus-5-5" },
      });

      expect(res.status).toBe(200);
      expect(res.body.job.model).toBe("claude-opus-5-5");
    });
  });

  // =========================================================================
  // 5. STRICT MODAL GPU LOCKOUT
  // =========================================================================
  describe("5. Strict Modal GPU Lockout (Modal GPU -> HTTP 403)", () => {
    it("locks out /api/fleet/modal/profile/switch for free tier with exact payload", async () => {
      const userRes = ledger.createUser({ username: "gpu_seeker", tier: "free" });
      const rawKey = userRes.rawKey;
      db.upsertUserAndQuotas({ ...userRes.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      const res = await apiRequest("/api/fleet/modal/profile/switch", {
        method: "POST",
        headers: { Authorization: `Bearer ${rawKey}` },
        body: { profile: "dev" },
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Modal GPU requires Pro or Enterprise tier",
        upgradeUrl: "/#pricing",
      });
    });

    it("locks out /api/fleet/modal/summary for unauthenticated or free tier users", async () => {
      const res = await apiRequest("/api/fleet/modal/summary", {
        method: "GET",
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Modal GPU requires Pro or Enterprise tier",
        upgradeUrl: "/#pricing",
      });
    });

    it("allows Modal GPU endpoints for Pro or Enterprise users", async () => {
      const proUser = ledger.createUser({ username: "gpu_entitled", tier: "pro" });
      const rawKey = proUser.rawKey;
      db.upsertUserAndQuotas({ ...proUser.user, keyHash: UserKeyLedger.hashToken(rawKey) } as any);

      const res = await apiRequest("/api/fleet/modal/summary", {
        method: "GET",
        headers: { Authorization: `Bearer ${rawKey}` },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 6. M1 HARDENING VERIFICATION
  // =========================================================================
  describe("6. M1 Hardening Guards", () => {
    it("rejects mock_google_ tokens when dev/test mock auth is disabled", () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origVitest = process.env.VITEST;
      const origAllow = process.env.ALLOW_DEV_MOCK_AUTH;

      try {
        process.env.NODE_ENV = "production";
        delete process.env.VITEST;
        delete process.env.ALLOW_DEV_MOCK_AUTH;

        const authService = new GoogleOAuthService({ db, ledger });
        const result = authService.parseAndValidateToken("mock_google_attacker@example.com");
        // In production without mock flags, mock_google_ cannot be parsed
        expect(result).toBeNull();
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        if (origVitest !== undefined) process.env.VITEST = origVitest;
        if (origAllow !== undefined) process.env.ALLOW_DEV_MOCK_AUTH = origAllow;
      }
    });

    it("rejects token payloads missing a valid numeric exp field", () => {
      const authService = new GoogleOAuthService({ db, ledger });
      // Create a base64 encoded JWT with no exp or non-numeric exp
      const headerB64 = Buffer.from(
        JSON.stringify({ alg: "RS256", kid: "fallback_google_cert_2026" }),
      ).toString("base64url");
      const payloadB64 = Buffer.from(
        JSON.stringify({
          iss: "https://accounts.google.com",
          sub: "sub_123",
          email: "test@gmail.com",
          exp: "not-a-number",
        }),
      ).toString("base64url");
      const invalidToken = `${headerB64}.${payloadB64}.fakesig`;

      const result = authService.parseAndValidateToken(invalidToken);
      expect(result).toBeNull();
    });
  });
});
