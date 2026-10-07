import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { ZencodeDatabase } from "../db/database.js";
import { GoogleOAuthService } from "./google-oauth-service.js";
import { UserKeyLedger } from "./user-key-ledger.js";
import { AntiSybilLedger } from "./anti-sybil-ledger.js";
import { createWebAppGatingMiddleware } from "../web-app-gating.js";

describe("Milestone M3 Empirical Adversarial Challenge: Anti-Sybil Defense & Gating Router", () => {
  const testDir = join(
    "/tmp",
    `m3_challenger_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  );
  const dbPath = join(testDir, "test_m3_challenger.db");
  let db: ZencodeDatabase;
  let ledger: UserKeyLedger;
  let service: GoogleOAuthService;
  let antiSybil: AntiSybilLedger;
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    db = new ZencodeDatabase({ dbPath });
    ledger = new UserKeyLedger({ storageDir: testDir });
    antiSybil = new AntiSybilLedger();
    service = new GoogleOAuthService({
      db,
      ledger,
      clientId: "challenger-client-id.apps.googleusercontent.com",
    });

    app = express();
    app.use(express.json());

    // 1. Web App Gating Middleware
    app.use(createWebAppGatingMiddleware({ userLedger: ledger, db }));

    // 2. Google OAuth Route (exact replica of bootstrap.ts:1629-1665)
    app.post("/api/fleet/auth/oauth/google", (req, res) => {
      void (async () => {
        try {
          const { idToken } = req.body || {};
          if (!idToken) {
            return res.status(400).json({ error: "Missing required parameter 'idToken'" });
          }
          const ipAddress = AntiSybilLedger.extractClientIp(req);
          const userAgent = (req.headers["user-agent"] as string) || "";

          // Check if user is already registered (existing users bypass registration anti-sybil limit)
          const isExisting = service.isExistingUser(idToken);
          if (!isExisting) {
            const antiSybilCheck = antiSybil.checkRegistration(ipAddress, userAgent);
            if (!antiSybilCheck.allowed) {
              const body: Record<string, any> = { error: antiSybilCheck.error };
              if (antiSybilCheck.retryAfter !== undefined) {
                body.retryAfter = antiSybilCheck.retryAfter;
              }
              return res.status(429).json(body);
            }
          }

          const result = await service.authenticate(idToken, ipAddress);
          if (!result.success) {
            return res.status(401).json({ error: result.error || "Google authentication failed" });
          }
          if (result.isNewUser) {
            antiSybil.recordRegistration(ipAddress);
          }
          res.json(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: message });
        }
      })();
    });

    // Mock Web UI routes
    app.get("/open-project", (_req, res) => {
      res.status(200).send("<html><body>Zencode IDE Workspace</body></html>");
    });
    app.get("/", (_req, res) => {
      res.status(200).send("<html><body>Zencode IDE Root</body></html>");
    });
    app.get("/assets/bundle.js", (_req, res) => {
      res.setHeader("Content-Type", "application/javascript");
      res.status(200).send("console.log('static asset');");
    });
    app.get("/_expo/main.js", (_req, res) => {
      res.setHeader("Content-Type", "application/javascript");
      res.status(200).send("console.log('expo bundle');");
    });
    app.get("/api/health", (_req, res) => {
      res.status(200).json({ status: "healthy" });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as any;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ledger.destroy();
    db.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // CHALLENGE 1: Burst Registrations from Same IP (198.51.100.1)
  // =========================================================================
  describe("Challenge 1: Burst Registrations from Same IP (198.51.100.1)", () => {
    it("sequential burst: 1st, 2nd, 3rd registrations return HTTP 200; 4th MUST reject with HTTP 429", async () => {
      const targetIp = "198.51.100.1";
      const browserUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36";

      // 1st Registration
      const res1 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": targetIp,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_seq_user_1@gmail.com" }),
      });
      expect(res1.status).toBe(200);
      const data1 = (await res1.json()) as any;
      expect(data1.success).toBe(true);
      expect(data1.isNewUser).toBe(true);
      expect(data1.user.tier).toBe("free");

      // 2nd Registration
      const res2 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": targetIp,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_seq_user_2@gmail.com" }),
      });
      expect(res2.status).toBe(200);
      const data2 = (await res2.json()) as any;
      expect(data2.success).toBe(true);
      expect(data2.isNewUser).toBe(true);

      // 3rd Registration
      const res3 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": targetIp,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_seq_user_3@gmail.com" }),
      });
      expect(res3.status).toBe(200);
      const data3 = (await res3.json()) as any;
      expect(data3.success).toBe(true);
      expect(data3.isNewUser).toBe(true);

      // 4th Registration: MUST be rejected with HTTP 429
      const res4 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": targetIp,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_seq_user_4@gmail.com" }),
      });
      expect(res4.status).toBe(429);
      const data4 = (await res4.json()) as any;
      expect(data4.error).toContain("Registration limit exceeded for this IP");
      expect(data4.retryAfter).toBe(86400);

      // Subsequent 5th attempt must also fail with 429
      const res5 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": targetIp,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_seq_user_5@gmail.com" }),
      });
      expect(res5.status).toBe(429);

      // Different IP (198.51.100.2) is independent and MUST succeed
      const resOther = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "198.51.100.2",
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_seq_other_ip@gmail.com" }),
      });
      expect(resOther.status).toBe(200);
      expect(((await resOther.json()) as any).success).toBe(true);
    });

    it("concurrent burst: 4 simultaneous registrations from same IP result in strictly at most 3 successes and at least 1 rejection", async () => {
      const targetIp = "198.51.100.1";
      const browserUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36";

      const requests = [1, 2, 3, 4].map((i) =>
        fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": targetIp,
            "User-Agent": browserUa,
          },
          body: JSON.stringify({ idToken: `mock_google_conc_user_${i}_${Date.now()}@gmail.com` }),
        }),
      );

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);

      const successCount = statuses.filter((s) => s === 200).length;
      const rateLimitCount = statuses.filter((s) => s === 429).length;

      // Invariant: At most 3 accounts may be registered per IP
      expect(successCount).toBeLessThanOrEqual(3);
      expect(rateLimitCount).toBeGreaterThanOrEqual(1);
      expect(successCount + rateLimitCount).toBe(4);

      // Final ledger check: Exactly registered accounts recorded in ledger
      expect(antiSybil.getRegistrationCount(targetIp)).toBeLessThanOrEqual(3);
    });

    it("high-concurrency flood: 10 simultaneous registrations from same IP allow strictly at most 3", async () => {
      const floodIp = "198.51.100.55";
      const browserUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15";

      const floodRequests = Array.from({ length: 10 }, (_, i) =>
        fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": floodIp,
            "User-Agent": browserUa,
          },
          body: JSON.stringify({ idToken: `mock_google_flood_user_${i}_${Date.now()}@gmail.com` }),
        }),
      );

      const floodResponses = await Promise.all(floodRequests);
      const statuses = floodResponses.map((r) => r.status);

      const successes = statuses.filter((s) => s === 200).length;
      const rejections = statuses.filter((s) => s === 429).length;

      expect(successes).toBeLessThanOrEqual(3);
      expect(rejections).toBeGreaterThanOrEqual(7);
      expect(successes + rejections).toBe(10);
    });
  });

  // =========================================================================
  // CHALLENGE 2: Existing User Login Bypass from Rate-Limited IP
  // =========================================================================
  describe("Challenge 2: Existing User Login Bypass from Rate-Limited IP", () => {
    it("existing user logging in from an IP that reached 3 registrations MUST succeed (HTTP 200) and NOT be blocked", async () => {
      const ip = "198.51.100.1";
      const browserUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36";
      const existingUserEmail = "mock_google_existing_veteran_bypass@gmail.com";

      // 1. Register user 1 (the legitimate existing user)
      const reg1 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": ip,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: existingUserEmail }),
      });
      expect(reg1.status).toBe(200);
      const dataReg1 = (await reg1.json()) as any;
      expect(dataReg1.isNewUser).toBe(true);
      const initialKey = dataReg1.rawKey;
      expect(initialKey).toBeDefined();

      // 2. Exhaust registration quota on this IP with 2 more registrations (total 3)
      for (let i = 2; i <= 3; i++) {
        const reg = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": ip,
            "User-Agent": browserUa,
          },
          body: JSON.stringify({ idToken: `mock_google_filler_user_${i}@gmail.com` }),
        });
        expect(reg.status).toBe(200);
      }

      // Verify that new registrations from this IP are now BLOCKED
      const blockedNewReg = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": ip,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_new_attacker@gmail.com" }),
      });
      expect(blockedNewReg.status).toBe(429);

      // 3. Existing user logs in from the exhausted IP: MUST succeed with HTTP 200!
      const loginRes = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": ip,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: existingUserEmail }),
      });

      expect(loginRes.status).toBe(200);
      const loginData = (await loginRes.json()) as any;
      expect(loginData.success).toBe(true);
      expect(loginData.isNewUser).toBe(false);
      expect(loginData.rawKey).toBeDefined();
      expect(loginData.user.tier).toBe("free");

      // 4. Repeated logins by existing user do NOT consume any registration quota
      for (let j = 0; j < 5; j++) {
        const repeatLogin = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": ip,
            "User-Agent": browserUa,
          },
          body: JSON.stringify({ idToken: existingUserEmail }),
        });
        expect(repeatLogin.status).toBe(200);
        const repeatData = (await repeatLogin.json()) as any;
        expect(repeatData.isNewUser).toBe(false);
      }

      // Ledger count remains exactly 3
      expect(antiSybil.getRegistrationCount(ip)).toBe(3);
    });

    it("existing user registered from external IP can log in from a saturated IP", async () => {
      const remoteIp = "203.0.113.99";
      const saturatedIp = "198.51.100.88";
      const remoteEmail = "mock_google_remote_existing@gmail.com";

      // Register on remote IP
      const remoteReg = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": remoteIp,
          "User-Agent": "Mozilla/5.0 Chrome/128.0.0.0",
        },
        body: JSON.stringify({ idToken: remoteEmail }),
      });
      expect(remoteReg.status).toBe(200);

      // Saturate saturatedIp with 3 registrations
      for (let i = 1; i <= 3; i++) {
        const satReg = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": saturatedIp,
            "User-Agent": "Mozilla/5.0 Chrome/128.0.0.0",
          },
          body: JSON.stringify({ idToken: `mock_google_sat_user_${i}@gmail.com` }),
        });
        expect(satReg.status).toBe(200);
      }

      // Remote user logs in from saturatedIp
      const crossIpLogin = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": saturatedIp,
          "User-Agent": "Mozilla/5.0 Chrome/128.0.0.0",
        },
        body: JSON.stringify({ idToken: remoteEmail }),
      });

      expect(crossIpLogin.status).toBe(200);
      const crossData = (await crossIpLogin.json()) as any;
      expect(crossData.success).toBe(true);
      expect(crossData.isNewUser).toBe(false);
    });
  });

  // =========================================================================
  // CHALLENGE 3: Header Precedence Stress (cf-connecting-ip vs x-forwarded-for)
  // =========================================================================
  describe("Challenge 3: Header Precedence Stress", () => {
    it("cf-connecting-ip overrides spoofed x-forwarded-for: rotating x-forwarded-for cannot bypass IP limit", async () => {
      const realAttackerIp = "198.51.100.1";
      const browserUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36";

      // Attacker attempts to spoof x-forwarded-for on each request
      const spoofedIps = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"];

      for (let i = 0; i < 3; i++) {
        const resp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": realAttackerIp,
            "x-forwarded-for": spoofedIps[i],
            "User-Agent": browserUa,
          },
          body: JSON.stringify({ idToken: `mock_google_spoof_user_${i}@gmail.com` }),
        });
        expect(resp.status).toBe(200);
      }

      // 4th request with yet another spoofed IP MUST be rejected because cf-connecting-ip is 198.51.100.1
      const blockedResp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": realAttackerIp,
          "x-forwarded-for": spoofedIps[3],
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_spoof_user_4@gmail.com" }),
      });

      expect(blockedResp.status).toBe(429);
      const body = (await blockedResp.json()) as any;
      expect(body.error).toContain("Registration limit exceeded for this IP");
      expect(antiSybil.getRegistrationCount(realAttackerIp)).toBe(3);
    });

    it("framing defense: attacker spoofing victim's IP in x-forwarded-for does NOT deplete victim's quota", async () => {
      const victimIp = "198.51.100.1";
      const attackerRealIp = "203.0.113.77";
      const browserUa = "Mozilla/5.0 Chrome/128.0.0.0";

      // Attacker sends 3 requests claiming to be victim via x-forwarded-for
      for (let i = 0; i < 3; i++) {
        const resp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": attackerRealIp,
            "x-forwarded-for": victimIp,
            "User-Agent": browserUa,
          },
          body: JSON.stringify({ idToken: `mock_google_frame_user_${i}@gmail.com` }),
        });
        expect(resp.status).toBe(200);
      }

      // Attacker is now blocked
      const attacker4th = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": attackerRealIp,
          "x-forwarded-for": victimIp,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_frame_user_4@gmail.com" }),
      });
      expect(attacker4th.status).toBe(429);

      // BUT Victim IP (198.51.100.1) was NEVER touched and has full 3 registrations available
      expect(antiSybil.getRegistrationCount(victimIp)).toBe(0);

      const victimResp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": victimIp,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_victim_user_1@gmail.com" }),
      });
      expect(victimResp.status).toBe(200);
      expect(antiSybil.getRegistrationCount(victimIp)).toBe(1);
    });
  });

  // =========================================================================
  // CHALLENGE 4: Comma-Separated x-forwarded-for Parsing & Rate-Limiting
  // =========================================================================
  describe("Challenge 4: Comma-Separated x-forwarded-for Parsing", () => {
    it("correctly rate-limits based on client IP '203.0.113.50' from header '203.0.113.50, 10.0.0.1'", async () => {
      const clientIp = "203.0.113.50";
      const browserUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36";

      // Request 1: standard proxy hop
      const r1 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `${clientIp}, 10.0.0.1`,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_xff_user_1@gmail.com" }),
      });
      expect(r1.status).toBe(200);

      // Request 2: multi-hop chain with spaces
      const r2 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `  ${clientIp}  , 10.0.0.2, 172.16.0.1`,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_xff_user_2@gmail.com" }),
      });
      expect(r2.status).toBe(200);

      // Request 3: different internal proxy hop
      const r3 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `${clientIp}, 192.168.1.1`,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_xff_user_3@gmail.com" }),
      });
      expect(r3.status).toBe(200);

      // Request 4: same client IP 203.0.113.50 with another proxy hop MUST be rejected with HTTP 429
      const r4 = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `${clientIp}, 10.0.0.99`,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_xff_user_4@gmail.com" }),
      });
      expect(r4.status).toBe(429);
      const body4 = (await r4.json()) as any;
      expect(body4.error).toContain("Registration limit exceeded for this IP");

      // Verify that the proxy hop IP '10.0.0.1' was NOT rate-limited:
      // A different client IP '203.0.113.51' routed through '10.0.0.1' MUST succeed
      const rOtherClient = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.51, 10.0.0.1",
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_xff_other_client@gmail.com" }),
      });
      expect(rOtherClient.status).toBe(200);
      expect(antiSybil.getRegistrationCount("203.0.113.50")).toBe(3);
      expect(antiSybil.getRegistrationCount("203.0.113.51")).toBe(1);
      expect(antiSybil.getRegistrationCount("10.0.0.1")).toBe(0);
    });

    it("handles Array-formatted x-forwarded-for headers correctly", () => {
      const mockReq = {
        headers: {
          "x-forwarded-for": ["203.0.113.50, 10.0.0.1", "172.16.0.1"],
        },
        socket: { remoteAddress: "127.0.0.1" },
      };
      const extracted = AntiSybilLedger.extractClientIp(mockReq);
      expect(extracted).toBe("203.0.113.50");
    });
  });

  // =========================================================================
  // CHALLENGE 5: Bot Fingerprinting Stress
  // =========================================================================
  describe("Challenge 5: Bot Fingerprinting Stress", () => {
    it("rejects python-requests/2.31.0, curl/8.4.0, aiohttp/3.8.5 with HTTP 429", async () => {
      const botUserAgents = ["python-requests/2.31.0", "curl/8.4.0", "aiohttp/3.8.5"];

      for (const ua of botUserAgents) {
        const resp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": `198.51.100.${Math.floor(100 + Math.random() * 100)}`,
            "User-Agent": ua,
          },
          body: JSON.stringify({
            idToken: `mock_google_bot_${Math.random().toString(36).slice(2, 7)}@gmail.com`,
          }),
        });

        expect(resp.status).toBe(429);
        const data = (await resp.json()) as any;
        expect(data.error).toBe(
          "Automated bot registration rejected. Please use a verified web browser.",
        );
      }
    });

    it("rejects additional bot variations (case insensitivity, custom versions, python-urllib)", async () => {
      const additionalBots = [
        "curl",
        "curl/7.88.1",
        "CURL/8.4.0",
        "Python-Requests/2.31.0",
        "aiohttp/3.9.0b1",
        "python-urllib/3.10",
        "custom-wrapper aiohttp/3.8.5",
        "custom-worker python-requests/2.31.0",
      ];

      for (const ua of additionalBots) {
        const resp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": `198.51.100.${Math.floor(200 + Math.random() * 50)}`,
            "User-Agent": ua,
          },
          body: JSON.stringify({
            idToken: `mock_google_bot_var_${Math.random().toString(36).slice(2, 7)}@gmail.com`,
          }),
        });

        expect(resp.status).toBe(429);
        const data = (await resp.json()) as any;
        expect(data.error).toBe(
          "Automated bot registration rejected. Please use a verified web browser.",
        );
      }
    });

    it("identifies evasion boundary: libcurl/8.4.0 without curl/ prefix evades prefix check", () => {
      // Evasion analysis for challenger report:
      // anti-sybil-ledger checks lower.startsWith('curl/') but not 'libcurl'
      expect(AntiSybilLedger.isBotUserAgent("curl/8.4.0")).toBe(true);
      expect(AntiSybilLedger.isBotUserAgent("libcurl/8.4.0")).toBe(false);
    });

    it("permits standard browser User-Agents without false positives", async () => {
      const legitimateBrowsers = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36",
      ];

      for (let i = 0; i < legitimateBrowsers.length; i++) {
        const resp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": `198.51.100.${50 + i}`,
            "User-Agent": legitimateBrowsers[i],
          },
          body: JSON.stringify({ idToken: `mock_google_browser_user_${i}@gmail.com` }),
        });

        expect(resp.status).toBe(200);
        const data = (await resp.json()) as any;
        expect(data.success).toBe(true);
      }
    });

    it("bot rejections do not consume legitimate IP registration quota", async () => {
      const testIp = "198.51.100.95";
      const browserUa = "Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36";

      // Send 5 rejected bot attempts from this IP
      for (let i = 0; i < 5; i++) {
        const botResp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": testIp,
            "User-Agent": "python-requests/2.31.0",
          },
          body: JSON.stringify({ idToken: `mock_google_bot_attempt_${i}@gmail.com` }),
        });
        expect(botResp.status).toBe(429);
      }

      // Ledger count must still be 0
      expect(antiSybil.getRegistrationCount(testIp)).toBe(0);

      // Now legitimate browser can perform all 3 allowed registrations
      for (let j = 1; j <= 3; j++) {
        const legitimateResp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": testIp,
            "User-Agent": browserUa,
          },
          body: JSON.stringify({ idToken: `mock_google_legit_user_${j}@gmail.com` }),
        });
        expect(legitimateResp.status).toBe(200);
      }

      // 4th legitimate registration now hits rate limit
      const fourthResp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": testIp,
          "User-Agent": browserUa,
        },
        body: JSON.stringify({ idToken: "mock_google_legit_user_4@gmail.com" }),
      });
      expect(fourthResp.status).toBe(429);
      expect(((await fourthResp.json()) as any).error).toContain("Registration limit exceeded");
    });
  });

  // =========================================================================
  // CHALLENGE 6: Web App Gating & Redirect Verification
  // =========================================================================
  describe("Challenge 6: Web App Gating & Domain Isolation", () => {
    it("redirects unauthenticated browser requests targeting app.zencode.vn to zencode.vn with return_to", async () => {
      const endpoints = ["/open-project", "/", "/workspace/my-project"];

      for (const path of endpoints) {
        const resp = await fetch(`${baseUrl}${path}`, {
          headers: {
            Host: "app.zencode.vn",
            "x-forwarded-host": "app.zencode.vn",
          },
          redirect: "manual",
        });

        expect(resp.status).toBe(302);
        const loc = resp.headers.get("location");
        expect(loc).toBe(`https://zencode.vn?login=required&return_to=${encodeURIComponent(path)}`);
      }
    });

    it("allows authenticated access via cookie, Bearer token, or query param ?token=", async () => {
      const created = ledger.createUser({ username: "gating_verified_user", tier: "free" });
      const validToken = created.rawKey;

      // Via Cookie
      const cookieResp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Cookie: `zen_token=${validToken}`,
        },
        redirect: "manual",
      });
      expect(cookieResp.status).toBe(200);

      // Via Bearer Header
      const bearerResp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Authorization: `Bearer ${validToken}`,
        },
        redirect: "manual",
      });
      expect(bearerResp.status).toBe(200);

      // Via Query Param
      const queryResp = await fetch(`${baseUrl}/open-project?token=${validToken}`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });
      expect(queryResp.status).toBe(200);
      expect(queryResp.headers.get("set-cookie")).toContain("zen_token=");
    });

    it("bypasses static files (JS, CSS, Expo assets) and API routes without gating", async () => {
      const unauthenticatedPasses = ["/assets/bundle.js", "/_expo/main.js", "/api/health"];

      for (const p of unauthenticatedPasses) {
        const resp = await fetch(`${baseUrl}${p}`, {
          headers: {
            Host: "app.zencode.vn",
            "x-forwarded-host": "app.zencode.vn",
          },
          redirect: "manual",
        });
        expect(resp.status).toBe(200);
      }
    });

    it("does not gate non-app domains (zencode.vn, localhost)", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "zencode.vn",
          "x-forwarded-host": "zencode.vn",
        },
        redirect: "manual",
      });
      expect(resp.status).toBe(200);
    });
  });

  // =========================================================================
  // CHALLENGE 7: Sovereign Stealth Mode Invariant Audit
  // =========================================================================
  describe("Challenge 7: Sovereign Stealth Mode Invariants", () => {
    it("strictly zero outbound network requests to third-party telemetry during anti-sybil checks", async () => {
      const outboundLeaks: string[] = [];
      const originalFetch = globalThis.fetch;

      const spiedFetch = vi.fn().mockImplementation((input: any, init: any) => {
        const url = typeof input === "string" ? input : input?.url || String(input);
        if (
          url.includes("googleapis.com") ||
          url.includes("segment.io") ||
          url.includes("sentry.io") ||
          url.includes("anthropic.com")
        ) {
          outboundLeaks.push(url);
          throw new Error(`CRITICAL STEALTH BREACH: Prohibited outbound request to: ${url}`);
        }
        return originalFetch(input, init);
      });
      globalThis.fetch = spiedFetch;

      try {
        // Run full cycle: registration, anti-sybil check, and existing user check
        const authRes = await service.authenticate(
          "mock_google_stealth_user@gmail.com",
          "198.51.100.1",
        );
        expect(authRes.success).toBe(true);

        const checkRes = antiSybil.checkRegistration("198.51.100.1", "Mozilla/5.0");
        expect(checkRes.allowed).toBe(true);

        const isExist = service.isExistingUser("mock_google_stealth_user@gmail.com");
        expect(isExist).toBe(true);

        // Assert 0 outbound telemetry calls
        expect(outboundLeaks).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
