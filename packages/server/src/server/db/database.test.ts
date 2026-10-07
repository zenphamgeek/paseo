import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ZencodeDatabase } from "./database.js";
import type { UserRecord } from "../auth/user-key-ledger.js";

describe("ZencodeDatabase (SQLite WAL Multi-Tenant Engine)", () => {
  const testDir = join(
    "/tmp",
    `zencode_db_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  );
  const dbPath = join(testDir, "test_zencode.db");
  let db: ZencodeDatabase;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = new ZencodeDatabase({ dbPath });
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("initializes SQLite database in WAL mode and creates required tables", () => {
    expect(existsSync(dbPath)).toBe(true);
    const users = db.getAllUsers();
    expect(users).toEqual([]);
  });

  it("upserts and retrieves user and quota records with high fidelity", () => {
    const mockUser: UserRecord = {
      id: "usr_alice_123",
      username: "alice",
      displayName: "Alice Dev",
      role: "developer",
      tier: "pro",
      canUsePrivateFleet: false,
      keyHash: "sha256:abcd1234",
      keyPrefix: "zen_live_dev_alice",
      status: "active",
      allowedFleets: ["llm", "cloudflare_clef"],
      quotas: {
        llm: {
          enabled: true,
          tier: "pro",
          dailyTokenBudget: 20_000_000,
          usedTodayTokens: 50_000,
          allowedModels: ["codex", "gemini-2.5-flash"],
          allowClaudeOpus: false,
        },
        modal_gpu: {
          enabled: true,
          dailyGpuMinutes: 60,
          usedTodayMinutes: 5,
          allowedApps: ["omni-voice"],
        },
        cloudflare_clef: {
          enabled: true,
          dailyRequests: 5000,
          usedTodayRequests: 120,
        },
        services: {
          tts: {
            enabled: true,
            dailyMinutes: 15,
            usedTodayMinutes: 2,
            appName: "Omni Voice App",
          },
          t2image: {
            enabled: true,
            dailyImages: 20,
            usedTodayImages: 4,
            model: "Qwen Image 2.1",
          },
          img2img: {
            enabled: true,
            dailyEdits: 15,
            usedTodayEdits: 1,
            model: "Qwen 2.1 Image Edit",
          },
          video: {
            enabled: false,
            status: "unsupported",
            note: "Chưa hỗ trợ App Video trong phiên bản hiện tại",
          },
        },
      },
      createdAt: new Date().toISOString(),
      expiresAt: null,
      lastActiveAt: undefined,
      lastResetDate: "2026-10-06",
    };

    db.upsertUserAndQuotas(mockUser);

    const retrieved = db.getUserById("usr_alice_123");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.username).toBe("alice");
    expect(retrieved?.tier).toBe("pro");
    expect(retrieved?.quotas.llm.dailyTokenBudget).toBe(20_000_000);
    expect(retrieved?.quotas.services.tts.appName).toBe("Omni Voice App");

    const byUsername = db.getUserByUsername("alice");
    expect(byUsername?.id).toBe("usr_alice_123");
  });

  it("handles credit balance deposits and deductions atomically", () => {
    const userId = "usr_credit_test";
    db.upsertUserAndQuotas({
      id: userId,
      username: "credit_user",
      displayName: "Credit User",
      role: "developer",
      tier: "free",
      canUsePrivateFleet: false,
      keyHash: "sha256:credit_hash",
      keyPrefix: "zen_live_dev_credit",
      status: "active",
      allowedFleets: ["llm"],
      quotas: {
        llm: {
          enabled: true,
          tier: "standard",
          dailyTokenBudget: 1000000,
          usedTodayTokens: 0,
          allowedModels: ["codex"],
          allowClaudeOpus: false,
        },
        modal_gpu: { enabled: false, dailyGpuMinutes: 0, usedTodayMinutes: 0, allowedApps: [] },
        cloudflare_clef: { enabled: true, dailyRequests: 1000, usedTodayRequests: 0 },
        services: {
          tts: { enabled: false, dailyMinutes: 0, usedTodayMinutes: 0, appName: "Omni Voice App" },
          t2image: { enabled: false, dailyImages: 0, usedTodayImages: 0, model: "Qwen Image 2.1" },
          img2img: {
            enabled: false,
            dailyEdits: 0,
            usedTodayEdits: 0,
            model: "Qwen 2.1 Image Edit",
          },
          video: { enabled: false, status: "unsupported", note: "Chưa hỗ trợ" },
        },
      },
      createdAt: new Date().toISOString(),
      lastResetDate: "2026-10-06",
    });

    const initial = db.getUserCredits(userId);
    expect(initial.balance).toBe(200); // 200 initial free tier credits

    const deposited = db.addCredits(userId, 500);
    expect(deposited.balance).toBe(700);
    expect(deposited.totalDeposited).toBe(700);

    const deductSuccess = db.deductCredits(userId, 200);
    expect(deductSuccess.success).toBe(true);
    expect(deductSuccess.newBalance).toBe(500);

    const deductFail = db.deductCredits(userId, 1000);
    expect(deductFail.success).toBe(false);
    expect(deductFail.newBalance).toBe(500);
  });

  it("processes VietQR/SePay billing orders and upgrades user tier to Pro", () => {
    const mockUser: UserRecord = {
      id: "usr_buyer_999",
      username: "buyer999",
      displayName: "VietQR Buyer",
      role: "developer",
      tier: "free",
      canUsePrivateFleet: false,
      keyHash: "sha256:buyer_hash",
      keyPrefix: "zen_live_dev_buyer",
      status: "active",
      allowedFleets: ["llm"],
      quotas: {
        llm: {
          enabled: true,
          tier: "standard",
          dailyTokenBudget: 1_000_000,
          usedTodayTokens: 0,
          allowedModels: ["codex"],
          allowClaudeOpus: false,
        },
        modal_gpu: { enabled: false, dailyGpuMinutes: 0, usedTodayMinutes: 0, allowedApps: [] },
        cloudflare_clef: { enabled: true, dailyRequests: 1000, usedTodayRequests: 0 },
        services: {
          tts: { enabled: false, dailyMinutes: 0, usedTodayMinutes: 0, appName: "Omni Voice App" },
          t2image: { enabled: false, dailyImages: 0, usedTodayImages: 0, model: "Qwen Image 2.1" },
          img2img: {
            enabled: false,
            dailyEdits: 0,
            usedTodayEdits: 0,
            model: "Qwen 2.1 Image Edit",
          },
          video: { enabled: false, status: "unsupported", note: "Chưa hỗ trợ" },
        },
      },
      createdAt: new Date().toISOString(),
      expiresAt: null,
      lastResetDate: "2026-10-06",
    };
    db.upsertUserAndQuotas(mockUser);

    const order = db.createBillingOrder({
      userId: "usr_buyer_999",
      orderCode: "ZC100999",
      amount: 199000,
      planCode: "pro_monthly",
    });

    expect(order.status).toBe("PENDING");
    expect(order.orderCode).toBe("ZC100999");

    const completion = db.completeBillingOrder({
      orderCode: "ZC100999",
      bankAccount: "0123456789",
      transferContent: "ZC100999 thanh toan zencode pro",
      rawWebhook: {
        id: 888999,
        gateway: "Vietcombank",
        transferAmount: 199000,
      },
    });

    expect(completion.success).toBe(true);
    expect(completion.order?.status).toBe("COMPLETED");

    // Verify User was upgraded to Pro tier
    const updatedUser = db.getUserById("usr_buyer_999");
    expect(updatedUser?.tier).toBe("pro");
    expect(updatedUser?.quotas.llm.dailyTokenBudget).toBe(20_000_000);
    expect(updatedUser?.quotas.services.tts.enabled).toBe(true);
  });

  it("migrates from legacy user_keys.json smoothly", () => {
    const legacyPath = join(testDir, "legacy_user_keys.json");
    const legacyData = {
      version: 1,
      users: {
        usr_legacy_bob: {
          id: "usr_legacy_bob",
          username: "bob",
          displayName: "Bob Legacy",
          role: "developer",
          tier: "free",
          canUsePrivateFleet: false,
          keyHash: "sha256:bob123",
          keyPrefix: "zen_live_dev_bob",
          status: "active",
          allowedFleets: ["llm"],
          quotas: {
            llm: {
              enabled: true,
              tier: "standard",
              dailyTokenBudget: 1000000,
              usedTodayTokens: 0,
              allowedModels: ["codex"],
              allowClaudeOpus: false,
            },
            modal_gpu: { enabled: false, dailyGpuMinutes: 0, usedTodayMinutes: 0, allowedApps: [] },
            cloudflare_clef: { enabled: true, dailyRequests: 1000, usedTodayRequests: 0 },
            services: {
              tts: {
                enabled: false,
                dailyMinutes: 0,
                usedTodayMinutes: 0,
                appName: "Omni Voice App",
              },
              t2image: {
                enabled: false,
                dailyImages: 0,
                usedTodayImages: 0,
                model: "Qwen Image 2.1",
              },
              img2img: {
                enabled: false,
                dailyEdits: 0,
                usedTodayEdits: 0,
                model: "Qwen 2.1 Image Edit",
              },
              video: { enabled: false, status: "unsupported", note: "Chưa hỗ trợ" },
            },
          },
          createdAt: new Date().toISOString(),
          lastResetDate: "2026-10-06",
        },
      },
    };
    writeFileSync(legacyPath, JSON.stringify(legacyData, null, 2), "utf-8");

    const result = db.migrateFromLegacyLedger(legacyPath);
    expect(result.migratedCount).toBe(1);
    expect(result.errors).toBe(0);

    const bob = db.getUserById("usr_legacy_bob");
    expect(bob?.username).toBe("bob");
  });
});
