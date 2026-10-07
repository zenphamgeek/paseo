import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ZencodeDatabase } from "../db/database.js";
import { SepayGateway, ZENCODE_PLANS } from "./sepay-gateway.js";
import { unlinkSync, existsSync } from "node:fs";

describe("SepayGateway Unit & Integration Tests", () => {
  const testDbPath = `/tmp/test-zencode-sepay-${Date.now()}.db`;
  let db: ZencodeDatabase;
  let gateway: SepayGateway;

  const testUser = {
    id: "usr_test_billing",
    username: "test_billing_user",
    displayName: "Test Billing User",
    email: "test_billing@zencode.vn",
    role: "developer",
    tier: "free",
    canUsePrivateFleet: false,
    keyHash: "sha256:test_key_hash",
    keyPrefix: "zen_test_key",
    status: "active",
    allowedFleets: ["llm", "cloudflare_clef"],
    quotas: {
      llm: {
        enabled: true,
        tier: "standard" as const,
        dailyTokenBudget: 1_000_000,
        usedTodayTokens: 0,
        allowedModels: ["codex"],
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
    },
    createdAt: new Date().toISOString(),
    lastResetDate: "2026-10-06",
  };

  beforeEach(() => {
    db = new ZencodeDatabase({ dbPath: testDbPath });
    db.upsertUserAndQuotas(testUser);
    gateway = new SepayGateway({
      db,
      apiKey: "test_sepay_key_2026",
      bankName: "MBBank",
      bankAccount: "0988776655",
      accountHolder: "CONG TY ZENCODE",
    });
  });

  afterEach(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = `${testDbPath}${suffix}`;
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {}
      }
    }
  });

  it("should create order with valid ZC###### code and VietQR url", () => {
    const before = Date.now();
    const result = gateway.createPaymentOrder({
      userId: "usr_test_billing",
      planCode: "pro_monthly",
    });
    const after = Date.now();

    expect(result.order.orderCode).toMatch(/^ZC[0-9]{6}$/);
    expect(result.order.amount).toBe(199_000);
    expect(result.order.status).toBe("PENDING");
    expect(result.order.planCode).toBe("pro_monthly");

    expect(result.qrUrl).toBe(
      `https://qr.sepay.vn/img?acc=0988776655&bank=MBBank&amount=199000&des=${result.order.orderCode}`,
    );
    expect(result.bankInfo.bankName).toBe("MBBank");
    expect(result.bankInfo.accountNumber).toBe("0988776655");
    expect(result.bankInfo.transferSyntax).toBe(result.order.orderCode);

    // 30 minute expiration TTL
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + 30 * 60 * 1000);
  });

  it("should reject customAmount <= 0", () => {
    expect(() => {
      gateway.createPaymentOrder({
        userId: "usr_test_billing",
        planCode: "enterprise",
        customAmount: -100,
      });
    }).toThrow("customAmount must be a positive number");

    expect(() => {
      gateway.createPaymentOrder({
        userId: "usr_test_billing",
        planCode: "enterprise",
        customAmount: 0,
      });
    }).toThrow("customAmount must be a positive number");
  });

  it("should enforce authentication on webhook", () => {
    const payload = {
      gateway: "MBBank",
      transactionDate: "2026-10-06 18:00:00",
      accountNumber: "0988776655",
      content: "ZC123456",
      transferType: "in" as const,
      transferAmount: 199_000,
    };

    // No auth
    const r1 = gateway.handleWebhook(payload);
    expect(r1.status).toBe(401);
    expect(r1.success).toBe(false);

    // Wrong auth
    const r2 = gateway.handleWebhook(payload, "Bearer wrong_key");
    expect(r2.status).toBe(401);
    expect(r2.success).toBe(false);

    // Valid Bearer auth
    const r3 = gateway.verifyAuthentication("Bearer test_sepay_key_2026");
    expect(r3).toBe(true);

    // Valid Apikey auth
    const r4 = gateway.verifyAuthentication("Apikey test_sepay_key_2026");
    expect(r4).toBe(true);

    // Valid query token
    const r5 = gateway.verifyAuthentication(undefined, "test_sepay_key_2026");
    expect(r5).toBe(true);
  });

  it("should reconcile valid webhook, upgrade to Pro tier, add bonus credits, and be idempotent", () => {
    const orderData = gateway.createPaymentOrder({
      userId: "usr_test_billing",
      planCode: "pro_monthly",
    });
    const orderCode = orderData.order.orderCode;

    const payload = {
      gateway: "MBBank",
      transactionDate: "2026-10-06 18:00:00",
      accountNumber: "0988776655",
      content: `Thanh toan don hang ${orderCode} Zencode Pro`,
      transferType: "in" as const,
      transferAmount: 199_000,
    };

    // First call: successful fulfillment
    const res1 = gateway.handleWebhook(payload, "Bearer test_sepay_key_2026");
    expect(res1.status).toBe(200);
    expect(res1.success).toBe(true);
    expect(res1.order?.status).toBe("COMPLETED");
    expect(res1.order?.creditsAdded).toBe(500);

    // Verify user boosted in database
    const user = db.getUserById("usr_test_billing");
    expect(user?.tier).toBe("pro");
    expect(user?.quotas.llm.dailyTokenBudget).toBe(20_000_000);
    expect(user?.quotas.modal_gpu.enabled).toBe(true);
    expect(user?.quotas.modal_gpu.dailyGpuMinutes).toBe(60);
    expect(user?.quotas.services?.tts.enabled).toBe(true);
    expect(user?.quotas.services?.tts.dailyMinutes).toBe(15);
    expect(user?.quotas.services?.t2image.enabled).toBe(true);
    expect(user?.quotas.services?.t2image.dailyImages).toBe(20);

    // Check credits: 200 initial + 500 bonus = 700
    const credits = db.getUserCredits("usr_test_billing");
    expect(credits?.balance).toBe(700);

    // Check audit logs
    const logs = db.db
      .prepare("SELECT * FROM audit_logs WHERE user_id = ?")
      .all("usr_test_billing") as any[];
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.action === "BILLING_ORDER_COMPLETED")).toBe(true);

    // Second call: idempotency check
    const res2 = gateway.handleWebhook(payload, "Bearer test_sepay_key_2026");
    expect(res2.status).toBe(200);
    expect(res2.success).toBe(true);
    expect(res2.message).toBe("Order already completed");
  });

  it("should reject webhook with insufficient transfer amount", () => {
    const orderData = gateway.createPaymentOrder({
      userId: "usr_test_billing",
      planCode: "pro_monthly",
    });
    const orderCode = orderData.order.orderCode;

    const payload = {
      gateway: "MBBank",
      transactionDate: "2026-10-06 18:00:00",
      accountNumber: "0988776655",
      content: `Thanh toan don hang ${orderCode}`,
      transferType: "in" as const,
      transferAmount: 50_000, // Insufficient: expected 199,000
    };

    const res = gateway.handleWebhook(payload, "Bearer test_sepay_key_2026");
    expect(res.status).toBe(400);
    expect(res.success).toBe(false);
    expect(res.message).toContain("Insufficient transfer amount");
  });
});
