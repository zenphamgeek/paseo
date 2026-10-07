import type { CircuitBreakerStatus } from "./types.js";

export interface CircuitBreakerOptions {
  threshold?: number;
  resetTimeoutMs?: number;
}

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;
  private readonly failureCounts: Map<string, number> = new Map();
  private readonly lastFailureTimestamps: Map<string, number> = new Map();
  private readonly isolatedKeys: Set<string> = new Set();

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 2;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 5 * 60 * 1000; // 5 minutes auto-cooldown
  }

  public recordFailure(key: string): { isTripped: boolean; isolated: boolean } {
    const now = Date.now();
    const lastFailure = this.lastFailureTimestamps.get(key) ?? 0;

    // Reset counter if beyond timeout window
    let currentCount = this.failureCounts.get(key) ?? 0;
    if (now - lastFailure > this.resetTimeoutMs) {
      currentCount = 0;
    }

    currentCount += 1;
    this.failureCounts.set(key, currentCount);
    this.lastFailureTimestamps.set(key, now);

    const isTripped = currentCount >= this.threshold;
    if (isTripped) {
      this.isolatedKeys.add(key);
    }

    return {
      isTripped,
      isolated: this.isolatedKeys.has(key),
    };
  }

  public recordSuccess(key: string): void {
    this.failureCounts.delete(key);
    this.lastFailureTimestamps.delete(key);
    this.isolatedKeys.delete(key);
  }

  public isIsolated(key: string): boolean {
    if (!this.isolatedKeys.has(key)) return false;

    // Check if auto-reset timeout has passed
    const lastFailure = this.lastFailureTimestamps.get(key) ?? 0;
    if (Date.now() - lastFailure > this.resetTimeoutMs) {
      this.isolatedKeys.delete(key);
      this.failureCounts.delete(key);
      return false;
    }

    return true;
  }

  public reset(key?: string): void {
    if (key) {
      this.failureCounts.delete(key);
      this.lastFailureTimestamps.delete(key);
      this.isolatedKeys.delete(key);
    } else {
      this.failureCounts.clear();
      this.lastFailureTimestamps.clear();
      this.isolatedKeys.clear();
    }
  }

  public getStatus(): CircuitBreakerStatus {
    const counts: Record<string, number> = {};
    for (const [k, v] of this.failureCounts.entries()) {
      counts[k] = v;
    }
    return {
      isTripped: this.isolatedKeys.size > 0,
      isolatedHooks: Array.from(this.isolatedKeys),
      failureCounts: counts,
      threshold: this.threshold,
    };
  }
}
