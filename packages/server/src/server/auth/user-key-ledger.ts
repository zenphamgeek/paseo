import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "pino";

export type FleetName = "llm" | "modal_gpu" | "cloudflare_clef";
export type ServiceName = "tts" | "t2image" | "img2img" | "video";
export type UserRole = "admin" | "developer" | "researcher" | "guest";
export type CodexTier = "free" | "pro" | "team" | "enterprise";

export interface ServiceQuotas {
  tts: {
    enabled: boolean;
    dailyMinutes: number;
    usedTodayMinutes: number;
    appName: string; // "Omni Voice App"
  };
  t2image: {
    enabled: boolean;
    dailyImages: number;
    usedTodayImages: number;
    model: string; // "Qwen Image 2.1"
  };
  img2img: {
    enabled: boolean;
    dailyEdits: number;
    usedTodayEdits: number;
    model: string; // "Qwen 2.1 Image Edit"
  };
  video: {
    enabled: boolean; // false
    status: "unsupported" | "coming_soon";
    note: string; // "Chưa hỗ trợ App Video trong phiên bản hiện tại"
  };
}

export interface FleetQuotas {
  llm: {
    enabled: boolean;
    tier: "standard" | "pro" | "ultra";
    dailyTokenBudget: number;
    usedTodayTokens: number;
    allowedModels: string[];
    allowClaudeOpus: boolean;
  };
  modal_gpu: {
    enabled: boolean;
    dailyGpuMinutes: number;
    usedTodayMinutes: number;
    allowedApps: string[];
  };
  cloudflare_clef: {
    enabled: boolean;
    dailyRequests: number;
    usedTodayRequests: number;
  };
  services: ServiceQuotas;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  tier: CodexTier;
  canUsePrivateFleet: boolean; // Gated: ONLY granted manually by System Admin
  keyHash: string; // sha256:...
  keyPrefix: string; // zen_live_dev_a9d3...
  status: "active" | "suspended" | "revoked";
  allowedFleets: FleetName[];
  quotas: FleetQuotas;
  createdAt: string;
  expiresAt?: string | null;
  lastActiveAt?: string;
  lastResetDate?: string; // YYYY-MM-DD (UTC) - 30-day monthly refill cycle
  lastDailyResetDate?: string; // YYYY-MM-DD (UTC) - Daily quota rollover tracker
  email?: string | null;
  googleSub?: string | null;
}

export interface CreateUserOptions {
  username: string;
  displayName?: string;
  email?: string;
  googleSub?: string;
  role?: UserRole;
  tier?: CodexTier;
  canUsePrivateFleet?: boolean;
  allowedFleets?: FleetName[];
  dailyTokenBudget?: number;
  dailyGpuMinutes?: number;
  dailyRequests?: number;
  dailyTtsMinutes?: number;
  dailyT2Images?: number;
  dailyImg2ImgEdits?: number;
  allowClaudeOpus?: boolean;
  expiresInDays?: number;
}

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  tier: CodexTier;
  canUsePrivateFleet: boolean;
  keyPrefix: string;
  status: "active" | "suspended" | "revoked";
  allowedFleets: FleetName[];
  quotas: FleetQuotas;
  createdAt: string;
  expiresAt?: string | null;
  lastActiveAt?: string;
  lastResetDate?: string; // YYYY-MM-DD (UTC)
  lastDailyResetDate?: string; // YYYY-MM-DD (UTC)
  email?: string | null;
  googleSub?: string | null;
}

export const MODEL_MULTIPLIERS: Record<string, number> = {
  "cloudflare-clef": 0.0,
  clef: 0.0,
  codex: 1.0,
  "gemini-2.5-flash": 1.0,
  flash: 1.0,
  "claude-3.5-haiku": 3.0,
  haiku: 3.0,
  "gemini-2.5-pro": 5.0,
  pro: 5.0,
  "cx/gpt-5.6-terra": 8.0,
  terra: 8.0,
  "claude-sonnet-4.6": 12.0,
  sonnet: 12.0,
  "claude-opus-5-5": 35.0,
  "claude-opus-5": 35.0,
  "claude-opus-4.8": 35.0,
  opus: 35.0,
};

export function resolveModelMultiplier(model: string): number {
  if (!model) return 1.0;
  const lower = model.toLowerCase();
  for (const [key, mult] of Object.entries(MODEL_MULTIPLIERS)) {
    if (lower === key || lower.includes(key)) {
      return mult;
    }
  }
  return 1.0;
}

export class UserKeyLedger {
  private static registeredLedgers: Set<UserKeyLedger> = new Set();
  private static processHooksAttached: boolean = false;

  private ledgerPath: string;
  private users: Map<string, UserRecord> = new Map();
  private hashToUserId: Map<string, string> = new Map();
  private logger?: Logger;
  private initialAdminKey?: string;
  private lastMtimeMs: number = 0;

  // High-concurrency async quota pipeline state
  private isDirty: boolean = false;
  private dirtyUserIds: Set<string> = new Set();
  private debounceTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;
  private flushQueued: boolean = false;
  private isDestroyed: boolean = false;

  constructor(options: { storageDir: string; logger?: Logger }) {
    this.ledgerPath = path.join(options.storageDir, "user_keys.json");
    this.logger = options.logger;
    UserKeyLedger.registeredLedgers.add(this);
    this.loadFromDisk();
    this.startPeriodicSweep();
    this.attachProcessHooks();
  }

  public static hashToken(token: string): string {
    return "sha256:" + createHash("sha256").update(token.trim()).digest("hex");
  }

  public static getDefaultServiceQuotas(
    tier: CodexTier,
    options?: Partial<CreateUserOptions>,
  ): ServiceQuotas {
    if (tier === "free") {
      return {
        tts: {
          enabled: false,
          dailyMinutes: options?.dailyTtsMinutes ?? 0,
          usedTodayMinutes: 0,
          appName: "Omni Voice App",
        },
        t2image: {
          enabled: false,
          dailyImages: options?.dailyT2Images ?? 0,
          usedTodayImages: 0,
          model: "Qwen Image 2.1",
        },
        img2img: {
          enabled: false,
          dailyEdits: options?.dailyImg2ImgEdits ?? 0,
          usedTodayEdits: 0,
          model: "Qwen 2.1 Image Edit",
        },
        video: {
          enabled: false,
          status: "unsupported",
          note: "Chưa hỗ trợ App Video trong phiên bản hiện tại",
        },
      };
    }
    if (tier === "team") {
      return {
        tts: {
          enabled: true,
          dailyMinutes: options?.dailyTtsMinutes ?? 60,
          usedTodayMinutes: 0,
          appName: "Omni Voice App",
        },
        t2image: {
          enabled: true,
          dailyImages: options?.dailyT2Images ?? 100,
          usedTodayImages: 0,
          model: "Qwen Image 2.1",
        },
        img2img: {
          enabled: true,
          dailyEdits: options?.dailyImg2ImgEdits ?? 75,
          usedTodayEdits: 0,
          model: "Qwen 2.1 Image Edit",
        },
        video: {
          enabled: false,
          status: "unsupported",
          note: "Chưa hỗ trợ App Video trong phiên bản hiện tại",
        },
      };
    }
    if (tier === "enterprise") {
      return {
        tts: {
          enabled: true,
          dailyMinutes: options?.dailyTtsMinutes ?? 300,
          usedTodayMinutes: 0,
          appName: "Omni Voice App",
        },
        t2image: {
          enabled: true,
          dailyImages: options?.dailyT2Images ?? 500,
          usedTodayImages: 0,
          model: "Qwen Image 2.1",
        },
        img2img: {
          enabled: true,
          dailyEdits: options?.dailyImg2ImgEdits ?? 300,
          usedTodayEdits: 0,
          model: "Qwen 2.1 Image Edit",
        },
        video: {
          enabled: false,
          status: "unsupported",
          note: "Chưa hỗ trợ App Video trong phiên bản hiện tại (Liên hệ Admin để thử nghiệm Private Beta)",
        },
      };
    }
    // Default: Pro
    return {
      tts: {
        enabled: true,
        dailyMinutes: options?.dailyTtsMinutes ?? 15,
        usedTodayMinutes: 0,
        appName: "Omni Voice App",
      },
      t2image: {
        enabled: true,
        dailyImages: options?.dailyT2Images ?? 20,
        usedTodayImages: 0,
        model: "Qwen Image 2.1",
      },
      img2img: {
        enabled: true,
        dailyEdits: options?.dailyImg2ImgEdits ?? 15,
        usedTodayEdits: 0,
        model: "Qwen 2.1 Image Edit",
      },
      video: {
        enabled: false,
        status: "unsupported",
        note: "Chưa hỗ trợ App Video trong phiên bản hiện tại",
      },
    };
  }

  public getInitialAdminKey(): string | undefined {
    return this.initialAdminKey;
  }

  public reloadIfModified(): void {
    if (this.isDirty) return; // In-memory mutations are authoritative; do not overwrite with stale disk data
    try {
      if (fs.existsSync(this.ledgerPath)) {
        const stat = fs.statSync(this.ledgerPath);
        if (stat.mtimeMs > this.lastMtimeMs) {
          this.loadFromDisk();
        }
      }
    } catch {
      // ignore
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.ledgerPath)) {
        const stat = fs.statSync(this.ledgerPath);
        this.lastMtimeMs = stat.mtimeMs;
        const raw = fs.readFileSync(this.ledgerPath, "utf-8");
        const data = JSON.parse(raw);
        if (data.users && typeof data.users === "object") {
          for (const [id, user] of Object.entries(data.users)) {
            const u = user as UserRecord;
            if (!u.tier) {
              u.tier = u.role === "admin" ? "enterprise" : u.role === "developer" ? "pro" : "free";
            }
            if (typeof u.canUsePrivateFleet !== "boolean") {
              u.canUsePrivateFleet = false;
            }
            if (!u.quotas.services) {
              u.quotas.services = UserKeyLedger.getDefaultServiceQuotas(u.tier);
            }
            if (!u.lastResetDate) {
              u.lastResetDate = new Date().toISOString().slice(0, 10);
            }
            if (!u.lastDailyResetDate) {
              u.lastDailyResetDate = u.lastResetDate;
            }
            this.users.set(id, u);
            this.hashToUserId.set(u.keyHash, u.id);
          }
        }
      }
    } catch (err) {
      this.logger?.warn({ err }, "Failed to read user_keys.json, initializing empty ledger");
    }

    // If ledger is empty, provision default admin key
    if (this.users.size === 0) {
      const { rawKey } = this.createUser({
        username: "admin",
        displayName: "Master Cluster Admin",
        role: "admin",
        tier: "enterprise",
        canUsePrivateFleet: true,
        allowedFleets: ["llm", "modal_gpu", "cloudflare_clef"],
        dailyTokenBudget: 50_000_000,
        dailyGpuMinutes: 1440,
        dailyRequests: 100_000,
        allowClaudeOpus: true,
      });
      this.initialAdminKey = rawKey;
      this.logger?.info(
        { keyPrefix: rawKey.slice(0, 16) },
        "Provisioned default Master Admin Access Passkey",
      );
    }
  }

  /**
   * Synchronous flush with atomic tmp-file rename for administrative operations and exit hooks.
   */
  public flushSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    try {
      const dir = path.dirname(this.ledgerPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        users: Object.fromEntries(this.users.entries()),
      };
      const tmpPath = `${this.ledgerPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tmpPath, this.ledgerPath);
      this.lastMtimeMs = fs.statSync(this.ledgerPath).mtimeMs;
      this.isDirty = false;
      this.dirtyUserIds.clear();
    } catch (err) {
      this.logger?.error({ err }, "Failed to synchronously save user_keys.json to disk");
    }
  }

  private saveToDisk(): void {
    this.flushSync();
  }

  /**
   * Asynchronous flush pipeline with non-blocking atomic file replacement.
   */
  public async flushToDiskAsync(): Promise<void> {
    if (!this.isDirty) return;
    if (this.isFlushing) {
      this.flushQueued = true;
      return;
    }
    this.isFlushing = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    try {
      const dir = path.dirname(this.ledgerPath);
      await fs.promises.mkdir(dir, { recursive: true });
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        users: Object.fromEntries(this.users.entries()),
      };
      const tmpPath = `${this.ledgerPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.promises.rename(tmpPath, this.ledgerPath);
      const stat = await fs.promises.stat(this.ledgerPath);
      this.lastMtimeMs = stat.mtimeMs;
      this.isDirty = false;
      this.dirtyUserIds.clear();
    } catch (err) {
      this.logger?.error({ err }, "Failed to asynchronously flush user_keys.json to disk");
      this.isDirty = true;
    } finally {
      this.isFlushing = false;
      if (this.flushQueued) {
        this.flushQueued = false;
        void this.flushToDiskAsync();
      }
    }
  }

  /**
   * Debounces disk write with temporal scattering jitter (Stealth Mode Invariant).
   */
  private scheduleDebouncedFlush(): void {
    this.isDirty = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    const jitter = Math.floor(Math.random() * 400); // 800ms - 1200ms
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushToDiskAsync();
    }, 800 + jitter);
    if (this.debounceTimer.unref) {
      this.debounceTimer.unref();
    }
  }

  /**
   * Periodic background audit sweep with deperiodic temporal jitter [800ms, 3200ms].
   */
  private startPeriodicSweep(): void {
    const scheduleNext = () => {
      if (this.isDestroyed) return;
      const delay = Math.floor(800 + Math.random() * 2400);
      this.sweepTimer = setTimeout(() => {
        if (this.isDirty) {
          void this.flushToDiskAsync();
        }
        scheduleNext();
      }, delay);
      if (this.sweepTimer.unref) {
        this.sweepTimer.unref();
      }
    };
    scheduleNext();
  }

  /**
   * Attach process termination hooks to prevent quota loss on daemon shutdown.
   */
  private attachProcessHooks(): void {
    if (UserKeyLedger.processHooksAttached) return;
    UserKeyLedger.processHooksAttached = true;
    const onExit = () => {
      for (const ledger of UserKeyLedger.registeredLedgers) {
        if (ledger.isDirty && !ledger.isDestroyed) {
          ledger.flushSync();
        }
      }
    };
    process.once("beforeExit", onExit);
    process.once("SIGTERM", onExit);
    process.once("SIGINT", onExit);
  }

  /**
   * Cleanup method to release timers and flush unpersisted state.
   */
  public destroy(): void {
    this.isDestroyed = true;
    UserKeyLedger.registeredLedgers.delete(this);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.isDirty) {
      this.flushSync();
    }
  }

  public createUser(options: CreateUserOptions): { user: UserSummary; rawKey: string } {
    const role = options.role || "developer";
    const roleSlug = role === "developer" ? "dev" : role;
    const tier: CodexTier =
      options.tier || (role === "admin" ? "enterprise" : role === "developer" ? "pro" : "free");
    const canUsePrivateFleet = options.canUsePrivateFleet ?? false;

    const entropy = randomBytes(16).toString("hex");
    const rawKey = `zen_live_${roleSlug}_${entropy}`;
    const keyHash = UserKeyLedger.hashToken(rawKey);
    const keyPrefix = `${rawKey.slice(0, 16)}...`;

    const id = `usr_${options.username}_${randomBytes(4).toString("hex")}`;
    const allowedFleets = options.allowedFleets || ["llm", "cloudflare_clef"];

    let expiresAt: string | null = null;
    if (options.expiresInDays) {
      const d = new Date();
      d.setDate(d.getDate() + options.expiresInDays);
      expiresAt = d.toISOString();
    }

    // Codex-aligned quota presets
    let defaultTokens = 1_000_000;
    let defaultGpu = 45;
    let defaultClef = 5000;
    let allowedModels = ["codex", "gemini-2.5-pro", "gemini-2.5-flash", "cx/gpt-5.6-terra"];
    let allowClaudeOpus = false;

    if (tier === "free") {
      defaultTokens = 200_000;
      defaultGpu = 0;
      defaultClef = 1000;
      allowedModels = ["codex", "gemini-2.5-flash"];
      allowClaudeOpus = false;
    } else if (tier === "pro") {
      defaultTokens = 1_000_000;
      defaultGpu = 45;
      defaultClef = 5000;
      allowedModels = ["codex", "gemini-2.5-pro", "gemini-2.5-flash", "cx/gpt-5.6-terra"];
      allowClaudeOpus = false;
    } else if (tier === "team") {
      defaultTokens = 5_000_000;
      defaultGpu = 120;
      defaultClef = 20000;
      allowedModels = [
        "codex",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "cx/gpt-5.6-terra",
        "claude-sonnet-4.6",
      ];
      allowClaudeOpus = false;
    } else if (tier === "enterprise") {
      defaultTokens = role === "admin" ? 50_000_000 : 25_000_000;
      defaultGpu = 1440;
      defaultClef = 100000;
      allowedModels = [
        "codex",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "cx/gpt-5.6-terra",
        "claude-opus-4.8",
      ];
      allowClaudeOpus = true;
    }

    const services = UserKeyLedger.getDefaultServiceQuotas(tier, options);

    const quotas: FleetQuotas = {
      llm: {
        enabled: allowedFleets.includes("llm"),
        tier:
          tier === "enterprise" ? "ultra" : tier === "team" || tier === "pro" ? "pro" : "standard",
        dailyTokenBudget: options.dailyTokenBudget ?? defaultTokens,
        usedTodayTokens: 0,
        allowedModels,
        allowClaudeOpus: options.allowClaudeOpus ?? allowClaudeOpus,
      },
      modal_gpu: {
        enabled:
          allowedFleets.includes("modal_gpu") &&
          (options.dailyGpuMinutes !== undefined ? options.dailyGpuMinutes > 0 : defaultGpu > 0),
        dailyGpuMinutes: options.dailyGpuMinutes ?? defaultGpu,
        usedTodayMinutes: 0,
        allowedApps: ["qwen-draw", "flux-dev", "whisper-v3", "deep-embed"],
      },
      cloudflare_clef: {
        enabled: allowedFleets.includes("cloudflare_clef"),
        dailyRequests: options.dailyRequests ?? defaultClef,
        usedTodayRequests: 0,
      },
      services,
    };

    const todayUtc = new Date().toISOString().slice(0, 10);
    const record: UserRecord = {
      id,
      username: options.username,
      displayName: options.displayName || options.username,
      role,
      tier,
      canUsePrivateFleet,
      keyHash,
      keyPrefix,
      status: "active",
      allowedFleets,
      quotas,
      createdAt: new Date().toISOString(),
      expiresAt,
      lastResetDate: todayUtc,
      lastDailyResetDate: todayUtc,
      email: options.email ?? null,
      googleSub: options.googleSub ?? null,
    };

    this.users.set(id, record);
    this.hashToUserId.set(keyHash, id);
    this.saveToDisk();

    return {
      user: this.toSummary(record),
      rawKey,
    };
  }

  public checkDailyRollover(user: UserRecord): boolean {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const isNewDay =
      user.tier === "free"
        ? (user.lastDailyResetDate || user.lastResetDate) !== todayUtc
        : user.lastResetDate !== todayUtc || user.lastDailyResetDate !== todayUtc;

    if (isNewDay) {
      user.quotas.llm.usedTodayTokens = 0;
      user.quotas.modal_gpu.usedTodayMinutes = 0;
      user.quotas.cloudflare_clef.usedTodayRequests = 0;
      if (user.quotas.services) {
        user.quotas.services.tts.usedTodayMinutes = 0;
        user.quotas.services.t2image.usedTodayImages = 0;
        user.quotas.services.img2img.usedTodayEdits = 0;
      }
      user.lastDailyResetDate = todayUtc;

      // CRITICAL: For free tier users, do NOT overwrite user.lastResetDate!
      // It belongs to the 30-day monthly credit refill cycle.
      if (user.tier !== "free") {
        user.lastResetDate = todayUtc;
      }

      this.dirtyUserIds.add(user.id);
      this.scheduleDebouncedFlush();
      return true;
    }
    return false;
  }

  public resetUserUsage(id: string): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    user.quotas.llm.usedTodayTokens = 0;
    user.quotas.modal_gpu.usedTodayMinutes = 0;
    user.quotas.cloudflare_clef.usedTodayRequests = 0;
    if (user.quotas.services) {
      user.quotas.services.tts.usedTodayMinutes = 0;
      user.quotas.services.t2image.usedTodayImages = 0;
      user.quotas.services.img2img.usedTodayEdits = 0;
    }
    const todayUtc = new Date().toISOString().slice(0, 10);
    user.lastDailyResetDate = todayUtc;
    if (user.tier !== "free") {
      user.lastResetDate = todayUtc;
    }
    user.lastActiveAt = new Date().toISOString();
    this.flushSync();
    return true;
  }

  public findUserByToken(token: string): UserRecord | null {
    if (!token) return null;
    this.reloadIfModified();
    const hash = UserKeyLedger.hashToken(token);
    let userId = this.hashToUserId.get(hash);
    if (!userId) {
      // Disk-miss fallback: reload ledger if a new user was provisioned via CLI
      this.loadFromDisk();
      userId = this.hashToUserId.get(hash);
    }
    if (!userId) return null;
    const user = this.users.get(userId);
    if (!user) return null;

    this.checkDailyRollover(user);

    // Check expiration
    if (user.expiresAt && new Date(user.expiresAt).getTime() < Date.now()) {
      user.status = "revoked";
      this.dirtyUserIds.add(user.id);
      this.scheduleDebouncedFlush();
      return null;
    }

    return user;
  }

  public verifyKey(token: string): { valid: boolean; user?: UserSummary; error?: string } {
    const user = this.findUserByToken(token);
    if (!user) {
      return { valid: false, error: "Invalid or expired Access Passkey" };
    }
    if (user.status !== "active") {
      return { valid: false, error: `Account is ${user.status}` };
    }

    user.lastActiveAt = new Date().toISOString();
    this.dirtyUserIds.add(user.id);
    this.scheduleDebouncedFlush();

    return {
      valid: true,
      user: this.toSummary(user),
    };
  }

  public listUsers(): UserSummary[] {
    this.reloadIfModified();
    for (const u of this.users.values()) {
      this.checkDailyRollover(u);
    }
    return Array.from(this.users.values()).map((u) => this.toSummary(u));
  }

  public getUser(id: string): UserSummary | null {
    this.reloadIfModified();
    const user = this.users.get(id);
    if (!user) return null;
    this.checkDailyRollover(user);
    return this.toSummary(user);
  }

  public revokeUser(id: string): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    user.status = "revoked";
    this.flushSync();
    return true;
  }

  public adjustQuota(
    id: string,
    fleet: FleetName,
    adjustments: { addTokens?: number; addGpuMinutes?: number; addRequests?: number },
  ): boolean {
    const user = this.users.get(id);
    if (!user) return false;

    if (fleet === "llm" && adjustments.addTokens) {
      user.quotas.llm.dailyTokenBudget += adjustments.addTokens;
    } else if (fleet === "modal_gpu" && adjustments.addGpuMinutes) {
      user.quotas.modal_gpu.dailyGpuMinutes += adjustments.addGpuMinutes;
    } else if (fleet === "cloudflare_clef" && adjustments.addRequests) {
      user.quotas.cloudflare_clef.dailyRequests += adjustments.addRequests;
    }

    this.flushSync();
    return true;
  }

  public recordUsage(id: string, fleet: FleetName | string, amount: number): void {
    const user = this.users.get(id);
    if (!user) return;

    if (!user.quotas.services) {
      user.quotas.services = UserKeyLedger.getDefaultServiceQuotas(user.tier);
    }

    if (fleet === "llm") {
      user.quotas.llm.usedTodayTokens += amount;
    } else if (fleet === "modal_gpu") {
      user.quotas.modal_gpu.usedTodayMinutes += amount;
    } else if (fleet === "cloudflare_clef") {
      user.quotas.cloudflare_clef.usedTodayRequests += amount;
    } else if (fleet === "tts") {
      user.quotas.services.tts.usedTodayMinutes += amount;
    } else if (fleet === "t2image") {
      user.quotas.services.t2image.usedTodayImages += amount;
    } else if (fleet === "img2img") {
      user.quotas.services.img2img.usedTodayEdits += amount;
    }

    user.lastActiveAt = new Date().toISOString();
    this.dirtyUserIds.add(id);
    this.scheduleDebouncedFlush();
  }

  /**
   * Non-blocking model token usage with market credit multiplier.
   */
  public recordModelUsage(
    id: string,
    model: string,
    tokenCount: number,
  ): { chargedCredits: number; multiplier: number; remainingTokens: number } {
    const user = this.users.get(id);
    if (!user) {
      return { chargedCredits: 0, multiplier: 1.0, remainingTokens: 0 };
    }
    const multiplier = resolveModelMultiplier(model);
    const chargedCredits = Math.round(tokenCount * multiplier);

    user.quotas.llm.usedTodayTokens += chargedCredits;
    user.lastActiveAt = new Date().toISOString();
    this.dirtyUserIds.add(id);
    this.scheduleDebouncedFlush();

    const remaining = Math.max(
      0,
      user.quotas.llm.dailyTokenBudget - user.quotas.llm.usedTodayTokens,
    );
    return { chargedCredits, multiplier, remainingTokens: remaining };
  }

  public recordServiceUsage(
    id: string,
    service: "tts" | "t2image" | "img2img",
    amount: number,
  ): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    if (!user.quotas.services) {
      user.quotas.services = UserKeyLedger.getDefaultServiceQuotas(user.tier);
    }
    if (service === "tts") {
      user.quotas.services.tts.usedTodayMinutes += amount;
    } else if (service === "t2image") {
      user.quotas.services.t2image.usedTodayImages += amount;
    } else if (service === "img2img") {
      user.quotas.services.img2img.usedTodayEdits += amount;
    }
    user.lastActiveAt = new Date().toISOString();
    this.dirtyUserIds.add(id);
    this.scheduleDebouncedFlush();
    return true;
  }

  public hasServiceAccess(
    user: UserRecord,
    service: ServiceName,
  ): { allowed: boolean; reason?: string } {
    if (user.status !== "active") {
      return { allowed: false, reason: `User account is ${user.status}` };
    }
    if (!user.quotas.services) {
      user.quotas.services = UserKeyLedger.getDefaultServiceQuotas(user.tier);
    }
    if (service === "video") {
      return {
        allowed: false,
        reason: "Dịch vụ App Video chưa được hỗ trợ trong phiên bản hiện tại",
      };
    }
    const s = user.quotas.services[service];
    if (!s.enabled) {
      return {
        allowed: false,
        reason: `Dịch vụ '${service}' chưa được kích hoạt cho hạng ${user.tier.toUpperCase()}`,
      };
    }
    if (
      service === "tts" &&
      user.quotas.services.tts.dailyMinutes > 0 &&
      user.quotas.services.tts.usedTodayMinutes >= user.quotas.services.tts.dailyMinutes
    ) {
      return { allowed: false, reason: "Hạn mức TTS (Omni Voice App) hôm nay đã hết" };
    }
    if (
      service === "t2image" &&
      user.quotas.services.t2image.dailyImages > 0 &&
      user.quotas.services.t2image.usedTodayImages >= user.quotas.services.t2image.dailyImages
    ) {
      return { allowed: false, reason: "Hạn mức Text-to-Image (Qwen 2.1) hôm nay đã hết" };
    }
    if (
      service === "img2img" &&
      user.quotas.services.img2img.dailyEdits > 0 &&
      user.quotas.services.img2img.usedTodayEdits >= user.quotas.services.img2img.dailyEdits
    ) {
      return { allowed: false, reason: "Hạn mức Image Edit (Qwen 2.1) hôm nay đã hết" };
    }
    return { allowed: true };
  }

  public adjustServiceQuota(
    id: string,
    adjustments: { addTtsMinutes?: number; addT2Images?: number; addImg2ImgEdits?: number },
  ): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    if (!user.quotas.services) {
      user.quotas.services = UserKeyLedger.getDefaultServiceQuotas(user.tier);
    }
    if (adjustments.addTtsMinutes) {
      user.quotas.services.tts.dailyMinutes += adjustments.addTtsMinutes;
    }
    if (adjustments.addT2Images) {
      user.quotas.services.t2image.dailyImages += adjustments.addT2Images;
    }
    if (adjustments.addImg2ImgEdits) {
      user.quotas.services.img2img.dailyEdits += adjustments.addImg2ImgEdits;
    }
    user.lastActiveAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  public hasFleetAccess(user: UserRecord, fleet: FleetName): { allowed: boolean; reason?: string } {
    if (user.status !== "active") {
      return { allowed: false, reason: `User account is ${user.status}` };
    }

    if (!user.allowedFleets.includes(fleet)) {
      return {
        allowed: false,
        reason: `Passkey does not have access permissions for '${fleet}' fleet`,
      };
    }

    if (fleet === "llm") {
      const q = user.quotas.llm;
      if (!q.enabled) {
        return { allowed: false, reason: "'llm' fleet is currently disabled for this user" };
      }
      if (q.dailyTokenBudget > 0 && q.usedTodayTokens >= q.dailyTokenBudget) {
        return { allowed: false, reason: "Daily LLM token budget exhausted" };
      }
    } else if (fleet === "modal_gpu") {
      const q = user.quotas.modal_gpu;
      if (!q.enabled) {
        return { allowed: false, reason: "'modal_gpu' fleet is currently disabled for this user" };
      }
      if (q.dailyGpuMinutes > 0 && q.usedTodayMinutes >= q.dailyGpuMinutes) {
        return { allowed: false, reason: "Daily Modal GPU minutes exhausted" };
      }
    } else if (fleet === "cloudflare_clef") {
      const q = user.quotas.cloudflare_clef;
      if (!q.enabled) {
        return {
          allowed: false,
          reason: "'cloudflare_clef' fleet is currently disabled for this user",
        };
      }
      if (q.dailyRequests > 0 && q.usedTodayRequests >= q.dailyRequests) {
        return { allowed: false, reason: "Daily Cloudflare Clef request limit reached" };
      }
    }

    return { allowed: true };
  }

  public setPrivateFleetAccess(id: string, enabled: boolean): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    user.canUsePrivateFleet = enabled;
    user.lastActiveAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  private toSummary(u: UserRecord): UserSummary {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      tier: u.tier,
      canUsePrivateFleet: u.canUsePrivateFleet,
      keyPrefix: u.keyPrefix,
      status: u.status,
      allowedFleets: u.allowedFleets,
      quotas: u.quotas,
      createdAt: u.createdAt,
      expiresAt: u.expiresAt,
      lastActiveAt: u.lastActiveAt,
      lastResetDate: u.lastResetDate,
      lastDailyResetDate: u.lastDailyResetDate,
      email: u.email,
      googleSub: u.googleSub,
    };
  }
}

// Singleton helper
let globalUserKeyLedger: UserKeyLedger | null = null;

export function getUserKeyLedger(storageDir?: string, logger?: Logger): UserKeyLedger {
  if (!globalUserKeyLedger) {
    const dir = storageDir || path.join(process.env.HOME || "/home/zen", ".paseo");
    globalUserKeyLedger = new UserKeyLedger({ storageDir: dir, logger });
  }
  return globalUserKeyLedger;
}
