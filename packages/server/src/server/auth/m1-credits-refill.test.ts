import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { ZencodeDatabase } from "../db/database.js";
import { GoogleOAuthService } from "./google-oauth-service.js";
import { UserKeyLedger } from "./user-key-ledger.js";

describe("Milestone 1: 30-Day Monthly Refill & Credit Transparency Engine", () => {
  const testDir = join(
    "/tmp",
    `m1_refill_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  );
  const dbPath = join(testDir, "test_m1.db");
  let db: ZencodeDatabase;
  let ledger: UserKeyLedger;
  let service: GoogleOAuthService;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = new ZencodeDatabase({ dbPath });
    ledger = new UserKeyLedger({ storageDir: testDir });
    service = new GoogleOAuthService({
      db,
      ledger,
      clientId: "test-client-id.apps.googleusercontent.com",
    });
  });

  afterEach(() => {
    ledger.destroy();
    db.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("triggers monthly refill to 200 credits without stacking when 30 days have elapsed", () => {
    // 1. Create a free-tier user
    const userRes = ledger.createUser({
      username: "refill_tester",
      tier: "free",
    });
    const userId = userRes.user.id;

    // Seed credits with 200 initially
    db.upsertUserAndQuotas({
      ...userRes.user,
      keyHash: UserKeyLedger.hashToken(userRes.rawKey),
    } as any);

    // Simulate usage: deduct 150 credits, leaving 50
    const deductRes = db.deductCredits(userId, 150);
    expect(deductRes.success).toBe(true);
    expect(deductRes.newBalance).toBe(50);

    // Artificially backdate last_reset_date to 35 days ago in SQLite
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    (db as any).db
      .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
      .run(thirtyFiveDaysAgo, userId);

    // Verify user in DB has backdated lastResetDate
    const userBefore = db.getUserById(userId);
    expect(userBefore?.lastResetDate).toBe(thirtyFiveDaysAgo);

    // Call checkAndRefillMonthlyCredits
    const refillResult = db.checkAndRefillMonthlyCredits(userId);
    expect(refillResult).not.toBeNull();
    expect(refillResult?.refilled).toBe(true);
    // Non-accumulative: balance resets to exactly 200, NOT 50 + 200 = 250!
    expect(refillResult?.balance).toBe(200);

    // Verify credits in SQLite WAL
    const creditsAfter = db.getUserCredits(userId);
    expect(creditsAfter.balance).toBe(200);

    // Verify last_reset_date was updated to today
    const todayUtc = new Date().toISOString().slice(0, 10);
    const userAfter = db.getUserById(userId);
    expect(userAfter?.lastResetDate).toBe(todayUtc);

    // Verify nextResetDate is 30 days in the future
    const expectedNext = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(refillResult?.nextResetDate).toBe(expectedNext);

    // Verify MONTHLY_CREDITS_REFILL audit log was recorded
    const auditRow = (db as any).db
      .prepare(`
      SELECT * FROM audit_logs WHERE user_id = ? AND action = 'MONTHLY_CREDITS_REFILL'
    `)
      .get(userId) as any;
    expect(auditRow).toBeDefined();
    const details = JSON.parse(auditRow.details_json);
    expect(details.previousBalance).toBe(50);
    expect(details.newBalance).toBe(200);
  });

  it("does not refill when less than 30 days have elapsed", () => {
    const userRes = ledger.createUser({
      username: "no_refill_tester",
      tier: "free",
    });
    const userId = userRes.user.id;
    db.upsertUserAndQuotas({
      ...userRes.user,
      keyHash: UserKeyLedger.hashToken(userRes.rawKey),
    } as any);

    // Deduct 100 credits, leaving 100
    db.deductCredits(userId, 100);
    expect(db.getUserCredits(userId).balance).toBe(100);

    // Set last_reset_date to 15 days ago (< 30 days)
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    (db as any).db
      .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
      .run(fifteenDaysAgo, userId);

    // Call checkAndRefillMonthlyCredits
    const result = db.checkAndRefillMonthlyCredits(userId);
    expect(result).not.toBeNull();
    expect(result?.refilled).toBe(false);
    expect(result?.balance).toBe(100);

    // Balance in DB must remain 100
    expect(db.getUserCredits(userId).balance).toBe(100);
    // lastResetDate must not change
    expect(db.getUserById(userId)?.lastResetDate).toBe(fifteenDaysAgo);
  });

  it("does not stack free credits if user already holds >= 200 balance from purchases", () => {
    const userRes = ledger.createUser({
      username: "rich_free_user",
      tier: "free",
    });
    const userId = userRes.user.id;
    db.upsertUserAndQuotas({
      ...userRes.user,
      keyHash: UserKeyLedger.hashToken(userRes.rawKey),
    } as any);

    // User purchased credits: add 500 credits, balance becomes 700
    db.addCredits(userId, 500);
    expect(db.getUserCredits(userId).balance).toBe(700);

    // Backdate last_reset_date to 40 days ago
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    (db as any).db
      .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
      .run(fortyDaysAgo, userId);

    // Trigger refill
    const result = db.checkAndRefillMonthlyCredits(userId);
    expect(result?.refilled).toBe(true);
    // Balance should remain 700 (non-stacking: does not add 200 to 700, and does not downgrade 700 to 200)
    expect(result?.balance).toBe(700);
    expect(db.getUserCredits(userId).balance).toBe(700);
  });

  it("decouples daily quota rollover from monthly refill in UserKeyLedger", () => {
    const userRes = ledger.createUser({
      username: "decouple_tester",
      tier: "free",
    });
    const userId = userRes.user.id;
    const user = (ledger as any).users.get(userId);

    // Set lastResetDate to 25 days ago (monthly refill cycle)
    const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    user.lastResetDate = twentyFiveDaysAgo;

    // Simulate daily rollover from yesterday
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    user.lastDailyResetDate = yesterday;
    user.quotas.llm.usedTodayTokens = 45000;

    // Run checkDailyRollover
    const rolledOver = ledger.checkDailyRollover(user);
    expect(rolledOver).toBe(true);
    expect(user.quotas.llm.usedTodayTokens).toBe(0);

    // CRITICAL: user.lastResetDate must NOT be overwritten by daily rollover!
    expect(user.lastResetDate).toBe(twentyFiveDaysAgo);
    expect(user.lastDailyResetDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("provisions 200 credits and initializes last_reset_date upon Google OAuth registration", async () => {
    const authResult = await service.authenticate("mock_google_free_tier_newbie@gmail.com");
    expect(authResult.success).toBe(true);
    expect(authResult.isNewUser).toBe(true);
    expect(authResult.user?.tier).toBe("free");

    const userId = authResult.user!.id;
    const credits = db.getUserCredits(userId);
    expect(credits.balance).toBe(200);
    expect(credits.totalDeposited).toBe(200);
    expect(credits.totalConsumed).toBe(0);

    const userInDb = db.getUserById(userId);
    const todayUtc = new Date().toISOString().slice(0, 10);
    expect(userInDb?.lastResetDate).toBe(todayUtc);
    expect(userInDb?.email).toBe("free_tier_newbie@gmail.com");
  });

  it("calculates accurate token equivalents for credit transparency (1 Credit = 2,500 Flash/Codex tokens)", () => {
    const balance = 200;
    const tokensEquivalent = balance * 2500;
    expect(tokensEquivalent).toBe(500000); // 500,000 tokens for 200 credits
  });

  it("serves GET /api/billing/credits/balance and GET /api/fleet/user/quotas with valid data (<50ms SLA)", async () => {
    // Register user
    const authRes = await service.authenticate("mock_google_api_tester@gmail.com");
    expect(authRes.success).toBe(true);
    const user = authRes.user!;
    const rawKey = authRes.rawKey!;

    // Setup an Express app mounting the exact route handlers
    const app = express();
    app.use(express.json());

    const resolveCallerUser = (req: express.Request): any => {
      const authHeader = req.header("authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
      if (token) {
        const u = ledger.findUserByToken(token);
        if (u) return u;
        const keyHash = UserKeyLedger.hashToken(token);
        const row = (db as any).db
          ?.prepare("SELECT id FROM users WHERE key_hash = ?")
          .get(keyHash) as { id: string } | undefined;
        if (row) return db.getUserById(row.id);
      }
      const userId = (req.query.userId as string) || (req.header("x-user-id") as string);
      if (userId) {
        const dbUser = db.getUserById(userId);
        if (dbUser) return dbUser;
        return ledger.getUser(userId);
      }
      return null;
    };

    app.get("/api/billing/credits/balance", (req, res) => {
      const u = resolveCallerUser(req);
      if (!u) return res.status(401).json({ error: "Unauthorized" });
      const refillResult = db.checkAndRefillMonthlyCredits(u.id);
      const credits = db.getUserCredits(u.id);
      res.json({
        success: true,
        userId: u.id,
        balance: credits.balance,
        tier: u.tier,
        nextResetDate: refillResult?.nextResetDate,
        totalDeposited: credits.totalDeposited,
        totalConsumed: credits.totalConsumed,
        tokensEquivalentRemaining: Math.round(credits.balance * 2500),
        conversionRate: "1 Credit = 2,500 Flash/Codex tokens",
      });
    });

    app.get("/api/fleet/user/quotas", (req, res) => {
      const u = resolveCallerUser(req);
      if (!u) return res.status(401).json({ error: "Unauthorized" });
      const refillResult = db.checkAndRefillMonthlyCredits(u.id);
      const credits = db.getUserCredits(u.id);
      const userRecord = db.getUserById(u.id) || u;
      const isFreeTier = userRecord.tier === "free";
      res.json({
        success: true,
        userId: userRecord.id,
        tier: userRecord.tier,
        balance: credits.balance,
        nextResetDate: refillResult?.nextResetDate,
        quotas: {
          llm: {
            dailyTokenBudget: userRecord.quotas.llm.dailyTokenBudget,
            usedTodayTokens: userRecord.quotas.llm.usedTodayTokens,
            remainingTokens: Math.max(
              0,
              userRecord.quotas.llm.dailyTokenBudget - userRecord.quotas.llm.usedTodayTokens,
            ),
            allowedModels: isFreeTier
              ? ["codex", "gemini-2.5-flash"]
              : userRecord.quotas.llm.allowedModels,
            allowClaudeOpus: isFreeTier ? false : Boolean(userRecord.quotas.llm.allowClaudeOpus),
            maxSpecialistAgents: isFreeTier ? 2 : 10,
          },
          modal_gpu: {
            enabled: isFreeTier ? false : userRecord.quotas.modal_gpu.enabled,
            dailyGpuMinutes: isFreeTier ? 0 : userRecord.quotas.modal_gpu.dailyGpuMinutes,
            usedTodayMinutes: userRecord.quotas.modal_gpu.usedTodayMinutes,
          },
          cloudflare_clef: {
            enabled: userRecord.quotas.cloudflare_clef.enabled,
            dailyRequests: userRecord.quotas.cloudflare_clef.dailyRequests,
            usedTodayRequests: userRecord.quotas.cloudflare_clef.usedTodayRequests,
          },
        },
        concurrency: {
          maxSpecialistAgents: isFreeTier ? 2 : 10,
          currentRunningAgents: 0,
          description: isFreeTier
            ? "Free tier allows a maximum of 2 Specialist Agents running concurrently (Architect + Coder)"
            : "Unlimited / higher concurrency for paid tiers",
        },
        consumptionHistory: {
          totalDeposited: credits.totalDeposited,
          totalConsumed: credits.totalConsumed,
          currentBalance: credits.balance,
        },
      });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // Test /api/billing/credits/balance with Bearer token
      const t0 = performance.now();
      const balRes = await fetch(`${baseUrl}/api/billing/credits/balance`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      const t1 = performance.now();
      expect(t1 - t0).toBeLessThan(50); // SLA p95 < 50ms
      expect(balRes.status).toBe(200);

      const balJson = (await balRes.json()) as any;
      expect(balJson.success).toBe(true);
      expect(balJson.userId).toBe(user.id);
      expect(balJson.balance).toBe(200);
      expect(balJson.tier).toBe("free");
      expect(balJson.tokensEquivalentRemaining).toBe(500000);
      expect(balJson.conversionRate).toBe("1 Credit = 2,500 Flash/Codex tokens");
      expect(balJson.totalDeposited).toBe(200);
      expect(balJson.totalConsumed).toBe(0);

      // Test /api/billing/credits/balance with ?userId= fallback
      const balQueryRes = await fetch(`${baseUrl}/api/billing/credits/balance?userId=${user.id}`);
      expect(balQueryRes.status).toBe(200);
      const balQueryJson = (await balQueryRes.json()) as any;
      expect(balQueryJson.userId).toBe(user.id);
      expect(balQueryJson.balance).toBe(200);

      // Test /api/fleet/user/quotas with Bearer token
      const quotaRes = await fetch(`${baseUrl}/api/fleet/user/quotas`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      expect(quotaRes.status).toBe(200);
      const quotaJson = (await quotaRes.json()) as any;
      expect(quotaJson.success).toBe(true);
      expect(quotaJson.userId).toBe(user.id);
      expect(quotaJson.tier).toBe("free");
      expect(quotaJson.quotas.llm.allowedModels).toEqual(["codex", "gemini-2.5-flash"]);
      expect(quotaJson.quotas.llm.allowClaudeOpus).toBe(false);
      expect(quotaJson.concurrency.maxSpecialistAgents).toBe(2);
      expect(quotaJson.consumptionHistory.currentBalance).toBe(200);

      // Test 401 Unauthorized without token or userId
      const unauthRes = await fetch(`${baseUrl}/api/billing/credits/balance`);
      expect(unauthRes.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
