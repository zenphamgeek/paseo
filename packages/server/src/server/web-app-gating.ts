import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import type { UserKeyLedger } from "./auth/user-key-ledger.js";
import { UserKeyLedger as UserKeyLedgerClass } from "./auth/user-key-ledger.js";
import type { ZencodeDatabase } from "./db/database.js";

const STATIC_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".json",
  ".map",
  ".webp",
]);

export interface WebAppGatingOptions {
  userLedger: UserKeyLedger;
  db?: ZencodeDatabase;
  logger?: Logger;
}

/**
 * Creates Express middleware for Web App Gating on app.zencode.vn.
 *
 * Rules:
 * 1. Only applies when host starts with 'app.zencode.vn' (or 'app.' for staging/dev).
 * 2. Always bypasses /api/* routes.
 * 3. Always bypasses static assets (/_expo/*, /assets/*, .js, .css, images, fonts, etc.).
 * 4. For HTML navigation requests (e.g. '/', '/open-project'):
 *    - Validates session token from cookie 'zen_token', 'Authorization: Bearer <token>', or query '?token=<token>'.
 *    - If authenticated: sets 'zen_token' cookie if provided via query param, calls next().
 *    - If unauthenticated or token invalid/missing: returns HTTP 302 redirect to:
 *      https://zencode.vn?login=required&return_to=${encodeURIComponent(req.originalUrl || "/open-project")}
 */
export function createWebAppGatingMiddleware(options: WebAppGatingOptions) {
  const { userLedger, db, logger } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const rawHost = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
    const host = rawHost.toLowerCase();
    const isAppHost = host.startsWith("app.zencode.vn") || host.startsWith("app.");

    // Rule 1: Non-app domains (zencode.vn, api.zencode.vn, localhost) bypass gating
    if (!isAppHost) {
      return next();
    }

    const pathname = req.path || req.url || "/";

    // Rule 2: Always bypass /api/* routes
    if (pathname.startsWith("/api/") || pathname === "/api") {
      return next();
    }

    // Rule 3: Always bypass static asset paths
    if (pathname.startsWith("/_expo/") || pathname.startsWith("/assets/")) {
      return next();
    }

    // Always bypass files with static extensions
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot !== -1) {
      const ext = pathname.slice(lastDot).toLowerCase();
      if (STATIC_EXTENSIONS.has(ext)) {
        return next();
      }
    }

    // Rule 4: Authentication check for HTML navigation requests
    let token: string | null = null;
    let isFromQuery = false;

    // A. Check cookie 'zen_token'
    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader === "string") {
      const match = cookieHeader.match(/(?:^|;\s*)zen_token=([^;]+)/);
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    }
    if (!token && (req as any).cookies?.zen_token) {
      token = (req as any).cookies.zen_token;
    }

    // B. Check Authorization: Bearer <token>
    if (!token) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7).trim();
      }
    }

    // C. Check query parameter '?token=<token>'
    if (!token && typeof req.query?.token === "string" && req.query.token.trim()) {
      token = req.query.token.trim();
      isFromQuery = true;
    }

    // Validate token against userLedger and database
    if (token) {
      let user = userLedger.findUserByToken(token);

      if (!user && db) {
        try {
          const keyHash = UserKeyLedgerClass.hashToken(token);
          const row = (db as any).db
            ?.prepare("SELECT id FROM users WHERE key_hash = ?")
            .get(keyHash) as { id: string } | undefined;
          if (row) {
            user = db.getUserById(row.id) as any;
          }
        } catch {
          // ignore DB error
        }
      }

      if (user && user.status === "active") {
        // If authenticated via query parameter, set cookie for future navigations
        if (isFromQuery) {
          const isProd = host.includes("zencode.vn");
          if (typeof res.cookie === "function") {
            res.cookie("zen_token", token, {
              domain: isProd ? ".zencode.vn" : undefined,
              path: "/",
              httpOnly: true,
              secure: isProd,
              sameSite: "lax",
              maxAge: 30 * 24 * 60 * 60 * 1000,
            });
          }
        }
        return next();
      }
    }

    // Unauthenticated or invalid token: Redirect to Landing Page with return_to
    const targetUrl = req.originalUrl || req.url || "/open-project";
    const returnUrl = encodeURIComponent(targetUrl);
    const redirectLocation = `https://zencode.vn?login=required&return_to=${returnUrl}`;

    logger?.debug(
      { host, pathname, targetUrl },
      "Web App Gating: Redirecting unauthenticated visitor to landing page",
    );
    return res.redirect(302, redirectLocation);
  };
}
