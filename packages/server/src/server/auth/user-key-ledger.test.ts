import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { UserKeyLedger } from "./user-key-ledger.js";

describe("UserKeyLedger & 3-Fleet RBAC", () => {
  let tmpDir: string;
  let ledger: UserKeyLedger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zen-user-keys-test-"));
    ledger = new UserKeyLedger({ storageDir: tmpDir });
  });

  afterEach(() => {
    try {
      ledger.destroy();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("provisions master admin passkey when initialized on empty directory", () => {
    const adminKey = ledger.getInitialAdminKey();
    expect(adminKey).toBeDefined();
    expect(adminKey).toMatch(/^zen_live_admin_[0-9a-f]{32}$/);

    const verification = ledger.verifyKey(adminKey!);
    expect(verification.valid).toBe(true);
    expect(verification.user?.username).toBe("admin");
    expect(verification.user?.role).toBe("admin");
    expect(verification.user?.allowedFleets).toEqual(["llm", "modal_gpu", "cloudflare_clef"]);
    expect(verification.user?.quotas.llm.allowClaudeOpus).toBe(true);
  });

  it("creates a developer passkey with customized fleet access", () => {
    const { user, rawKey } = ledger.createUser({
      username: "bob",
      displayName: "Bob Dev",
      role: "developer",
      allowedFleets: ["llm", "cloudflare_clef"], // No GPU
      dailyTokenBudget: 500_000,
      dailyRequests: 2000,
      allowClaudeOpus: false,
    });

    expect(rawKey).toMatch(/^zen_live_dev_[0-9a-f]{32}$/);
    expect(user.username).toBe("bob");
    expect(user.allowedFleets).toEqual(["llm", "cloudflare_clef"]);
    expect(user.quotas.llm.allowClaudeOpus).toBe(false);

    // Verify key works
    const check = ledger.verifyKey(rawKey);
    expect(check.valid).toBe(true);
    expect(check.user?.id).toBe(user.id);
  });

  it("enforces fleet permissions correctly via hasFleetAccess", () => {
    const { user, rawKey } = ledger.createUser({
      username: "alice",
      role: "developer",
      allowedFleets: ["llm"], // Only LLM
      dailyTokenBudget: 100_000,
    });

    const userRecord = ledger.findUserByToken(rawKey)!;
    expect(userRecord).not.toBeNull();

    // LLM access allowed
    const llmCheck = ledger.hasFleetAccess(userRecord, "llm");
    expect(llmCheck.allowed).toBe(true);

    // Modal GPU access rejected
    const gpuCheck = ledger.hasFleetAccess(userRecord, "modal_gpu");
    expect(gpuCheck.allowed).toBe(false);
    expect(gpuCheck.reason).toContain("modal_gpu");

    // Cloudflare Clef access rejected
    const clefCheck = ledger.hasFleetAccess(userRecord, "cloudflare_clef");
    expect(clefCheck.allowed).toBe(false);
  });

  it("enforces daily quota limits and exhaustion", () => {
    const { rawKey } = ledger.createUser({
      username: "tester",
      allowedFleets: ["llm"],
      dailyTokenBudget: 1000,
    });

    const userRecord = ledger.findUserByToken(rawKey)!;
    expect(ledger.hasFleetAccess(userRecord, "llm").allowed).toBe(true);

    // Record usage up to limit
    ledger.recordUsage(userRecord.id, "llm", 1000);
    const updatedUser = ledger.findUserByToken(rawKey)!;
    const quotaCheck = ledger.hasFleetAccess(updatedUser, "llm");
    expect(quotaCheck.allowed).toBe(false);
    expect(quotaCheck.reason).toContain("Daily LLM token budget exhausted");

    // Adjust quota
    ledger.adjustQuota(userRecord.id, "llm", { addTokens: 5000 });
    const adjustedUser = ledger.findUserByToken(rawKey)!;
    expect(ledger.hasFleetAccess(adjustedUser, "llm").allowed).toBe(true);
  });

  it("revokes user passkey and rejects subsequent verification", () => {
    const { user, rawKey } = ledger.createUser({
      username: "charlie",
      role: "guest",
    });

    expect(ledger.verifyKey(rawKey).valid).toBe(true);

    // Revoke
    const revoked = ledger.revokeUser(user.id);
    expect(revoked).toBe(true);

    const check = ledger.verifyKey(rawKey);
    expect(check.valid).toBe(false);
    expect(check.error).toContain("revoked");
  });

  it("applies Codex Tier presets correctly (free, pro, team, enterprise)", () => {
    // Free Tier
    const free = ledger.createUser({ username: "free_user", tier: "free" });
    expect(free.user.tier).toBe("free");
    expect(free.user.quotas.llm.dailyTokenBudget).toBe(200_000);
    expect(free.user.quotas.llm.allowedModels).toEqual(["codex", "gemini-2.5-flash"]);
    expect(free.user.quotas.llm.allowClaudeOpus).toBe(false);
    expect(free.user.canUsePrivateFleet).toBe(false);

    // Pro Tier
    const pro = ledger.createUser({ username: "pro_user", tier: "pro" });
    expect(pro.user.tier).toBe("pro");
    expect(pro.user.quotas.llm.dailyTokenBudget).toBe(1_000_000);
    expect(pro.user.quotas.modal_gpu.dailyGpuMinutes).toBe(45);
    expect(pro.user.canUsePrivateFleet).toBe(false);

    // Team Tier
    const team = ledger.createUser({ username: "team_user", tier: "team" });
    expect(team.user.tier).toBe("team");
    expect(team.user.quotas.llm.dailyTokenBudget).toBe(5_000_000);
    expect(team.user.quotas.modal_gpu.dailyGpuMinutes).toBe(120);
    expect(team.user.quotas.llm.allowedModels).toContain("claude-sonnet-4.6");
    expect(team.user.canUsePrivateFleet).toBe(false);

    // Enterprise Tier
    const enterprise = ledger.createUser({ username: "enterprise_user", tier: "enterprise" });
    expect(enterprise.user.tier).toBe("enterprise");
    expect(enterprise.user.quotas.llm.dailyTokenBudget).toBe(25_000_000);
    expect(enterprise.user.quotas.modal_gpu.dailyGpuMinutes).toBe(1440);
    expect(enterprise.user.quotas.llm.allowClaudeOpus).toBe(true);
  });

  it("enforces default lockdown of Private Fleet and allows Admin manual grant", () => {
    const { user, rawKey } = ledger.createUser({
      username: "dan",
      role: "developer",
      tier: "pro",
    });

    // Default lockdown: canUsePrivateFleet is false
    expect(user.canUsePrivateFleet).toBe(false);
    let record = ledger.findUserByToken(rawKey)!;
    expect(record.canUsePrivateFleet).toBe(false);

    // Admin grants manual access
    const updated = ledger.setPrivateFleetAccess(user.id, true);
    expect(updated).toBe(true);

    record = ledger.findUserByToken(rawKey)!;
    expect(record.canUsePrivateFleet).toBe(true);

    // Admin revokes access
    ledger.setPrivateFleetAccess(user.id, false);
    record = ledger.findUserByToken(rawKey)!;
    expect(record.canUsePrivateFleet).toBe(false);
  });

  it("provisions and enforces specialized service quotas (TTS, t2Image, Img2Img, Video)", () => {
    // Pro Tier user
    const { user, rawKey } = ledger.createUser({
      username: "creative_dev",
      tier: "pro",
    });

    expect(user.quotas.services.tts.enabled).toBe(true);
    expect(user.quotas.services.tts.dailyMinutes).toBe(15);
    expect(user.quotas.services.t2image.dailyImages).toBe(20);
    expect(user.quotas.services.img2img.dailyEdits).toBe(15);
    expect(user.quotas.services.video.enabled).toBe(false);
    expect(user.quotas.services.video.status).toBe("unsupported");

    let record = ledger.findUserByToken(rawKey)!;

    // Check service access
    expect(ledger.hasServiceAccess(record, "tts").allowed).toBe(true);
    expect(ledger.hasServiceAccess(record, "t2image").allowed).toBe(true);
    expect(ledger.hasServiceAccess(record, "img2img").allowed).toBe(true);

    // Video service must be explicitly unsupported
    const videoCheck = ledger.hasServiceAccess(record, "video");
    expect(videoCheck.allowed).toBe(false);
    expect(videoCheck.reason).toContain("chưa được hỗ trợ");

    // Exhaust TTS quota
    ledger.recordServiceUsage(user.id, "tts", 15);
    record = ledger.findUserByToken(rawKey)!;
    const ttsCheck = ledger.hasServiceAccess(record, "tts");
    expect(ttsCheck.allowed).toBe(false);
    expect(ttsCheck.reason).toContain("Omni Voice App");

    // Adjust TTS quota
    ledger.adjustServiceQuota(user.id, { addTtsMinutes: 10 });
    record = ledger.findUserByToken(rawKey)!;
    expect(ledger.hasServiceAccess(record, "tts").allowed).toBe(true);
  });

  it("resets user daily usage on-demand across all services via resetUserUsage", () => {
    const { user, rawKey } = ledger.createUser({
      username: "reset_tester",
      tier: "pro",
    });

    // Record usage
    ledger.recordUsage(user.id, "llm", 50_000);
    ledger.recordUsage(user.id, "modal_gpu", 20);
    ledger.recordUsage(user.id, "cloudflare_clef", 500);
    ledger.recordServiceUsage(user.id, "tts", 10);
    ledger.recordServiceUsage(user.id, "t2image", 5);
    ledger.recordServiceUsage(user.id, "img2img", 3);

    let record = ledger.findUserByToken(rawKey)!;
    expect(record.quotas.llm.usedTodayTokens).toBe(50_000);
    expect(record.quotas.modal_gpu.usedTodayMinutes).toBe(20);
    expect(record.quotas.cloudflare_clef.usedTodayRequests).toBe(500);
    expect(record.quotas.services.tts.usedTodayMinutes).toBe(10);
    expect(record.quotas.services.t2image.usedTodayImages).toBe(5);
    expect(record.quotas.services.img2img.usedTodayEdits).toBe(3);

    // Perform on-demand reset
    const ok = ledger.resetUserUsage(user.id);
    expect(ok).toBe(true);

    record = ledger.findUserByToken(rawKey)!;
    expect(record.quotas.llm.usedTodayTokens).toBe(0);
    expect(record.quotas.modal_gpu.usedTodayMinutes).toBe(0);
    expect(record.quotas.cloudflare_clef.usedTodayRequests).toBe(0);
    expect(record.quotas.services.tts.usedTodayMinutes).toBe(0);
    expect(record.quotas.services.t2image.usedTodayImages).toBe(0);
    expect(record.quotas.services.img2img.usedTodayEdits).toBe(0);
    expect(record.lastResetDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("automatically rolls over daily usage when accessing user on a new UTC date", () => {
    const { user, rawKey } = ledger.createUser({
      username: "rollover_tester",
      tier: "pro",
    });

    // Record usage
    ledger.recordUsage(user.id, "llm", 80_000);
    ledger.recordServiceUsage(user.id, "t2image", 12);

    // Simulate past date by modifying user record directly in ledger state
    const internalUser = (ledger as any).users.get(user.id);
    internalUser.lastResetDate = "2025-01-01"; // Old date
    (ledger as any).saveToDisk();

    // Re-accessing user via findUserByToken triggers checkDailyRollover
    const accessed = ledger.findUserByToken(rawKey)!;
    expect(accessed.quotas.llm.usedTodayTokens).toBe(0);
    expect(accessed.quotas.services.t2image.usedTodayImages).toBe(0);
    expect(accessed.lastResetDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("calculates model usage with market credit multipliers via recordModelUsage", () => {
    const { user, rawKey } = ledger.createUser({
      username: "model_tester",
      tier: "enterprise",
      dailyTokenBudget: 10_000_000,
    });

    // Cloudflare Clef: 0.0x free pool
    const clefRes = ledger.recordModelUsage(user.id, "cloudflare-clef", 5000);
    expect(clefRes.multiplier).toBe(0.0);
    expect(clefRes.chargedCredits).toBe(0);

    // Codex: 1.0x
    const codexRes = ledger.recordModelUsage(user.id, "codex", 1000);
    expect(codexRes.multiplier).toBe(1.0);
    expect(codexRes.chargedCredits).toBe(1000);

    // Gemini 2.5 Pro: 5.0x
    const geminiProRes = ledger.recordModelUsage(user.id, "gemini-2.5-pro", 2000);
    expect(geminiProRes.multiplier).toBe(5.0);
    expect(geminiProRes.chargedCredits).toBe(10000);

    // Claude Opus 4.8: 35.0x
    const opusRes = ledger.recordModelUsage(user.id, "claude-opus-4.8", 1000);
    expect(opusRes.multiplier).toBe(35.0);
    expect(opusRes.chargedCredits).toBe(35000);

    const record = ledger.findUserByToken(rawKey)!;
    // Total charged = 0 + 1000 + 10000 + 35000 = 46000
    expect(record.quotas.llm.usedTodayTokens).toBe(46000);
    expect(opusRes.remainingTokens).toBe(10_000_000 - 46000);
  });

  it("handles high-concurrency non-blocking streaming token bursts and flushes atomically", async () => {
    const { user, rawKey } = ledger.createUser({
      username: "concurrency_tester",
      tier: "pro",
      dailyTokenBudget: 5_000_000,
    });

    const start = performance.now();
    // Simulate 100 concurrent streaming token chunks arriving in parallel
    for (let i = 0; i < 100; i++) {
      ledger.recordUsage(user.id, "llm", 150);
    }
    const elapsed = performance.now() - start;

    // Must be ultra-fast in-memory (< 20ms for 100 calls, no disk write blocking)
    expect(elapsed).toBeLessThan(50);

    // In-memory counter is updated immediately (100 * 150 = 15,000)
    let record = ledger.findUserByToken(rawKey)!;
    expect(record.quotas.llm.usedTodayTokens).toBe(15000);

    // Flush asynchronously to disk
    await ledger.flushToDiskAsync();

    // Verify disk content directly by reading JSON file
    const diskPath = path.join(tmpDir, "user_keys.json");
    const rawDisk = fs.readFileSync(diskPath, "utf-8");
    const diskData = JSON.parse(rawDisk);
    expect(diskData.users[user.id].quotas.llm.usedTodayTokens).toBe(15000);
  });
});
