import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import https from "node:https";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { ZencodeDatabase } from "../db/database.js";
import { GoogleOAuthService, BUNDLED_FALLBACK_GOOGLE_JWKS } from "./google-oauth-service.js";
import { UserKeyLedger } from "./user-key-ledger.js";

describe("Milestone 1 Empirical Adversarial Stress Harness", () => {
  const testDir = join("/tmp", `m1_stress_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const dbPath = join(testDir, "test_m1_stress.db");
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
      clientId: "stress-test-client-id.apps.googleusercontent.com",
    });
  });

  afterEach(() => {
    ledger.destroy();
    db.close();
    GoogleOAuthService.clearJwkCache();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // 1. BOUNDARY TESTS FOR 30-DAY REFILL ENGINE
  // =========================================================================
  describe("1. Boundary Tests for 30-Day Refill Engine", () => {
    it("Day 29 boundary: must NOT refill when 29 days have elapsed", () => {
      const userRes = ledger.createUser({
        username: "boundary_day29_user",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Deduct 160 credits -> balance is 40
      const deduct = db.deductCredits(userId, 160);
      expect(deduct.success).toBe(true);
      expect(deduct.newBalance).toBe(40);

      // Backdate last_reset_date to exactly 29 days ago
      const day29Ago = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(day29Ago, userId);

      // Invoke refill check
      const result = db.checkAndRefillMonthlyCredits(userId);
      expect(result).not.toBeNull();
      expect(result?.refilled).toBe(false);
      expect(result?.balance).toBe(40);
      expect(result?.lastResetDate).toBe(day29Ago);

      // Confirm in SQLite storage
      const credits = db.getUserCredits(userId);
      expect(credits.balance).toBe(40);
      const userInDb = db.getUserById(userId);
      expect(userInDb?.lastResetDate).toBe(day29Ago);

      // Verify NO audit log was generated
      const audit = (db as any).db
        .prepare(`
        SELECT COUNT(*) as count FROM audit_logs WHERE user_id = ? AND action = 'MONTHLY_CREDITS_REFILL'
      `)
        .get(userId) as { count: number };
      expect(audit.count).toBe(0);
    });

    it("Day 30 boundary: MUST refill to 200 when exactly 30 days have elapsed", () => {
      const userRes = ledger.createUser({
        username: "boundary_day30_user",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Deduct 160 credits -> balance is 40
      db.deductCredits(userId, 160);
      expect(db.getUserCredits(userId).balance).toBe(40);

      // Backdate last_reset_date to exactly 30 days ago
      const day30Ago = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(day30Ago, userId);

      // Invoke refill check
      const result = db.checkAndRefillMonthlyCredits(userId);
      expect(result).not.toBeNull();
      expect(result?.refilled).toBe(true);
      expect(result?.balance).toBe(200);

      const todayUtc = new Date().toISOString().slice(0, 10);
      expect(result?.lastResetDate).toBe(todayUtc);

      // Confirm in SQLite
      const credits = db.getUserCredits(userId);
      expect(credits.balance).toBe(200);
      const userInDb = db.getUserById(userId);
      expect(userInDb?.lastResetDate).toBe(todayUtc);

      // Verify audit log
      const audit = (db as any).db
        .prepare(`
        SELECT * FROM audit_logs WHERE user_id = ? AND action = 'MONTHLY_CREDITS_REFILL'
      `)
        .get(userId) as any;
      expect(audit).toBeDefined();
      const details = JSON.parse(audit.details_json);
      expect(details.previousBalance).toBe(40);
      expect(details.newBalance).toBe(200);
    });

    it("Day 31 boundary: MUST refill to 200 when 31 days have elapsed", () => {
      const userRes = ledger.createUser({
        username: "boundary_day31_user",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // Deduct 190 credits -> balance is 10
      db.deductCredits(userId, 190);
      expect(db.getUserCredits(userId).balance).toBe(10);

      // Backdate last_reset_date to 31 days ago
      const day31Ago = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(day31Ago, userId);

      // Invoke refill check
      const result = db.checkAndRefillMonthlyCredits(userId);
      expect(result).not.toBeNull();
      expect(result?.refilled).toBe(true);
      expect(result?.balance).toBe(200);

      const todayUtc = new Date().toISOString().slice(0, 10);
      expect(result?.lastResetDate).toBe(todayUtc);
      expect(db.getUserCredits(userId).balance).toBe(200);
    });
  });

  // =========================================================================
  // 2. NON-ACCUMULATIVE CREDIT CHECK & BALANCE PRESERVATION
  // =========================================================================
  describe("2. Non-Accumulative Credit Check", () => {
    it("User with 40 credits resets to exactly 200 (not 40 + 200 = 240)", () => {
      const userRes = ledger.createUser({
        username: "non_acc_40_user",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      db.deductCredits(userId, 160);
      expect(db.getUserCredits(userId).balance).toBe(40);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(thirtyDaysAgo, userId);

      const result = db.checkAndRefillMonthlyCredits(userId);
      expect(result?.refilled).toBe(true);
      expect(result?.balance).toBe(200); // exactly 200, non-accumulative!
      expect(db.getUserCredits(userId).balance).toBe(200);
    });

    it("User with 250 credits (purchased) remains 250 (not topped up or lowered)", () => {
      const userRes = ledger.createUser({
        username: "non_acc_250_user",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      // User spends 100 (down to 100), then purchases 150 -> balance is exactly 250
      db.deductCredits(userId, 100);
      db.addCredits(userId, 150);
      expect(db.getUserCredits(userId).balance).toBe(250);

      // 35 days elapse
      const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(thirtyFiveDaysAgo, userId);

      const result = db.checkAndRefillMonthlyCredits(userId);
      expect(result?.refilled).toBe(true);
      // Crucial: Must remain 250! Neither lowered to 200 nor topped up to 450!
      expect(result?.balance).toBe(250);
      expect(db.getUserCredits(userId).balance).toBe(250);

      // Date must still update to today
      const todayUtc = new Date().toISOString().slice(0, 10);
      expect(result?.lastResetDate).toBe(todayUtc);
      expect(db.getUserById(userId)?.lastResetDate).toBe(todayUtc);
    });

    it("User with 0 credits resets to exactly 200", () => {
      const userRes = ledger.createUser({
        username: "non_acc_zero_user",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      db.deductCredits(userId, 200);
      expect(db.getUserCredits(userId).balance).toBe(0);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(thirtyDaysAgo, userId);

      const result = db.checkAndRefillMonthlyCredits(userId);
      expect(result?.refilled).toBe(true);
      expect(result?.balance).toBe(200);
      expect(db.getUserCredits(userId).balance).toBe(200);
    });

    it("User with exactly 200 credits remains 200 and does not double to 400", () => {
      const userRes = ledger.createUser({
        username: "non_acc_exact_200_user",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      expect(db.getUserCredits(userId).balance).toBe(200);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(thirtyDaysAgo, userId);

      const result = db.checkAndRefillMonthlyCredits(userId);
      expect(result?.refilled).toBe(true);
      expect(result?.balance).toBe(200);
      expect(db.getUserCredits(userId).balance).toBe(200);
    });
  });

  // =========================================================================
  // 3. IDEMPOTENCY & RACE CONDITIONS
  // =========================================================================
  describe("3. Idempotency & Race Conditions", () => {
    it("Multiple consecutive calls on day 30: refills only once, no double counting, no crash", () => {
      const userRes = ledger.createUser({
        username: "consecutive_refill_user",
        tier: "free",
      });
      const userId = userRes.user.id;
      db.upsertUserAndQuotas({
        ...userRes.user,
        keyHash: UserKeyLedger.hashToken(userRes.rawKey),
      } as any);

      db.deductCredits(userId, 170); // balance is 30
      expect(db.getUserCredits(userId).balance).toBe(30);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(thirtyDaysAgo, userId);

      // Call 1
      const res1 = db.checkAndRefillMonthlyCredits(userId);
      expect(res1?.refilled).toBe(true);
      expect(res1?.balance).toBe(200);

      // Calls 2 through 15 (simulating aggressive polling / re-checks)
      for (let i = 2; i <= 15; i++) {
        const resN = db.checkAndRefillMonthlyCredits(userId);
        expect(resN?.refilled).toBe(false);
        expect(resN?.balance).toBe(200);
      }

      // Final SQLite checks
      expect(db.getUserCredits(userId).balance).toBe(200);

      // Audit logs must contain EXACTLY ONE refill action
      const audits = (db as any).db
        .prepare(`
        SELECT * FROM audit_logs WHERE user_id = ? AND action = 'MONTHLY_CREDITS_REFILL'
      `)
        .all(userId) as any[];
      expect(audits.length).toBe(1);
    });

    it("Concurrent HTTP requests to /api/billing/credits/balance: all return 200, exactly one refill occurs, 0 crashes", async () => {
      // Create user and mount Express app
      const authRes = await service.authenticate("mock_google_concurrent_tester@gmail.com");
      expect(authRes.success).toBe(true);
      const user = authRes.user!;
      const rawKey = authRes.rawKey!;

      // Deduct down to 35 credits
      db.deductCredits(user.id, 165);
      expect(db.getUserCredits(user.id).balance).toBe(35);

      // Backdate last_reset_date to 32 days ago
      const thirtyTwoDaysAgo = new Date(Date.now() - 32 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      (db as any).db
        .prepare(`UPDATE users SET last_reset_date = ? WHERE id = ?`)
        .run(thirtyTwoDaysAgo, user.id);

      const app = express();
      app.get("/api/billing/credits/balance", (req, res) => {
        try {
          const authHeader = req.header("authorization");
          const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
          if (!token) return res.status(401).json({ error: "Unauthorized" });

          const refillResult = db.checkAndRefillMonthlyCredits(user.id);
          const credits = db.getUserCredits(user.id);
          res.json({
            success: true,
            userId: user.id,
            balance: credits.balance,
            tier: user.tier,
            nextResetDate: refillResult?.nextResetDate,
          });
        } catch (err: any) {
          res.status(500).json({ error: err.message });
        }
      });

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Fire 25 concurrent requests simultaneously
        const CONCURRENT_REQUESTS = 25;
        const promises = Array.from({ length: CONCURRENT_REQUESTS }, () =>
          fetch(`${baseUrl}/api/billing/credits/balance`, {
            headers: { Authorization: `Bearer ${rawKey}` },
          }),
        );

        const responses = await Promise.all(promises);

        // Every single response must be 200 OK
        for (const resp of responses) {
          expect(resp.status).toBe(200);
        }

        const jsonBodies = (await Promise.all(responses.map((r) => r.json()))) as any[];
        for (const body of jsonBodies) {
          expect(body.success).toBe(true);
          expect(body.balance).toBe(200);
        }

        // Database balance must be exactly 200
        expect(db.getUserCredits(user.id).balance).toBe(200);

        // Exactly 1 audit record for refill
        const auditRows = (db as any).db
          .prepare(`
          SELECT * FROM audit_logs WHERE user_id = ? AND action = 'MONTHLY_CREDITS_REFILL'
        `)
          .all(user.id) as any[];
        expect(auditRows.length).toBe(1);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  // =========================================================================
  // 4. FORGED / MALFORMED TOKENS & SOVEREIGN STEALTH MODE INVARIANTS
  // =========================================================================
  describe("4. Forged/Malformed Google ID Tokens & Stealth Invariants", () => {
    it("Zero outbound network telemetry invariant: throws if any network socket or fetch is attempted", async () => {
      // Intercept any attempt to initiate an outbound network request during token verification
      const originalFetch = global.fetch;
      const originalHttpGet = http.get;
      const originalHttpRequest = http.request;
      const originalHttpsGet = https.get;
      const originalHttpsRequest = https.request;

      let networkCallAttempted = false;
      const trapNetwork = () => {
        networkCallAttempted = true;
        throw new Error("STEALTH INVARIANT VIOLATION: Outbound network call detected!");
      };

      (global as any).fetch = vi.fn().mockImplementation(trapNetwork);
      http.get = vi.fn().mockImplementation(trapNetwork) as any;
      http.request = vi.fn().mockImplementation(trapNetwork) as any;
      https.get = vi.fn().mockImplementation(trapNetwork) as any;
      https.request = vi.fn().mockImplementation(trapNetwork) as any;

      try {
        // Run token validation on invalid token
        const result1 = service.parseAndValidateToken("forged.token.payload");
        expect(result1).toBeNull();

        // Run authenticate on invalid token
        const result2 = await service.authenticate("forged.token.payload");
        expect(result2.success).toBe(false);

        // Run authenticate on valid mock token
        const result3 = await service.authenticate("mock_google_stealth_check@gmail.com");
        expect(result3.success).toBe(true);

        // Verify ZERO network calls were attempted
        expect(networkCallAttempted).toBe(false);
      } finally {
        global.fetch = originalFetch;
        http.get = originalHttpGet;
        http.request = originalHttpRequest;
        https.get = originalHttpsGet;
        https.request = originalHttpsRequest;
      }
    });

    it("Rejects malformed strings (empty, garbage, incomplete parts) with null", () => {
      expect(service.parseAndValidateToken("")).toBeNull();
      expect(service.parseAndValidateToken("   ")).toBeNull();
      expect(service.parseAndValidateToken("not-a-token")).toBeNull();
      expect(service.parseAndValidateToken("part1.part2")).toBeNull();
      expect(service.parseAndValidateToken("part1.part2.part3.part4")).toBeNull();
      expect(service.parseAndValidateToken(null as any)).toBeNull();
      expect(service.parseAndValidateToken(undefined as any)).toBeNull();
      expect(service.parseAndValidateToken(12345 as any)).toBeNull();
    });

    it("Rejects tokens with unparseable or corrupted base64url segments", () => {
      const corrupt1 = "???notbase64???.???notbase64???.???notbase64???";
      expect(service.parseAndValidateToken(corrupt1)).toBeNull();

      // Valid base64 but invalid JSON
      const invalidJsonB64 = Buffer.from("this is not json").toString("base64url");
      const corrupt2 = `${invalidJsonB64}.${invalidJsonB64}.${invalidJsonB64}`;
      expect(service.parseAndValidateToken(corrupt2)).toBeNull();
    });

    it("Rejects tokens with invalid issuer (iss !== accounts.google.com)", () => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = publicKey.export({ format: "jwk" }) as any;
      jwk.kid = "test_iss_key";
      jwk.alg = "RS256";
      jwk.use = "sig";
      GoogleOAuthService.registerJwk(jwk);

      const header = { alg: "RS256", kid: "test_iss_key", typ: "JWT" };
      const payload = {
        iss: "https://evil-oauth.attacker-controlled.com",
        sub: "google_sub_evil",
        aud: "stress-test-client-id.apps.googleusercontent.com",
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: "evil@attacker.com",
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = sign(
        "RSA-SHA256",
        Buffer.from(`${headerB64}.${payloadB64}`),
        privateKey,
      ).toString("base64url");
      const token = `${headerB64}.${payloadB64}.${sig}`;

      expect(service.parseAndValidateToken(token)).toBeNull();
    });

    it("Rejects tokens with expired exp timestamp", () => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = publicKey.export({ format: "jwk" }) as any;
      jwk.kid = "test_exp_key";
      jwk.alg = "RS256";
      jwk.use = "sig";
      GoogleOAuthService.registerJwk(jwk);

      const header = { alg: "RS256", kid: "test_exp_key", typ: "JWT" };
      const payload = {
        iss: "https://accounts.google.com",
        sub: "google_sub_expired",
        aud: "stress-test-client-id.apps.googleusercontent.com",
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
        email: "expired@gmail.com",
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = sign(
        "RSA-SHA256",
        Buffer.from(`${headerB64}.${payloadB64}`),
        privateKey,
      ).toString("base64url");
      const token = `${headerB64}.${payloadB64}.${sig}`;

      expect(service.parseAndValidateToken(token)).toBeNull();
    });

    it("Rejects forged tokens with tampered payload (signature verification failure)", () => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = publicKey.export({ format: "jwk" }) as any;
      jwk.kid = "test_tamper_key";
      jwk.alg = "RS256";
      jwk.use = "sig";
      GoogleOAuthService.registerJwk(jwk);

      const header = { alg: "RS256", kid: "test_tamper_key", typ: "JWT" };
      const legitimatePayload = {
        iss: "https://accounts.google.com",
        sub: "google_sub_legit",
        aud: "stress-test-client-id.apps.googleusercontent.com",
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: "legit_user@gmail.com",
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
      const legitPayloadB64 = Buffer.from(JSON.stringify(legitimatePayload)).toString("base64url");
      const sig = sign(
        "RSA-SHA256",
        Buffer.from(`${headerB64}.${legitPayloadB64}`),
        privateKey,
      ).toString("base64url");

      // Attacker tampers payload to elevate privileges or impersonate another user
      const forgedPayload = {
        ...legitimatePayload,
        email: "admin@zencode.vn",
        sub: "google_sub_admin",
      };
      const forgedPayloadB64 = Buffer.from(JSON.stringify(forgedPayload)).toString("base64url");

      const forgedToken = `${headerB64}.${forgedPayloadB64}.${sig}`;
      expect(service.parseAndValidateToken(forgedToken)).toBeNull();
    });

    it("Rejects algorithm confusion attacks (alg: 'none')", () => {
      const header = { alg: "none", typ: "JWT" };
      const payload = {
        iss: "https://accounts.google.com",
        sub: "google_sub_alg_none",
        aud: "stress-test-client-id.apps.googleusercontent.com",
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: "alg_none@gmail.com",
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const token = `${headerB64}.${payloadB64}.`;

      expect(service.parseAndValidateToken(token)).toBeNull();
    });

    it("Rejects tokens with unregistered or untrusted key IDs (kid)", () => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const header = { alg: "RS256", kid: "unregistered_or_forged_kid", typ: "JWT" };
      const payload = {
        iss: "https://accounts.google.com",
        sub: "google_sub_unknown_kid",
        aud: "stress-test-client-id.apps.googleusercontent.com",
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: "unknown_kid@gmail.com",
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const sig = sign(
        "RSA-SHA256",
        Buffer.from(`${headerB64}.${payloadB64}`),
        privateKey,
      ).toString("base64url");
      const token = `${headerB64}.${payloadB64}.${sig}`;

      expect(service.parseAndValidateToken(token)).toBeNull();
    });

    it("HTTP Endpoint: POST /api/fleet/auth/oauth/google returns 401 on forged tokens and 400 on empty token without crashing", async () => {
      const app = express();
      app.use(express.json());
      app.post("/api/fleet/auth/oauth/google", (req, res) => {
        void (async () => {
          try {
            const { idToken } = req.body || {};
            if (!idToken) {
              return res.status(400).json({ error: "Missing required parameter 'idToken'" });
            }
            const result = await service.authenticate(idToken);
            if (!result.success) {
              return res
                .status(401)
                .json({ error: result.error || "Google authentication failed" });
            }
            res.json(result);
          } catch (err: any) {
            res.status(500).json({ error: err.message });
          }
        })();
      });

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // 1. Missing token -> 400
        const resEmpty = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(resEmpty.status).toBe(400);

        // 2. Garbage token -> 401
        const resGarbage = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: "invalid_garbage_token" }),
        });
        expect(resGarbage.status).toBe(401);
        const garbageJson = (await resGarbage.json()) as any;
        expect(garbageJson.error).toBe("Invalid or expired Google ID token");

        // 3. Forged RS256 token -> 401
        const forgedToken =
          "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2Vfa2lkIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJzdWIiOiIxMjM0NSIsImVtYWlsIjoiZmFrZUBnbWFpbC5jb20ifQ.ZmFrZV9zaWc";
        const resForged = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: forgedToken }),
        });
        expect(resForged.status).toBe(401);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
