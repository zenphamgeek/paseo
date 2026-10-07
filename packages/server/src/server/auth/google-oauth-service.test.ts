import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ZencodeDatabase } from "../db/database.js";
import { GoogleOAuthService } from "./google-oauth-service.js";

describe("GoogleOAuthService (1-Click Google Onboarding)", () => {
  const testDir = join(
    "/tmp",
    `google_auth_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  );
  const dbPath = join(testDir, "test_google_auth.db");
  let db: ZencodeDatabase;
  let service: GoogleOAuthService;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = new ZencodeDatabase({ dbPath });
    service = new GoogleOAuthService({
      db,
      clientId: "test-client-id.apps.googleusercontent.com",
    });
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("exposes public Google OAuth configuration", () => {
    const config = service.getPublicConfig();
    expect(config.enabled).toBe(true);
    expect(config.clientId).toBe("test-client-id.apps.googleusercontent.com");
  });

  it("parses valid mock token and extracts user profile", () => {
    const payload = service.parseAndValidateToken("mock_google_alice@gmail.com");
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("alice@gmail.com");
    expect(payload?.sub).toBe("google_sub_alice@gmail.com");
  });

  it("rejects invalid or corrupted token string", () => {
    const payload = service.parseAndValidateToken("invalid.token");
    expect(payload).toBeNull();
  });

  it("registers a new user on first Google login with 200 welcome credits and dev passkey", async () => {
    const result = await service.authenticate("mock_google_john_doe@gmail.com");
    expect(result.success).toBe(true);
    expect(result.isNewUser).toBe(true);
    expect(result.user?.username).toBe("john_doe");
    expect(result.rawKey).toMatch(/^zen_live_dev_[0-9a-f]{48}$/);
    expect(result.user?.tier).toBe("free");

    // Verify credits in SQLite
    const credits = db.getUserCredits(result.user!.id);
    expect(credits.balance).toBe(200); // 200 free tier welcome credits
  });

  it("logs in existing user on subsequent logins without duplicating accounts", async () => {
    const firstLogin = await service.authenticate("mock_google_sarah@gmail.com");
    expect(firstLogin.success).toBe(true);
    expect(firstLogin.isNewUser).toBe(true);

    const secondLogin = await service.authenticate("mock_google_sarah@gmail.com");
    expect(secondLogin.success).toBe(true);
    expect(secondLogin.isNewUser).toBe(false);
    expect(secondLogin.user?.id).toBe(firstLogin.user?.id);
    expect(secondLogin.user?.username).toBe(firstLogin.user?.username);
    expect(secondLogin.rawKey).toMatch(/^zen_live_dev_[0-9a-f]{48}$/);
  });

  it("cryptographically verifies authentic RS256 Google ID token via registered JWK", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as any;
    jwk.kid = "test_key_1";
    jwk.alg = "RS256";
    jwk.use = "sig";
    GoogleOAuthService.registerJwk(jwk);

    const header = { alg: "RS256", kid: "test_key_1", typ: "JWT" };
    const payload = {
      iss: "https://accounts.google.com",
      sub: "google_sub_crypto_tester_123",
      aud: "test-client-id.apps.googleusercontent.com",
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: "crypto_tester@gmail.com",
      email_verified: true,
      name: "Crypto Tester",
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const dataToSign = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = sign("RSA-SHA256", dataToSign, privateKey);
    const signatureB64 = signature.toString("base64url");

    const validToken = `${headerB64}.${payloadB64}.${signatureB64}`;
    const verified = service.parseAndValidateToken(validToken);

    expect(verified).not.toBeNull();
    expect(verified?.email).toBe("crypto_tester@gmail.com");
    expect(verified?.sub).toBe("google_sub_crypto_tester_123");

    // Test rejection with tampered payload
    const forgedPayload = { ...payload, email: "hacker@gmail.com" };
    const forgedPayloadB64 = Buffer.from(JSON.stringify(forgedPayload)).toString("base64url");
    const forgedToken = `${headerB64}.${forgedPayloadB64}.${signatureB64}`;
    expect(service.parseAndValidateToken(forgedToken)).toBeNull();

    // Test rejection with unknown key ID
    const unknownHeader = { alg: "RS256", kid: "unknown_kid_999", typ: "JWT" };
    const unknownHeaderB64 = Buffer.from(JSON.stringify(unknownHeader)).toString("base64url");
    const unknownToken = `${unknownHeaderB64}.${payloadB64}.${signatureB64}`;
    expect(service.parseAndValidateToken(unknownToken)).toBeNull();
  });

  it("persists google_sub and initializes last_reset_date to today on new user creation", async () => {
    const result = await service.authenticate("mock_google_brand_new@gmail.com");
    expect(result.success).toBe(true);
    expect(result.user?.tier).toBe("free");

    const todayUtc = new Date().toISOString().slice(0, 10);
    expect(result.user?.lastResetDate).toBe(todayUtc);
    expect(result.user?.googleSub).toBe("google_sub_brand_new@gmail.com");
    expect(result.user?.email).toBe("brand_new@gmail.com");

    const dbUser = db.getUserById(result.user!.id);
    expect(dbUser?.lastResetDate).toBe(todayUtc);
    expect(dbUser?.googleSub).toBe("google_sub_brand_new@gmail.com");
  });
});
