export interface AntiSybilCheckResult {
  allowed: boolean;
  status?: number;
  count: number;
  remaining: number;
  retryAfter?: number;
  error?: string;
}

export class AntiSybilLedger {
  // IP -> array of registration timestamps in milliseconds
  private readonly ipRegistrations: Map<string, number[]> = new Map();
  private readonly maxRegistrationsPerDay = 3;
  private readonly windowMs = 24 * 60 * 60 * 1000; // 24-hour sliding window

  /**
   * Extracts reliable client IP from Express request.
   * Prioritizes Cloudflare 'cf-connecting-ip', then parses first IP from comma-separated
   * 'x-forwarded-for', and falls back to socket remoteAddress.
   */
  public static extractClientIp(req: {
    headers?: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string };
  }): string {
    if (!req.headers) {
      return req.socket?.remoteAddress || "127.0.0.1";
    }

    const cfIp = req.headers["cf-connecting-ip"];
    if (typeof cfIp === "string" && cfIp.trim()) {
      return cfIp.trim();
    }
    if (Array.isArray(cfIp) && cfIp.length > 0 && typeof cfIp[0] === "string" && cfIp[0].trim()) {
      return cfIp[0].trim();
    }

    const xForwardedFor = req.headers["x-forwarded-for"];
    if (typeof xForwardedFor === "string" && xForwardedFor.trim()) {
      const first = xForwardedFor.split(",")[0].trim();
      if (first) return first;
    }
    if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
      const first = String(xForwardedFor[0]).split(",")[0].trim();
      if (first) return first;
    }

    return req.socket?.remoteAddress || "127.0.0.1";
  }

  /**
   * Extracts CIDR subnet group (/24 for IPv4, /48 for IPv6) for logging and abuse correlation.
   */
  public static extractSubnet(ip: string): string {
    const clean = ip.trim();
    if (clean.includes(".")) {
      const parts = clean.split(".");
      return parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : clean;
    }
    if (clean.includes(":")) {
      const parts = clean.split(":");
      return parts.length >= 3 ? `${parts[0]}:${parts[1]}:${parts[2]}::/48` : clean;
    }
    return clean;
  }

  /**
   * Detects automated bot User-Agents (python-requests, curl, aiohttp, etc.).
   */
  public static isBotUserAgent(userAgent?: string): boolean {
    if (!userAgent || typeof userAgent !== "string") {
      return false;
    }
    const lower = userAgent.toLowerCase().trim();
    return (
      lower.startsWith("python-requests") ||
      lower.startsWith("curl/") ||
      lower === "curl" ||
      lower.startsWith("curl ") ||
      lower.startsWith("aiohttp") ||
      lower.startsWith("python-urllib") ||
      lower.includes("python-requests") ||
      lower.includes("aiohttp")
    );
  }

  /**
   * Cleans up expired registration timestamps outside the sliding 24h window for an IP.
   */
  private getActiveTimestamps(cleanIp: string, now: number): number[] {
    const list = this.ipRegistrations.get(cleanIp) || [];
    const active = list.filter((ts) => now - ts < this.windowMs);
    if (active.length !== list.length) {
      if (active.length > 0) {
        this.ipRegistrations.set(cleanIp, active);
      } else {
        this.ipRegistrations.delete(cleanIp);
      }
    }
    return active;
  }

  /**
   * Checks whether a new registration is permitted without mutating ledger state.
   */
  public checkRegistration(ip: string, userAgent?: string): AntiSybilCheckResult {
    const now = Date.now();
    const cleanIp = ip.trim();

    // 1. Bot fingerprinting check
    if (AntiSybilLedger.isBotUserAgent(userAgent)) {
      const active = this.getActiveTimestamps(cleanIp, now);
      return {
        allowed: false,
        status: 429,
        count: active.length,
        remaining: 0,
        retryAfter: 86400,
        error: "Automated bot registration rejected. Please use a verified web browser.",
      };
    }

    // 2. Sliding 24h window IP rate limit
    const active = this.getActiveTimestamps(cleanIp, now);
    if (active.length >= this.maxRegistrationsPerDay) {
      return {
        allowed: false,
        status: 429,
        count: active.length,
        remaining: 0,
        retryAfter: 86400, // strict 86400 invariant requirement
        error: "Registration limit exceeded for this IP. Maximum 3 accounts per IP per day.",
      };
    }

    return {
      allowed: true,
      count: active.length,
      remaining: this.maxRegistrationsPerDay - active.length,
    };
  }

  /**
   * Records a successful account registration for an IP.
   */
  public recordRegistration(ip: string): void {
    const now = Date.now();
    const cleanIp = ip.trim();
    const active = this.getActiveTimestamps(cleanIp, now);
    active.push(now);
    this.ipRegistrations.set(cleanIp, active);
  }

  /**
   * Atomically checks and records a registration if permitted.
   */
  public checkAndRecord(ip: string, userAgent?: string): AntiSybilCheckResult {
    const check = this.checkRegistration(ip, userAgent);
    if (check.allowed) {
      this.recordRegistration(ip);
      return {
        ...check,
        count: check.count + 1,
        remaining: Math.max(0, check.remaining - 1),
      };
    }
    return check;
  }

  /**
   * Returns current registration count within sliding window for an IP.
   */
  public getRegistrationCount(ip: string): number {
    return this.getActiveTimestamps(ip.trim(), Date.now()).length;
  }

  /**
   * Resets all ledger records (used for test teardown).
   */
  public reset(): void {
    this.ipRegistrations.clear();
  }
}

let defaultAntiSybilLedger: AntiSybilLedger | null = null;

export function getAntiSybilLedger(): AntiSybilLedger {
  if (!defaultAntiSybilLedger) {
    defaultAntiSybilLedger = new AntiSybilLedger();
  }
  return defaultAntiSybilLedger;
}
