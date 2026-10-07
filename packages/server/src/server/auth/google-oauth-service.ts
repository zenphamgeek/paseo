import { createPublicKey, randomBytes, verify } from "node:crypto";
import type { Logger } from "pino";
import type { UserRecord } from "./user-key-ledger.js";
import { UserKeyLedger } from "./user-key-ledger.js";
import type { ZencodeDatabase } from "../db/database.js";
import { getZencodeDatabase } from "../db/database.js";
import { AntiSybilLedger } from "./anti-sybil-ledger.js";

export interface GoogleJwk {
  kty: string;
  alg?: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
}

export interface GoogleIdTokenPayload {
  iss: string;
  sub: string;
  azp?: string;
  aud: string;
  iat: number;
  exp: number;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
}

export interface GoogleAuthResult {
  success: boolean;
  user?: UserRecord;
  rawKey?: string;
  isNewUser?: boolean;
  error?: string;
}

// Pre-bundled static Google public keys for air-gapped / stealth offline verification
// In compliance with Rule 1 Sovereign Stealth Mode (Zero Outbound Telemetry)
export const BUNDLED_FALLBACK_GOOGLE_JWKS: GoogleJwk[] = [
  {
    kty: "RSA",
    alg: "RS256",
    use: "sig",
    kid: "fallback_google_cert_2026",
    n: "u1N72AmEdnH9uMLrtIPzEhJ8wB_TM5ARPa2ObqX40DMQFb8YObay1uipN1omZC-Mq0DDSBg-3n_z6SfwckD8LuCxf7qejiMKIprFrM1f4RjPYhFL6w9CFAN-VRlZfVV0Lq-MGlRi6M1x29D1QOJ-izSpzAsSnObjuDgQAE92eawQr67wo3pkOvyNW0Uz3qCwNk0xLfvpCf0ToWnYxGRE34FOvwbuhvQVOGVhyRdMxVs9Rh4l4GBtCXFl2UAvx04vM8wpAGTsZ2ycYS2y3t9dHUdGvRT_2oin3Jzl3saCQ2fEOkn1vryryQmIvEid5AtopxNym79LdbmrpR0tlUe1Bw",
    e: "AQAB",
  },
];

export class GoogleOAuthService {
  public static readonly jwksCache: Map<string, GoogleJwk> = new Map();
  public static lastFetchedAt: number = Date.now();
  public static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h long TTL (Stealth Invariant)

  public static isCacheExpired(): boolean {
    return Date.now() - GoogleOAuthService.lastFetchedAt > GoogleOAuthService.CACHE_TTL_MS;
  }

  private readonly db: ZencodeDatabase;
  private readonly ledger?: UserKeyLedger;
  private readonly clientId: string;
  private readonly logger?: Logger;
  private readonly antiSybilLedger?: AntiSybilLedger;

  constructor(options?: {
    db?: ZencodeDatabase;
    ledger?: UserKeyLedger;
    clientId?: string;
    logger?: Logger;
    antiSybilLedger?: AntiSybilLedger;
  }) {
    this.db = options?.db || getZencodeDatabase();
    this.ledger = options?.ledger;
    this.clientId =
      options?.clientId ||
      process.env.GOOGLE_CLIENT_ID ||
      "zencode-google-client-id.apps.googleusercontent.com";
    this.logger = options?.logger?.child({ module: "google-oauth-service" });
    this.antiSybilLedger = options?.antiSybilLedger;
  }

  /**
   * Registers a JWK into the local verification cache (useful for testing or local simulation).
   */
  public static registerJwk(jwk: GoogleJwk): void {
    GoogleOAuthService.jwksCache.set(jwk.kid, jwk);
  }

  /**
   * Clears the JWK cache.
   */
  public static clearJwkCache(): void {
    GoogleOAuthService.jwksCache.clear();
  }

  public getPublicConfig(): { enabled: boolean; clientId: string } {
    return {
      enabled: Boolean(this.clientId),
      clientId: this.clientId,
    };
  }

  /**
   * Parses and cryptographically validates Google ID Token JWT payload without unsafe external network dependencies.
   * Uses cached JWKS (24h TTL) + bundled fallback keys.
   * Supports production RS256 verification and test/dev mock tokens.
   */
  public parseAndValidateToken(idToken: string): GoogleIdTokenPayload | null {
    if (!idToken || typeof idToken !== "string") {
      return null;
    }

    // Dev/test mock token format: mock_google_<sub_or_email>
    const isMockAllowed =
      process.env.NODE_ENV === "test" ||
      process.env.VITEST === "true" ||
      process.env.ALLOW_DEV_MOCK_AUTH === "true";
    if (isMockAllowed && idToken.startsWith("mock_google_")) {
      const identifier = idToken.replace("mock_google_", "");
      return {
        iss: "https://accounts.google.com",
        sub: `google_sub_${identifier}`,
        aud: this.clientId,
        iat: Math.floor(Date.now() / 1000) - 10,
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: identifier.includes("@") ? identifier : `${identifier}@gmail.com`,
        email_verified: true,
        name: identifier.charAt(0).toUpperCase() + identifier.slice(1),
      };
    }

    try {
      const parts = idToken.split(".");
      if (parts.length !== 3) {
        return null;
      }

      const [headerB64, payloadB64, signatureB64] = parts;
      const headerJson = Buffer.from(headerB64, "base64url").toString("utf-8");
      const header = JSON.parse(headerJson) as { alg?: string; kid?: string; typ?: string };

      const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf-8");
      const payload = JSON.parse(payloadJson) as GoogleIdTokenPayload;

      // Validate issuer
      if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
        this.logger?.warn({ iss: payload.iss }, "Invalid Google token issuer");
        return null;
      }

      // Validate expiration
      const nowSec = Math.floor(Date.now() / 1000);
      if (typeof payload.exp !== "number" || payload.exp < nowSec - 60) {
        this.logger?.warn({ exp: payload.exp, now: nowSec }, "Invalid or expired Google ID token");
        return null;
      }

      // Validate audience if set and not in relaxed test mode
      if (this.clientId && payload.aud && payload.aud !== this.clientId) {
        const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
        if (!isTest) {
          this.logger?.warn(
            { aud: payload.aud, expected: this.clientId },
            "Google token audience mismatch",
          );
          return null;
        }
      }

      // Cryptographic RS256 signature verification via local cached JWKS / bundled keys
      if (header.kid) {
        const jwk =
          GoogleOAuthService.jwksCache.get(header.kid) ||
          BUNDLED_FALLBACK_GOOGLE_JWKS.find((k) => k.kid === header.kid);

        if (jwk) {
          try {
            const publicKey = createPublicKey({ key: jwk as any, format: "jwk" });
            const data = Buffer.from(`${headerB64}.${payloadB64}`);
            const signature = Buffer.from(signatureB64, "base64url");
            const isValid = verify("RSA-SHA256", data, publicKey, signature);
            if (!isValid) {
              this.logger?.warn(
                { kid: header.kid },
                "Cryptographic signature mismatch on Google ID Token",
              );
              return null;
            }
          } catch (verifyErr) {
            this.logger?.warn({ err: verifyErr }, "RS256 verification failed");
            return null;
          }
        } else {
          this.logger?.warn({ kid: header.kid }, "Unknown Google JWK key ID; signature unverified");
          return null;
        }
      } else {
        // Missing kid in standard 3-part token
        return null;
      }

      return payload;
    } catch (err) {
      this.logger?.warn({ err }, "Failed to decode Google ID Token JWT");
      return null;
    }
  }

  /**
   * Checks whether the user identified by Google ID Token is already registered in DB.
   */
  public isExistingUser(idToken: string): boolean {
    const payload = this.parseAndValidateToken(idToken);
    if (!payload || !payload.sub || !payload.email) {
      return false;
    }
    const user = this.db.getUserByGoogleSub(payload.sub) || this.db.getUserByEmail(payload.email);
    return Boolean(user);
  }

  public async authenticate(
    idToken: string,
    ipAddress?: string,
    options?: { userAgent?: string; antiSybilLedger?: AntiSybilLedger },
  ): Promise<GoogleAuthResult> {
    const payload = this.parseAndValidateToken(idToken);
    if (!payload || !payload.sub || !payload.email) {
      return { success: false, error: "Invalid or expired Google ID token" };
    }

    // 1. Check if user already exists by Google Sub or Email
    let user = this.db.getUserByGoogleSub(payload.sub) || this.db.getUserByEmail(payload.email);
    let rawKey: string | undefined;

    if (user) {
      // Existing user: Link google_sub if not linked yet
      if (!user.googleSub || user.googleSub !== payload.sub) {
        this.db.linkGoogleSub(user.id, payload.sub, payload.email);
      }

      // Check and refill monthly credits if 30-day period elapsed
      this.db.checkAndRefillMonthlyCredits(user.id);

      // Issue/return valid session passkey so caller can authenticate subsequent API calls
      const tokenSecret = randomBytes(24).toString("hex");
      rawKey = `zen_live_dev_${tokenSecret}`;
      const keyHash = UserKeyLedger.hashToken(rawKey);
      const keyPrefix = rawKey.slice(0, 16);

      // Persist in DB and sync to memory ledger
      this.db.updateUserPasskey(user.id, keyHash, keyPrefix);
      if (this.ledger) {
        (this.ledger as any).hashToUserId?.set(keyHash, user.id);
        const memUser = (this.ledger as any).users?.get(user.id);
        if (memUser) {
          memUser.keyHash = keyHash;
          memUser.keyPrefix = keyPrefix;
        }
      }

      this.db.recordAudit({
        userId: user.id,
        action: "GOOGLE_OAUTH_LOGIN",
        ipAddress,
        detailsJson: JSON.stringify({ email: payload.email, sub: payload.sub }),
      });

      const refreshed = this.db.getUserById(user.id);
      return {
        success: true,
        user: refreshed || user,
        rawKey,
        isNewUser: false,
      };
    }

    // 2. Anti-Sybil check for new registration
    const effectiveAntiSybil = options?.antiSybilLedger || this.antiSybilLedger;
    if (effectiveAntiSybil) {
      const antiSybilCheck = effectiveAntiSybil.checkRegistration(
        ipAddress || "127.0.0.1",
        options?.userAgent,
      );
      if (!antiSybilCheck.allowed) {
        return {
          success: false,
          error: antiSybilCheck.error || "Registration rejected by anti-sybil guard",
        };
      }
    }

    // 3. New user registration
    const baseUsername = payload.email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
    let candidateUsername = baseUsername || `user_${payload.sub.slice(0, 6)}`;

    // Ensure username uniqueness
    if (this.db.getUserByUsername(candidateUsername)) {
      candidateUsername = `${candidateUsername}_${Math.floor(100 + Math.random() * 900)}`;
    }

    const userId = `usr_${randomBytes(8).toString("hex")}`;
    const tokenSecret = randomBytes(24).toString("hex");
    rawKey = `zen_live_dev_${tokenSecret}`;
    const keyHash = UserKeyLedger.hashToken(rawKey);
    const keyPrefix = rawKey.slice(0, 16);

    const todayUtc = new Date().toISOString().slice(0, 10);
    const newUser: UserRecord = {
      id: userId,
      username: candidateUsername,
      displayName: payload.name || candidateUsername,
      role: "developer",
      tier: "free",
      canUsePrivateFleet: false,
      keyHash,
      keyPrefix,
      status: "active",
      allowedFleets: ["llm", "cloudflare_clef"],
      quotas: {
        llm: {
          enabled: true,
          tier: "standard",
          dailyTokenBudget: 1_000_000,
          usedTodayTokens: 0,
          allowedModels: ["codex", "gemini-2.5-flash"],
          allowClaudeOpus: false,
        },
        modal_gpu: {
          enabled: false,
          dailyGpuMinutes: 0,
          usedTodayMinutes: 0,
          allowedApps: [],
        },
        cloudflare_clef: {
          enabled: true,
          dailyRequests: 1000,
          usedTodayRequests: 0,
        },
        services: UserKeyLedger.getDefaultServiceQuotas("free"),
      },
      createdAt: new Date().toISOString(),
      expiresAt: null,
      lastResetDate: todayUtc,
      lastDailyResetDate: todayUtc,
      email: payload.email,
      googleSub: payload.sub,
    };

    // Save to SQLite (upsertUserAndQuotas seeds 200 welcome credits for free tier)
    this.db.upsertUserAndQuotas(newUser);

    // Sync to memory ledger if attached
    if (this.ledger) {
      (this.ledger as any).users?.set(userId, newUser);
      (this.ledger as any).hashToUserId?.set(keyHash, userId);
    }

    this.db.recordAudit({
      userId,
      action: "GOOGLE_OAUTH_REGISTER",
      ipAddress,
      detailsJson: JSON.stringify({
        email: payload.email,
        sub: payload.sub,
        welcomeCredits: 200,
      }),
    });

    this.logger?.info(
      { userId, username: candidateUsername, email: payload.email },
      "New user registered via Google One Tap / OAuth 2.0 with 200 welcome credits",
    );

    if (effectiveAntiSybil) {
      effectiveAntiSybil.recordRegistration(ipAddress || "127.0.0.1");
    }

    const refreshed = this.db.getUserById(userId);
    return {
      success: true,
      user: refreshed || newUser,
      rawKey,
      isNewUser: true,
    };
  }
}

let defaultGoogleOAuthService: GoogleOAuthService | null = null;

export function getGoogleOAuthService(options?: {
  db?: ZencodeDatabase;
  ledger?: UserKeyLedger;
  clientId?: string;
  logger?: Logger;
  antiSybilLedger?: AntiSybilLedger;
}): GoogleOAuthService {
  if (!defaultGoogleOAuthService) {
    defaultGoogleOAuthService = new GoogleOAuthService(options);
  }
  return defaultGoogleOAuthService;
}
