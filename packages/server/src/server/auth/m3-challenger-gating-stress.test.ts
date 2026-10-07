import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { ZencodeDatabase } from "../db/database.js";
import { UserKeyLedger } from "./user-key-ledger.js";
import { createWebAppGatingMiddleware } from "../web-app-gating.js";

describe("Challenger 2 Empirical Stress Test: Milestone M3 Web App Gating Router", () => {
  const testDir = join(
    "/tmp",
    `m3_challenger_gating_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  );
  const dbPath = join(testDir, "test_challenger_m3.db");
  let db: ZencodeDatabase;
  let ledger: UserKeyLedger;
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    db = new ZencodeDatabase({ dbPath });
    ledger = new UserKeyLedger({ storageDir: testDir });

    app = express();
    app.use(express.json());

    // Mount Web App Gating Middleware
    app.use(createWebAppGatingMiddleware({ userLedger: ledger, db }));

    // Downstream handlers for verifying pass-through (next())
    app.get("/", (_req, res) => {
      res.status(200).send("PASS: Root Web App");
    });
    app.get("/open-project", (_req, res) => {
      res.status(200).send("PASS: Workspace Open Project");
    });
    app.get("/dashboard", (_req, res) => {
      res.status(200).send("PASS: User Dashboard");
    });

    // Static assets endpoints
    app.get("/_expo/static/js/bundle.js", (_req, res) => {
      res.setHeader("Content-Type", "application/javascript");
      res.status(200).send("console.log('expo bundle');");
    });
    app.get("/assets/logo.png", (_req, res) => {
      res.setHeader("Content-Type", "image/png");
      res.status(200).send(Buffer.from("fake-png-data"));
    });
    app.get("/styles.css", (_req, res) => {
      res.setHeader("Content-Type", "text/css");
      res.status(200).send("body { margin: 0; }");
    });
    app.get("/favicon.ico", (_req, res) => {
      res.setHeader("Content-Type", "image/x-icon");
      res.status(200).send("icon");
    });
    app.get("/manifest.json", (_req, res) => {
      res.status(200).json({ name: "Zencode Web App" });
    });
    app.get("/bundle.js.map", (_req, res) => {
      res.status(200).send("sourcemap");
    });
    app.get("/fonts/inter.woff2", (_req, res) => {
      res.setHeader("Content-Type", "font/woff2");
      res.status(200).send("font-data");
    });
    app.get("/images/hero.webp", (_req, res) => {
      res.setHeader("Content-Type", "image/webp");
      res.status(200).send("webp-data");
    });
    app.get("/icons/app.svg", (_req, res) => {
      res.setHeader("Content-Type", "image/svg+xml");
      res.status(200).send("<svg></svg>");
    });

    // API endpoints
    app.get("/api/health", (_req, res) => {
      res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
    });
    app.get("/api/billing/plans", (_req, res) => {
      res.status(200).json({ plans: ["free", "pro", "enterprise"] });
    });
    app.post("/api/fleet/auth/oauth/google", (req, res) => {
      res.status(200).json({ status: "ok", received: req.body });
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
  // Mission Target 1: Unauthenticated access on app.zencode.vn
  // =========================================================================
  describe("Target 1: Unauthenticated access gating on app.zencode.vn", () => {
    it("GET '/' without credentials MUST return HTTP 302 redirect with Location https://zencode.vn?login=required&return_to=%2F", async () => {
      const resp = await fetch(`${baseUrl}/`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe("https://zencode.vn?login=required&return_to=%2F");
    });

    it("GET '/open-project' without credentials MUST return HTTP 302 redirect with Location https://zencode.vn?login=required&return_to=%2Fopen-project", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe(
        "https://zencode.vn?login=required&return_to=%2Fopen-project",
      );
    });

    it("GET '/dashboard' without credentials MUST return HTTP 302 redirect with Location https://zencode.vn?login=required&return_to=%2Fdashboard", async () => {
      const resp = await fetch(`${baseUrl}/dashboard`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe(
        "https://zencode.vn?login=required&return_to=%2Fdashboard",
      );
    });

    it("preserves URL query parameters in return_to when redirecting unauthenticated requests", async () => {
      const targetPath = "/open-project?workspace=demo&theme=dark";
      const resp = await fetch(`${baseUrl}${targetPath}`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      const expectedLocation = `https://zencode.vn?login=required&return_to=${encodeURIComponent(targetPath)}`;
      expect(resp.headers.get("location")).toBe(expectedLocation);
    });

    it("handles Host with explicit port (app.zencode.vn:6768 or app.zencode.vn:443)", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn:6768",
          "x-forwarded-host": "app.zencode.vn:6768",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe(
        "https://zencode.vn?login=required&return_to=%2Fopen-project",
      );
    });

    it("handles case-insensitive host header (APP.ZENCODE.VN)", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "APP.ZENCODE.VN",
          "x-forwarded-host": "APP.ZENCODE.VN",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe(
        "https://zencode.vn?login=required&return_to=%2Fopen-project",
      );
    });
  });

  // =========================================================================
  // Mission Target 2: Authenticated access on app.zencode.vn
  // =========================================================================
  describe("Target 2: Authenticated access on app.zencode.vn", () => {
    it("GET '/open-project' with 'Cookie: zen_token=<valid_token>' MUST return HTTP 200 / pass through", async () => {
      const user = ledger.createUser({ username: "cookie_auth_user", tier: "free" });
      const validToken = user.rawKey;

      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Cookie: `zen_token=${validToken}`,
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: Workspace Open Project");
    });

    it("GET '/open-project' with 'Authorization: Bearer <valid_token>' MUST return HTTP 200 / pass through", async () => {
      const user = ledger.createUser({ username: "bearer_auth_user", tier: "free" });
      const validToken = user.rawKey;

      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Authorization: `Bearer ${validToken}`,
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: Workspace Open Project");
    });

    it("GET '/open-project?token=<valid_token>' MUST set 'Set-Cookie: zen_token=...' and return HTTP 200 / pass through", async () => {
      const user = ledger.createUser({ username: "query_auth_user", tier: "free" });
      const validToken = user.rawKey;

      const resp = await fetch(`${baseUrl}/open-project?token=${validToken}`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: Workspace Open Project");

      const setCookie = resp.headers.get("set-cookie");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain(`zen_token=${validToken}`);
      expect(setCookie).toContain("Domain=.zencode.vn");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Lax");
    });

    it("handles cookie embedded among multiple other cookies and with whitespace", async () => {
      const user = ledger.createUser({ username: "multi_cookie_user", tier: "free" });
      const validToken = user.rawKey;

      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Cookie: `session_id=12345; zen_token=${validToken}; theme=dark; ga_client=xyz`,
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: Workspace Open Project");
    });

    it("validates token against SQLite database when in-memory ledger entry is absent", async () => {
      const user = ledger.createUser({ username: "db_fallback_user", tier: "free" });
      const validToken = user.rawKey;
      const userRecord = ledger.findUserByToken(validToken);
      expect(userRecord).toBeDefined();
      // Seed user in database using db.upsertUserAndQuotas
      db.upsertUserAndQuotas(userRecord!);

      // Clear ledger from memory to test DB fallback
      ledger.destroy();
      ledger = new UserKeyLedger({ storageDir: join(testDir, "fresh_empty_ledger") });

      // Re-create app middleware with the empty ledger but populated db
      const freshApp = express();
      freshApp.use(createWebAppGatingMiddleware({ userLedger: ledger, db }));
      freshApp.get("/open-project", (_req, res) => res.status(200).send("PASS: DB Fallback"));

      const freshServer = http.createServer(freshApp);
      await new Promise<void>((resolve) => freshServer.listen(0, resolve));
      const freshUrl = `http://127.0.0.1:${(freshServer.address() as any).port}`;

      try {
        const resp = await fetch(`${freshUrl}/open-project`, {
          headers: {
            Host: "app.zencode.vn",
            "x-forwarded-host": "app.zencode.vn",
            Cookie: `zen_token=${validToken}`,
          },
          redirect: "manual",
        });

        expect(resp.status).toBe(200);
        const body = await resp.text();
        expect(body).toBe("PASS: DB Fallback");
      } finally {
        await new Promise<void>((resolve) => freshServer.close(() => resolve()));
      }
    });
  });

  // =========================================================================
  // Mission Target 3: Invalid token access
  // =========================================================================
  describe("Target 3: Invalid or expired token rejection", () => {
    it("GET '/open-project' with invalid/unrecognized token MUST return HTTP 302 redirect", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Cookie: "zen_token=zen_live_invalid_nonexistent_token_12345",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe(
        "https://zencode.vn?login=required&return_to=%2Fopen-project",
      );
    });

    it("GET '/open-project' with expired/revoked Bearer token MUST return HTTP 302 redirect", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Authorization: "Bearer expired_or_malformed_token_xyz",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe(
        "https://zencode.vn?login=required&return_to=%2Fopen-project",
      );
    });

    it("GET '/open-project?token=invalid' MUST return HTTP 302 redirect and NOT set cookie", async () => {
      const resp = await fetch(`${baseUrl}/open-project?token=invalid_query_token_999`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toContain("https://zencode.vn?login=required");
      expect(resp.headers.get("set-cookie")).toBeNull();
    });

    it("rejects suspended user token with HTTP 302 redirect", async () => {
      const user = ledger.createUser({ username: "suspended_user", tier: "free" });
      const validToken = user.rawKey;

      // Mark user account status as suspended
      const account = ledger.findUserByToken(validToken);
      expect(account).toBeDefined();
      if (account) {
        account.status = "suspended";
      }

      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Cookie: `zen_token=${validToken}`,
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe(
        "https://zencode.vn?login=required&return_to=%2Fopen-project",
      );
    });

    it("rejects revoked user token with HTTP 302 redirect", async () => {
      const user = ledger.createUser({ username: "revoked_user", tier: "free" });
      const validToken = user.rawKey;

      // Revoke user via ledger API
      const revoked = ledger.revokeUser(user.user.id);
      expect(revoked).toBe(true);

      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
          Authorization: `Bearer ${validToken}`,
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe(
        "https://zencode.vn?login=required&return_to=%2Fopen-project",
      );
    });

    it("handles adversarial injection payloads gracefully and redirects 302", async () => {
      const maliciousPayloads = [
        "' OR '1'='1",
        "../../etc/passwd",
        "<script>alert(1)</script>",
        "Bearer",
        "!@#$%^&*()_+{}[]:;\"'<>?,.",
      ];

      for (const payload of maliciousPayloads) {
        const resp = await fetch(`${baseUrl}/open-project`, {
          headers: {
            Host: "app.zencode.vn",
            "x-forwarded-host": "app.zencode.vn",
            Authorization: `Bearer ${payload}`,
          },
          redirect: "manual",
        });

        expect(resp.status).toBe(302);
        expect(resp.headers.get("location")).toContain("https://zencode.vn?login=required");
      }
    });
  });

  // =========================================================================
  // Mission Target 4: Static assets bypass
  // =========================================================================
  describe("Target 4: Static assets bypass on app.zencode.vn", () => {
    it("GET '/_expo/static/js/bundle.js' MUST pass through without 302 redirect", async () => {
      const resp = await fetch(`${baseUrl}/_expo/static/js/bundle.js`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("console.log('expo bundle');");
    });

    it("GET '/assets/logo.png' MUST pass through without 302 redirect", async () => {
      const resp = await fetch(`${baseUrl}/assets/logo.png`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      expect(resp.headers.get("content-type")).toBe("image/png");
    });

    it("GET '/styles.css' MUST pass through without 302 redirect", async () => {
      const resp = await fetch(`${baseUrl}/styles.css`, {
        headers: {
          Host: "app.zencode.vn",
          "x-forwarded-host": "app.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("body { margin: 0; }");
    });

    it("bypasses other static file types (ico, json, map, woff2, webp, svg)", async () => {
      const staticAssets = [
        { path: "/favicon.ico", expectedStatus: 200 },
        { path: "/manifest.json", expectedStatus: 200 },
        { path: "/bundle.js.map", expectedStatus: 200 },
        { path: "/fonts/inter.woff2", expectedStatus: 200 },
        { path: "/images/hero.webp", expectedStatus: 200 },
        { path: "/icons/app.svg", expectedStatus: 200 },
      ];

      for (const asset of staticAssets) {
        const resp = await fetch(`${baseUrl}${asset.path}`, {
          headers: {
            Host: "app.zencode.vn",
            "x-forwarded-host": "app.zencode.vn",
          },
          redirect: "manual",
        });

        expect(resp.status).toBe(asset.expectedStatus);
      }
    });

    it("bypasses '/api/*' routes on app.zencode.vn without redirect", async () => {
      const apiEndpoints = ["/api/health", "/api/billing/plans"];

      for (const ep of apiEndpoints) {
        const resp = await fetch(`${baseUrl}${ep}`, {
          headers: {
            Host: "app.zencode.vn",
            "x-forwarded-host": "app.zencode.vn",
          },
          redirect: "manual",
        });

        expect(resp.status).toBe(200);
      }
    });
  });

  // =========================================================================
  // Mission Target 5: Non-app host bypass
  // =========================================================================
  describe("Target 5: Non-app host bypass", () => {
    it("accessing '/open-project' with host 'api.zencode.vn' MUST NOT trigger web app gating redirect", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "api.zencode.vn",
          "x-forwarded-host": "api.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: Workspace Open Project");
    });

    it("accessing '/open-project' with host 'localhost' MUST NOT trigger web app gating redirect", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "localhost",
          "x-forwarded-host": "localhost",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: Workspace Open Project");
    });

    it("accessing '/open-project' with host 'localhost:6768' MUST NOT trigger web app gating redirect", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "localhost:6768",
          "x-forwarded-host": "localhost:6768",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: Workspace Open Project");
    });

    it("accessing '/open-project' with marketing host 'zencode.vn' MUST NOT trigger web app gating redirect", async () => {
      const resp = await fetch(`${baseUrl}/open-project`, {
        headers: {
          Host: "zencode.vn",
          "x-forwarded-host": "zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: Workspace Open Project");
    });

    it("accessing '/dashboard' with host 'api.zencode.vn' MUST NOT trigger web app gating redirect", async () => {
      const resp = await fetch(`${baseUrl}/dashboard`, {
        headers: {
          Host: "api.zencode.vn",
          "x-forwarded-host": "api.zencode.vn",
        },
        redirect: "manual",
      });

      expect(resp.status).toBe(200);
      const body = await resp.text();
      expect(body).toBe("PASS: User Dashboard");
    });
  });

  // =========================================================================
  // Target 6: Sovereign Stealth Invariant Verification
  // =========================================================================
  describe("Target 6: Sovereign Stealth Invariant Verification", () => {
    it("ensures zero outbound network requests during gating check and session validation", async () => {
      const outboundCalls: string[] = [];

      const originalFetch = globalThis.fetch;
      const fetchSpy = vi.fn().mockImplementation((input: any, init: any) => {
        const url = typeof input === "string" ? input : input?.url || String(input);
        if (
          url.includes("googleapis.com") ||
          url.includes("segment.io") ||
          url.includes("sentry.io") ||
          url.includes("anthropic.com")
        ) {
          outboundCalls.push(url);
          throw new Error(
            `CRITICAL INVARIANT VIOLATION: Outbound telemetry attempt detected: ${url}`,
          );
        }
        return originalFetch(input, init);
      });
      globalThis.fetch = fetchSpy;

      try {
        const user = ledger.createUser({ username: "stealth_gating_user", tier: "free" });
        const validToken = user.rawKey;

        // Perform requests
        await fetch(`${baseUrl}/open-project`, {
          headers: {
            Host: "app.zencode.vn",
            "x-forwarded-host": "app.zencode.vn",
            Cookie: `zen_token=${validToken}`,
          },
        });

        await fetch(`${baseUrl}/open-project`, {
          headers: {
            Host: "app.zencode.vn",
            "x-forwarded-host": "app.zencode.vn",
            Cookie: "zen_token=bad_token",
          },
          redirect: "manual",
        });

        await fetch(`${baseUrl}/_expo/static/js/bundle.js`, {
          headers: { Host: "app.zencode.vn", "x-forwarded-host": "app.zencode.vn" },
        });

        expect(outboundCalls).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
