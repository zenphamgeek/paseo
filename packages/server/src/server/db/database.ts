import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import type { CodexTier, FleetName, UserRecord, UserRole } from "../auth/user-key-ledger.js";
import { UserKeyLedger, resolveModelMultiplier } from "../auth/user-key-ledger.js";

export const TOKENS_PER_Z_CREDIT = 2500;

/**
 * Safely rounds any numeric value to 4 decimal places, eliminating IEEE-754 binary floating point artifacts.
 */
export function roundCreditPrecision(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) {
    return 0;
  }
  return Number(num.toFixed(4));
}

export interface DeductCreditsResult {
  success: boolean;
  chargedCredits: number;
  remainingBalance: number;
  error?: string;
}

export interface UserEntity {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  tier: CodexTier;
  canUsePrivateFleet: boolean;
  keyHash: string;
  keyPrefix: string;
  status: "active" | "suspended" | "revoked";
  allowedFleets: FleetName[];
  googleSub: string | null;
  createdAt: number;
  expiresAt: number | null;
  lastActiveAt: number | null;
  lastResetDate: string;
}

export interface UserQuotaEntity {
  userId: string;
  llmEnabled: boolean;
  llmTier: string;
  dailyTokenBudget: number;
  usedTodayTokens: number;
  allowClaudeOpus: boolean;
  modalGpuEnabled: boolean;
  dailyGpuMinutes: number;
  usedTodayGpuMinutes: number;
  clefEnabled: boolean;
  dailyClefRequests: number;
  usedTodayClefRequests: number;
  ttsEnabled: boolean;
  dailyTtsMinutes: number;
  usedTodayTtsMinutes: number;
  t2iEnabled: boolean;
  dailyT2iImages: number;
  usedTodayT2iImages: number;
  img2imgEnabled: boolean;
  dailyImg2ImgEdits: number;
  usedTodayImg2ImgEdits: number;
  updatedAt: number;
}

export interface UserCreditEntity {
  userId: string;
  balance: number;
  totalDeposited: number;
  totalConsumed: number;
  updatedAt: number;
}

export interface MonthlyRefillResult {
  refilled: boolean;
  balance: number;
  lastResetDate: string;
  nextResetDate: string;
}

export interface BillingTransactionEntity {
  id: string;
  userId: string;
  orderCode: string;
  amount: number;
  currency: string;
  provider: "sepay" | "vietqr" | "stripe";
  status: "PENDING" | "COMPLETED" | "FAILED" | "EXPIRED";
  planCode: string | null;
  creditsAdded: number;
  bankAccount: string | null;
  transferContent: string | null;
  rawWebhookJson: string | null;
  createdAt: number;
  verifiedAt: number | null;
}

export interface AuditLogEntity {
  id: number;
  userId: string | null;
  action: string;
  detailsJson: string | null;
  ipAddress: string | null;
  createdAt: number;
}

export class ZencodeDatabase {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly logger?: Logger;

  constructor(options: { dbPath: string; logger?: Logger }) {
    this.dbPath = options.dbPath;
    this.logger = options.logger?.child({ module: "zencode-db" });

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'developer',
        tier TEXT NOT NULL DEFAULT 'free',
        can_use_private_fleet INTEGER NOT NULL DEFAULT 0,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        allowed_fleets_json TEXT NOT NULL DEFAULT '["llm","cloudflare_clef"]',
        google_sub TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_active_at INTEGER,
        last_reset_date TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
      CREATE INDEX IF NOT EXISTS idx_users_key_hash ON users (key_hash);
      CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

      CREATE TABLE IF NOT EXISTS user_quotas (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        llm_enabled INTEGER DEFAULT 1,
        llm_tier TEXT DEFAULT 'standard',
        daily_token_budget INTEGER DEFAULT 1000000,
        used_today_tokens INTEGER DEFAULT 0,
        allow_claude_opus INTEGER DEFAULT 0,
        modal_gpu_enabled INTEGER DEFAULT 0,
        daily_gpu_minutes REAL DEFAULT 0,
        used_today_gpu_minutes REAL DEFAULT 0,
        clef_enabled INTEGER DEFAULT 1,
        daily_clef_requests INTEGER DEFAULT 1000,
        used_today_clef_requests INTEGER DEFAULT 0,
        tts_enabled INTEGER DEFAULT 0,
        daily_tts_minutes REAL DEFAULT 0,
        used_today_tts_minutes REAL DEFAULT 0,
        t2i_enabled INTEGER DEFAULT 0,
        daily_t2i_images INTEGER DEFAULT 0,
        used_today_t2i_images INTEGER DEFAULT 0,
        img2img_enabled INTEGER DEFAULT 0,
        daily_img2img_edits INTEGER DEFAULT 0,
        used_today_img2img_edits INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_credits (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance REAL DEFAULT 0.0 CHECK(balance >= 0),
        total_deposited REAL DEFAULT 0.0 CHECK(total_deposited >= 0),
        total_consumed REAL DEFAULT 0.0 CHECK(total_consumed >= 0),
        updated_at INTEGER NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS trg_user_credits_prevent_negative_balance
      BEFORE UPDATE ON user_credits
      FOR EACH ROW
      WHEN NEW.balance < 0
      BEGIN
        SELECT RAISE(ABORT, 'user_credits balance cannot be negative');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_user_credits_prevent_negative_insert
      BEFORE INSERT ON user_credits
      FOR EACH ROW
      WHEN NEW.balance < 0
      BEGIN
        SELECT RAISE(ABORT, 'user_credits balance cannot be negative');
      END;

      CREATE TABLE IF NOT EXISTS billing_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        order_code TEXT UNIQUE NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'VND',
        provider TEXT NOT NULL DEFAULT 'sepay',
        status TEXT NOT NULL DEFAULT 'PENDING',
        plan_code TEXT,
        credits_added REAL DEFAULT 0.0,
        bank_account TEXT,
        transfer_content TEXT,
        raw_webhook_json TEXT,
        created_at INTEGER NOT NULL,
        verified_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_billing_order_code ON billing_transactions (order_code);
      CREATE INDEX IF NOT EXISTS idx_billing_user_id ON billing_transactions (user_id);
      CREATE INDEX IF NOT EXISTS idx_billing_status ON billing_transactions (status);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT NOT NULL,
        details_json TEXT,
        ip_address TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs (user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs (created_at);
    `);
  }

  // ─────────────────────────────────────────────────────────────
  // Migration from user_keys.json
  // ─────────────────────────────────────────────────────────────

  public migrateFromLegacyLedger(jsonPath: string): { migratedCount: number; errors: number } {
    if (!existsSync(jsonPath)) {
      return { migratedCount: 0, errors: 0 };
    }

    let migratedCount = 0;
    let errors = 0;

    try {
      const raw = readFileSync(jsonPath, "utf-8");
      const data = JSON.parse(raw);
      if (!data.users || typeof data.users !== "object") {
        return { migratedCount: 0, errors: 0 };
      }

      for (const [id, u] of Object.entries(data.users)) {
        try {
          const user = u as UserRecord;
          this.upsertUserAndQuotas(user);
          migratedCount++;
        } catch (e) {
          errors++;
          this.logger?.warn({ err: e, userId: id }, "Failed to migrate legacy user record");
        }
      }

      this.logger?.info(
        { migratedCount, errors, jsonPath },
        "Migrated users from legacy JSON ledger to SQLite WAL",
      );
    } catch (err) {
      this.logger?.error({ err, jsonPath }, "Failed to read legacy ledger for migration");
    }

    return { migratedCount, errors };
  }

  // ─────────────────────────────────────────────────────────────
  // User & Quota Operations
  // ─────────────────────────────────────────────────────────────

  public upsertUserAndQuotas(user: UserRecord): void {
    const createdAtMs = user.createdAt ? new Date(user.createdAt).getTime() : Date.now();
    const expiresAtMs = user.expiresAt ? new Date(user.expiresAt).getTime() : null;
    const lastActiveAtMs = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : null;
    const lastResetDate = user.lastResetDate || new Date().toISOString().slice(0, 10);
    const now = Date.now();

    const stmtUser = this.db.prepare(`
      INSERT OR REPLACE INTO users (
        id, username, display_name, email, role, tier,
        can_use_private_fleet, key_hash, key_prefix, status,
        allowed_fleets_json, google_sub, created_at, expires_at,
        last_active_at, last_reset_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmtUser.run(
      user.id,
      user.username,
      user.displayName,
      user.email || null,
      user.role,
      user.tier,
      user.canUsePrivateFleet ? 1 : 0,
      user.keyHash,
      user.keyPrefix,
      user.status,
      JSON.stringify(user.allowedFleets || []),
      user.googleSub || null,
      createdAtMs,
      expiresAtMs,
      lastActiveAtMs,
      lastResetDate,
    );

    const q = user.quotas;
    const s = q.services || UserKeyLedger.getDefaultServiceQuotas(user.tier);

    const stmtQuotas = this.db.prepare(`
      INSERT OR REPLACE INTO user_quotas (
        user_id, llm_enabled, llm_tier, daily_token_budget, used_today_tokens,
        allow_claude_opus, modal_gpu_enabled, daily_gpu_minutes, used_today_gpu_minutes,
        clef_enabled, daily_clef_requests, used_today_clef_requests,
        tts_enabled, daily_tts_minutes, used_today_tts_minutes,
        t2i_enabled, daily_t2i_images, used_today_t2i_images,
        img2img_enabled, daily_img2img_edits, used_today_img2img_edits,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmtQuotas.run(
      user.id,
      q.llm?.enabled ? 1 : 0,
      q.llm?.tier || "standard",
      q.llm?.dailyTokenBudget || 1000000,
      q.llm?.usedTodayTokens || 0,
      q.llm?.allowClaudeOpus ? 1 : 0,
      q.modal_gpu?.enabled ? 1 : 0,
      q.modal_gpu?.dailyGpuMinutes || 0,
      q.modal_gpu?.usedTodayMinutes || 0,
      q.cloudflare_clef?.enabled ? 1 : 0,
      q.cloudflare_clef?.dailyRequests || 1000,
      q.cloudflare_clef?.usedTodayRequests || 0,
      s.tts?.enabled ? 1 : 0,
      s.tts?.dailyMinutes || 0,
      s.tts?.usedTodayMinutes || 0,
      s.t2image?.enabled ? 1 : 0,
      s.t2image?.dailyImages || 0,
      s.t2image?.usedTodayImages || 0,
      s.img2img?.enabled ? 1 : 0,
      s.img2img?.dailyEdits || 0,
      s.img2img?.usedTodayEdits || 0,
      now,
    );

    // Ensure credits record exists
    const stmtCredit = this.db.prepare(`
      INSERT OR IGNORE INTO user_credits (user_id, balance, total_deposited, total_consumed, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const initialBalance = user.tier === "enterprise" ? 5000 : user.tier === "pro" ? 1000 : 200;
    stmtCredit.run(user.id, initialBalance, initialBalance, 0, now);
  }

  public getUserById(id: string): UserRecord | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
      | Record<string, any>
      | undefined;
    if (!row) return null;
    return this.hydrateUserRecord(row);
  }

  public getUserByUsername(username: string): UserRecord | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as
      | Record<string, any>
      | undefined;
    if (!row) return null;
    return this.hydrateUserRecord(row);
  }

  public getUserByGoogleSub(googleSub: string): UserRecord | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE google_sub = ?`).get(googleSub) as
      | Record<string, any>
      | undefined;
    if (!row) return null;
    return this.hydrateUserRecord(row);
  }

  public getUserByEmail(email: string): UserRecord | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as
      | Record<string, any>
      | undefined;
    if (!row) return null;
    return this.hydrateUserRecord(row);
  }

  public getAllUsers(): UserRecord[] {
    const rows = this.db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as Record<
      string,
      any
    >[];
    return rows.map((r) => this.hydrateUserRecord(r));
  }

  private hydrateUserRecord(row: Record<string, any>): UserRecord {
    const quotaRow = this.db.prepare(`SELECT * FROM user_quotas WHERE user_id = ?`).get(row.id) as
      | Record<string, any>
      | undefined;

    const allowedFleets: FleetName[] = JSON.parse(
      row.allowed_fleets_json || '["llm","cloudflare_clef"]',
    );

    const quotas = {
      llm: {
        enabled: Boolean(quotaRow?.llm_enabled ?? 1),
        tier: (quotaRow?.llm_tier || "standard") as "standard" | "pro" | "ultra",
        dailyTokenBudget: Number(quotaRow?.daily_token_budget ?? 1000000),
        usedTodayTokens: Number(quotaRow?.used_today_tokens ?? 0),
        allowedModels: ["codex", "gemini-2.5-flash", "claude-3.5-haiku"],
        allowClaudeOpus: Boolean(quotaRow?.allow_claude_opus ?? 0),
      },
      modal_gpu: {
        enabled: Boolean(quotaRow?.modal_gpu_enabled ?? 0),
        dailyGpuMinutes: Number(quotaRow?.daily_gpu_minutes ?? 0),
        usedTodayMinutes: Number(quotaRow?.used_today_gpu_minutes ?? 0),
        allowedApps: ["omni-voice", "qwen-image"],
      },
      cloudflare_clef: {
        enabled: Boolean(quotaRow?.clef_enabled ?? 1),
        dailyRequests: Number(quotaRow?.daily_clef_requests ?? 1000),
        usedTodayRequests: Number(quotaRow?.used_today_clef_requests ?? 0),
      },
      services: {
        tts: {
          enabled: Boolean(quotaRow?.tts_enabled ?? 0),
          dailyMinutes: Number(quotaRow?.daily_tts_minutes ?? 0),
          usedTodayMinutes: Number(quotaRow?.used_today_tts_minutes ?? 0),
          appName: "Omni Voice App",
        },
        t2image: {
          enabled: Boolean(quotaRow?.t2i_enabled ?? 0),
          dailyImages: Number(quotaRow?.daily_t2i_images ?? 0),
          usedTodayImages: Number(quotaRow?.used_today_t2i_images ?? 0),
          model: "Qwen Image 2.1",
        },
        img2img: {
          enabled: Boolean(quotaRow?.img2img_enabled ?? 0),
          dailyEdits: Number(quotaRow?.daily_img2img_edits ?? 0),
          usedTodayEdits: Number(quotaRow?.used_today_img2img_edits ?? 0),
          model: "Qwen 2.1 Image Edit",
        },
        video: {
          enabled: false,
          status: "unsupported" as const,
          note: "Chưa hỗ trợ App Video trong phiên bản hiện tại",
        },
      },
    };

    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role as UserRole,
      tier: row.tier as CodexTier,
      canUsePrivateFleet: Boolean(row.can_use_private_fleet),
      keyHash: row.key_hash,
      keyPrefix: row.key_prefix,
      status: row.status as "active" | "suspended" | "revoked",
      allowedFleets,
      quotas,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      lastActiveAt: row.last_active_at ? new Date(row.last_active_at).toISOString() : undefined,
      lastResetDate: row.last_reset_date,
      email: row.email ?? null,
      googleSub: row.google_sub ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Credit Operations
  // ─────────────────────────────────────────────────────────────

  public getUserCredits(userId: string): UserCreditEntity {
    const row = this.db
      .prepare(`
      SELECT
        user_id,
        ROUND(balance, 4) AS balance,
        ROUND(total_deposited, 4) AS total_deposited,
        ROUND(total_consumed, 4) AS total_consumed,
        updated_at
      FROM user_credits
      WHERE user_id = ?
    `)
      .get(userId) as Record<string, any> | undefined;

    if (!row) {
      const now = Date.now();
      this.db
        .prepare(`
        INSERT OR IGNORE INTO user_credits (user_id, balance, total_deposited, total_consumed, updated_at)
        VALUES (?, 0, 0, 0, ?)
      `)
        .run(userId, now);
      return {
        userId,
        balance: 0,
        totalDeposited: 0,
        totalConsumed: 0,
        updatedAt: now,
      };
    }
    return {
      userId: row.user_id,
      balance: roundCreditPrecision(row.balance),
      totalDeposited: roundCreditPrecision(row.total_deposited),
      totalConsumed: roundCreditPrecision(row.total_consumed),
      updatedAt: Number(row.updated_at),
    };
  }

  public addCredits(userId: string, amount: number): UserCreditEntity {
    const sanitizedAmount = roundCreditPrecision(Math.max(0, amount));
    if (sanitizedAmount === 0) {
      return this.getUserCredits(userId);
    }
    const now = Date.now();
    this.db
      .prepare(`
      INSERT INTO user_credits (user_id, balance, total_deposited, total_consumed, updated_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        balance = ROUND(balance + excluded.balance, 4),
        total_deposited = ROUND(total_deposited + excluded.total_deposited, 4),
        updated_at = excluded.updated_at
    `)
      .run(userId, sanitizedAmount, sanitizedAmount, now);

    return this.getUserCredits(userId);
  }

  public deductCredits(userId: string, amount: number): { success: boolean; newBalance: number } {
    const deductAmount = roundCreditPrecision(Math.max(0, amount));
    if (deductAmount === 0) {
      const cur = this.getUserCredits(userId);
      return { success: true, newBalance: cur.balance };
    }

    const cur = this.getUserCredits(userId);
    if (cur.balance < deductAmount) {
      return { success: false, newBalance: cur.balance };
    }

    const now = Date.now();
    const result = this.db
      .prepare(`
      UPDATE user_credits
      SET balance = ROUND(balance - ?, 4),
          total_consumed = ROUND(total_consumed + ?, 4),
          updated_at = ?
      WHERE user_id = ? AND balance >= ?
    `)
      .run(deductAmount, deductAmount, now, userId, deductAmount);

    if (result.changes === 0) {
      const current = this.getUserCredits(userId);
      return { success: false, newBalance: current.balance };
    }

    const updated = this.getUserCredits(userId);
    return { success: true, newBalance: updated.balance };
  }

  public deductCreditsForTokens(params: {
    userId: string;
    model: string;
    tokenCount: number;
    multiplier?: number;
  }): DeductCreditsResult {
    const tokenCount = Math.max(0, params.tokenCount);
    const mult = params.multiplier ?? resolveModelMultiplier(params.model);
    const chargedCredits = roundCreditPrecision((tokenCount * mult) / TOKENS_PER_Z_CREDIT);

    const cur = this.getUserCredits(params.userId);
    if (chargedCredits > 0 && (cur.balance < chargedCredits || cur.balance <= 0)) {
      return {
        success: false,
        chargedCredits,
        remainingBalance: cur.balance,
        error: "INSUFFICIENT_CREDITS",
      };
    }

    if (chargedCredits === 0) {
      return {
        success: true,
        chargedCredits: 0,
        remainingBalance: cur.balance,
      };
    }

    const deductResult = this.deductCredits(params.userId, chargedCredits);
    return {
      success: deductResult.success,
      chargedCredits,
      remainingBalance: deductResult.newBalance,
      error: deductResult.success ? undefined : "INSUFFICIENT_CREDITS",
    };
  }

  public linkGoogleSub(userId: string, googleSub: string, email?: string): void {
    this.db
      .prepare(`
      UPDATE users
      SET google_sub = COALESCE(google_sub, ?),
          email = COALESCE(email, ?)
      WHERE id = ?
    `)
      .run(googleSub, email || null, userId);
  }

  public updateUserPasskey(userId: string, keyHash: string, keyPrefix: string): void {
    this.db
      .prepare(`
      UPDATE users
      SET key_hash = ?, key_prefix = ?
      WHERE id = ?
    `)
      .run(keyHash, keyPrefix, userId);
  }

  public checkAndRefillMonthlyCredits(userId: string): MonthlyRefillResult | null {
    const user = this.getUserById(userId);
    if (!user) return null;

    const credits = this.getUserCredits(userId);
    const now = Date.now();
    const todayUtc = new Date(now).toISOString().slice(0, 10);
    const lastResetStr = user.lastResetDate || todayUtc;
    const lastResetTime = new Date(`${lastResetStr.slice(0, 10)}T00:00:00.000Z`).getTime();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const daysElapsed = Math.floor((now - lastResetTime) / MS_PER_DAY);

    if (user.tier === "free" && daysElapsed >= 30) {
      // Non-accumulative reset to 200 Z-Credits (resets balance to 200 without stacking extra free credits)
      const newBalance = roundCreditPrecision(credits.balance < 200 ? 200 : credits.balance);

      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare(`
          UPDATE user_credits
          SET balance = ROUND(?, 4), updated_at = ?
          WHERE user_id = ?
        `)
          .run(newBalance, now, userId);

        this.db
          .prepare(`
          UPDATE users
          SET last_reset_date = ?
          WHERE id = ?
        `)
          .run(todayUtc, userId);

        this.recordAudit({
          userId,
          action: "MONTHLY_CREDITS_REFILL",
          detailsJson: JSON.stringify({
            previousBalance: credits.balance,
            newBalance,
            previousResetDate: lastResetStr,
            refillDate: todayUtc,
            daysElapsed,
          }),
        });
        this.db.exec("COMMIT");

        const nextResetDate = new Date(
          new Date(`${todayUtc}T00:00:00.000Z`).getTime() + 30 * MS_PER_DAY,
        )
          .toISOString()
          .slice(0, 10);
        return {
          refilled: true,
          balance: newBalance,
          lastResetDate: todayUtc,
          nextResetDate,
        };
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }

    const nextResetDate = new Date(lastResetTime + 30 * MS_PER_DAY).toISOString().slice(0, 10);
    return {
      refilled: false,
      balance: credits.balance,
      lastResetDate: lastResetStr,
      nextResetDate,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Billing Operations (VietQR, SePay)
  // ─────────────────────────────────────────────────────────────

  public createBillingOrder(params: {
    userId: string;
    orderCode: string;
    amount: number;
    planCode: string;
    provider?: "sepay" | "vietqr" | "stripe";
    currency?: string;
  }): BillingTransactionEntity {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const provider = params.provider || "sepay";
    const currency = params.currency || "VND";

    this.db
      .prepare(`
      INSERT INTO billing_transactions (
        id, user_id, order_code, amount, currency, provider,
        status, plan_code, credits_added, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, 0, ?)
    `)
      .run(
        id,
        params.userId,
        params.orderCode,
        params.amount,
        currency,
        provider,
        params.planCode,
        now,
      );

    return {
      id,
      userId: params.userId,
      orderCode: params.orderCode,
      amount: params.amount,
      currency,
      provider,
      status: "PENDING",
      planCode: params.planCode,
      creditsAdded: 0,
      bankAccount: null,
      transferContent: null,
      rawWebhookJson: null,
      createdAt: now,
      verifiedAt: null,
    };
  }

  public getBillingOrderByCode(orderCode: string): BillingTransactionEntity | null {
    const row = this.db
      .prepare(`SELECT * FROM billing_transactions WHERE order_code = ?`)
      .get(orderCode) as Record<string, any> | undefined;
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      orderCode: row.order_code,
      amount: Number(row.amount),
      currency: row.currency,
      provider: row.provider,
      status: row.status,
      planCode: row.plan_code,
      creditsAdded: Number(row.credits_added),
      bankAccount: row.bank_account,
      transferContent: row.transfer_content,
      rawWebhookJson: row.raw_webhook_json,
      createdAt: Number(row.created_at),
      verifiedAt: row.verified_at ? Number(row.verified_at) : null,
    };
  }

  public completeBillingOrder(params: {
    orderCode: string;
    rawWebhook: Record<string, any>;
    transferContent?: string;
    bankAccount?: string;
  }): { success: boolean; order?: BillingTransactionEntity; error?: string } {
    const order = this.getBillingOrderByCode(params.orderCode);
    if (!order) {
      return { success: false, error: "Order not found" };
    }
    if (order.status === "COMPLETED") {
      return { success: true, order };
    }

    const now = Date.now();
    let creditsToAdd = 0;

    // Apply plan benefit or credit bonus
    if (order.planCode === "pro_monthly") {
      // Upgrade user to Pro Tier for 30 days
      const expireTime = now + 30 * 24 * 60 * 60 * 1000;
      this.db
        .prepare(`
        UPDATE users
        SET tier = 'pro',
            expires_at = ?
        WHERE id = ?
      `)
        .run(expireTime, order.userId);

      // Upgrade quota
      this.db
        .prepare(`
        UPDATE user_quotas
        SET llm_tier = 'pro',
            daily_token_budget = 20000000,
            modal_gpu_enabled = 1,
            daily_gpu_minutes = 60,
            tts_enabled = 1,
            daily_tts_minutes = 15,
            t2i_enabled = 1,
            daily_t2i_images = 20,
            img2img_enabled = 1,
            daily_img2img_edits = 15,
            updated_at = ?
        WHERE user_id = ?
      `)
        .run(now, order.userId);

      creditsToAdd = 500; // Bonus 500 credits for Pro signup
    } else if (order.planCode === "credits_pack_50") {
      creditsToAdd = 50000;
    } else if (order.planCode === "credits_pack_100") {
      creditsToAdd = 120000; // 20% bonus
    } else if (order.planCode === "credits_pack_500") {
      creditsToAdd = 700000; // 40% bonus
    } else {
      // 1 VND = 1 Credit
      creditsToAdd = order.amount;
    }

    if (creditsToAdd > 0) {
      this.addCredits(order.userId, creditsToAdd);
    }

    this.db
      .prepare(`
      UPDATE billing_transactions
      SET status = 'COMPLETED',
          verified_at = ?,
          credits_added = ?,
          bank_account = ?,
          transfer_content = ?,
          raw_webhook_json = ?
      WHERE order_code = ?
    `)
      .run(
        now,
        creditsToAdd,
        params.bankAccount || null,
        params.transferContent || null,
        JSON.stringify(params.rawWebhook),
        params.orderCode,
      );

    this.recordAudit({
      userId: order.userId,
      action: "BILLING_ORDER_COMPLETED",
      detailsJson: JSON.stringify({
        orderCode: order.orderCode,
        amount: order.amount,
        planCode: order.planCode,
        creditsAdded: creditsToAdd,
      }),
    });

    const updated = this.getBillingOrderByCode(params.orderCode);
    return { success: true, order: updated || undefined };
  }

  // ─────────────────────────────────────────────────────────────
  // Audit Logs
  // ─────────────────────────────────────────────────────────────

  public recordAudit(params: {
    userId?: string | null;
    action: string;
    detailsJson?: string | null;
    ipAddress?: string | null;
  }): void {
    const now = Date.now();
    try {
      this.db
        .prepare(`
        INSERT INTO audit_logs (user_id, action, details_json, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
        .run(
          params.userId || null,
          params.action,
          params.detailsJson || null,
          params.ipAddress || null,
          now,
        );
    } catch {
      // Non-blocking fallback
    }
  }

  public close(): void {
    this.db.close();
  }
}

let defaultZencodeDatabase: ZencodeDatabase | null = null;

export function getZencodeDatabase(options?: {
  dbPath?: string;
  logger?: Logger;
}): ZencodeDatabase {
  if (!defaultZencodeDatabase) {
    let dbPath = options?.dbPath || process.env.ZENCODE_DATABASE_PATH;
    if (!dbPath) {
      if (process.cwd().endsWith("packages/server")) {
        dbPath = join(process.cwd(), "data/zencode_master.db");
      } else {
        dbPath = join(process.cwd(), "packages/server/data/zencode_master.db");
      }
    }
    defaultZencodeDatabase = new ZencodeDatabase({
      dbPath,
      logger: options?.logger,
    });
  }
  return defaultZencodeDatabase;
}
