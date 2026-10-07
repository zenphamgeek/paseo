import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { ZencodeDatabase } from "../db/database.js";
import { GoogleOAuthService } from "./google-oauth-service.js";
import { UserKeyLedger } from "./user-key-ledger.js";
import { AntiSybilLedger, getAntiSybilLedger } from "./anti-sybil-ledger.js";
import { createWebAppGatingMiddleware } from "../web-app-gating.js";

describe("Milestone 3: Web App Gating Router & Anti-Sybil Defense Engine", () => {
  const testDir = join(
    "/tmp",
    `m3_gating_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  );
  const dbPath = join(testDir, "test_m3.db");
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
      clientId: "test-client-id.apps.googleusercontent.com",
    });

    app = express();
    app.use(express.json());

    // 1. Web App Gating Middleware
    app.use(createWebAppGatingMiddleware({ userLedger: ledger, db }));

    // 2. Google OAuth Route (replicating bootstrap.ts)
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

    // 3. Mock Web UI & Static Endpoints to verify next() calls
    app.get("/open-project", (_req, res) => {
      res.status(200).send("<html><body>Zencode IDE Workspace</body></html>");
    });
    app.get("/", (_req, res) => {
      res.status(200).send("<html><body>Zencode IDE Root</body></html>");
    });
    app.get("/assets/main.js", (_req, res) => {
      res.setHeader("Content-Type", "application/javascript");
      res.status(200).send("console.log('main bundle');");
    });
    app.get("/_expo/index.js", (_req, res) => {
      res.setHeader("Content-Type", "application/javascript");
      res.status(200).send("console.log('expo bundle');");
    });
    app.get("/styles.css", (_req, res) => {
      res.setHeader("Content-Type", "text/css");
      res.status(200).send("body { background: #000; }");
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
  // Test Suite 1: Client IP Extraction Prioritization
  // =========================================================================
  describe("Client IP Extraction Logic", () => {
    it("prioritizes cf-connecting-ip over x-forwarded-for and socket remoteAddress", () => {
      const mockReq = {
        headers: {
          "cf-connecting-ip": "103.21.244.15",
          "x-forwarded-for": "198.51.100.99, 10.244.0.1",
        },
        socket: { remoteAddress: "127.0.0.1" },
      };
      const ip = AntiSybilLedger.extractClientIp(mockReq);
      expect(ip).toBe("103.21.244.15");
    });

    it("extracts first client IP before comma in x-forwarded-for when cf-connecting-ip is absent", () => {
      const mockReq = {
        headers: {
          "x-forwarded-for": "203.0.113.195, 10.244.0.1, 192.168.1.1",
        },
        socket: { remoteAddress: "127.0.0.1" },
      };
      const ip = AntiSybilLedger.extractClientIp(mockReq);
      expect(ip).toBe("203.0.113.195");
    });

    it("falls back to socket remoteAddress when proxy headers are absent", () => {
      const mockReq = {
        headers: {},
        socket: { remoteAddress: "192.168.10.42" },
      };
      const ip = AntiSybilLedger.extractClientIp(mockReq);
      expect(ip).toBe("192.168.10.42");
    });

    it("extracts CIDR subnets correctly for IPv4 and IPv6", () => {
      expect(AntiSybilLedger.extractSubnet("103.21.244.15")).toBe("103.21.244.0/24");
      expect(AntiSybilLedger.extractSubnet("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(
        "2001:0db8:85a3::/48",
      );
    });
  });

  // =========================================================================
  // Test Suite 2: Anti-Sybil Rate Limiting & Bot Fingerprinting
  // =========================================================================
  describe("Anti-Sybil Defense & Registration Rate Limiting", () => {
    it("permits 1st, 2nd, 3rd registrations from same IP, but strictly rejects 4th attempt with HTTP 429", async () => {
      const clientIp = "198.51.100.77";

      for (let i = 1; i <= 3; i++) {
        const resp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": clientIp,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({
            idToken: `mock_google_rate_limit_user_${i}@gmail.com`,
          }),
        });

        expect(resp.status).toBe(200);
        const data = (await resp.json()) as any;
        expect(data.success).toBe(true);
        expect(data.isNewUser).toBe(true);
        expect(data.user.tier).toBe("free");
      }

      // 4th registration attempt from the same IP must be rejected with HTTP 429
      const fourthResp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": clientIp,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          idToken: "mock_google_rate_limit_user_4@gmail.com",
        }),
      });

      expect(fourthResp.status).toBe(429);
      const fourthData = (await fourthResp.json()) as any;
      expect(fourthData.error).toBe(
        "Registration limit exceeded for this IP. Maximum 3 accounts per IP per day.",
      );
      expect(fourthData.retryAfter).toBe(86400);
    });

    it("allows existing users from same IP to log in without counting against registration rate limit", async () => {
      const clientIp = "198.51.100.88";

      // 1. Register an existing user
      const regResp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": clientIp,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          idToken: "mock_google_existing_veteran@gmail.com",
        }),
      });
      expect(regResp.status).toBe(200);

      // 2. Exhaust the remaining 2 registration slots
      for (let i = 2; i <= 3; i++) {
        const resp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": clientIp,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({
            idToken: `mock_google_sybil_filler_${i}@gmail.com`,
          }),
        });
        expect(resp.status).toBe(200);
      }

      // Registration limit is now reached (3/3)
      // A new user attempt is rejected:
      const newAttempt = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": clientIp,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          idToken: "mock_google_sybil_filler_4@gmail.com",
        }),
      });
      expect(newAttempt.status).toBe(429);

      // But the EXISTING user can still log in successfully!
      const loginResp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": clientIp,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          idToken: "mock_google_existing_veteran@gmail.com",
        }),
      });

      expect(loginResp.status).toBe(200);
      const loginData = (await loginResp.json()) as any;
      expect(loginData.success).toBe(true);
      expect(loginData.isNewUser).toBe(false);
      expect(loginData.rawKey).toBeDefined();
    });

    it("rejects automated bot User-Agents (python-requests, curl, aiohttp) with HTTP 429", async () => {
      const botUserAgents = [
        "python-requests/2.31.0",
        "curl/7.88.1",
        "aiohttp/3.8.5",
        "python-requests/2.28.1 (Custom Bot)",
      ];

      for (const ua of botUserAgents) {
        const resp = await fetch(`${baseUrl}/api/fleet/auth/oauth/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": `203.0.113.${Math.floor(10 + Math.random() * 80)}`,
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
  });

  // =========================================================================
  // Test Suite 3: Web App Gating Router Middleware
  // =========================================================================
  describe("Web App Gating Router Middleware", () => {
    it("redirects unauthenticated browser GET on app.zencode.vn/open-project to zencode.vn with return_to", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      const location = resp.headers.get("location");
      expect(location).toBe("https://zencode.vn?login=required&return_to=%2Fopen-project");
    });

    it("redirects unauthenticated browser GET on app.zencode.vn/ to zencode.vn with return_to=%2F", async () => {
      const resp = await fetch(`${baseUrl}/`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      const location = resp.headers.get("location");
      expect(location).toBe("https://zencode.vn?login=required&return_to=%2F");
    });

    it("allows authenticated GET on app.zencode.vn/open-project via cookie 'zen_token'", async () => {
      // Create user and token in ledger
      const reg = ledger.createUser({ username: "cookie_user", tier: "free" });
      const validToken = reg.rawKey;

      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Cookie: `zen_token=${validToken}`,
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("Zencode IDE Workspace");
    });

    it("allows authenticated GET on app.zencode.vn/open-project via 'Authorization: Bearer <token>'", async () => {
      const reg = ledger.createUser({ username: "bearer_user", tier: "free" });
      const validToken = reg.rawKey;

      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Authorization: `Bearer ${validToken}`,
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("Zencode IDE Workspace");
    });

    it("allows authenticated GET on app.zencode.vn/open-project via query param '?token=<token>' and sets cookie", async () => {
      const reg = ledger.createUser({ username: "query_user", tier: "free" });
      const validToken = reg.rawKey;

      const resp = await fetch(`${baseUrl}/open-project?token=${validToken}`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const setCookie = resp.headers.get("set-cookie");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("zen_token=");
    });

    it("rejects expired or invalid tokens with HTTP 302 redirect", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Cookie: "zen_token=zen_live_dev_bogus_invalid_token",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toContain("https://zencode.vn?login=required");
    });

    it("always bypasses static assets (/_expo/*, /assets/*, .js, .css) without authentication redirect", async () => {
      const staticPaths = ["/assets/main.js", "/_expo/index.js", "/styles.css"];

      for (const p of staticPaths) {
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

    it("always bypasses /api/* routes without gating redirect", async () => {
      const resp = await fetch(`${baseUrl}/api/health`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const data = (await resp.json()) as any;
      expect(data.status).toBe("healthy");
    });

    it("does not gate requests targeting non-app domains (zencode.vn, api.zencode.vn, localhost)", async () => {
      const nonAppHosts = ["zencode.vn", "api.zencode.vn", "localhost"];

      for (const host of nonAppHosts) {
        const resp = await fetch(`${baseUrl}/open-project`, {
          headers: {
            Host: host,
            "x-forwarded-host": host,
          },
          redirect: "manual",
        });

        expect(resp.status).toBe(200);
      }
    });
  });

  // =========================================================================
  // Test Suite 4: Sovereign Stealth Invariant Verification
  // =========================================================================
  describe("Sovereign Stealth Mode Invariants", () => {
    it("preserves zero outbound telemetry during token verification and rate limiting", async () => {
      const outboundRequests: string[] = [];

      // Intercept and monitor global fetch
      const originalFetch = globalThis.fetch;
      const fetchSpy = vi.fn().mockImplementation((input: any, init: any) => {
        const url = typeof input === "string" ? input : input?.url || String(input);
        if (
          url.includes("googleapis.com") ||
          url.includes("segment.io") ||
          url.includes("sentry.io")
        ) {
          outboundRequests.push(url);
          throw new Error(
            `CRITICAL INVARIANT VIOLATION: Outbound telemetry attempt detected: ${url}`,
          );
        }
        return originalFetch(input, init);
      });
      globalThis.fetch = fetchSpy;

      try {
        // Authenticate new user
        const result = await service.authenticate(
          "mock_google_stealth_check@gmail.com",
          "198.51.100.99",
        );
        expect(result.success).toBe(true);

        // Run anti-sybil check
        const check = antiSybil.checkRegistration("198.51.100.99", "Mozilla/5.0");
        expect(check.allowed).toBe(true);

        // Verify zero outbound calls
        expect(outboundRequests).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
