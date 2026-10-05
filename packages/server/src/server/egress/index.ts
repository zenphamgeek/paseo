import crypto from "node:crypto";
import type { Logger } from "pino";

export interface ProxyProfile {
  id: string;
  url: string;
  healthScore: number;
  stickyForNodeId?: string;
  cooldownUntil?: number;
}

export class EgressManager {
  private readonly logger: Logger;
  private readonly proxyPool = new Map<string, ProxyProfile>();
  private readonly nodeBindings = new Map<string, string>(); // nodeId -> proxyId

  constructor(options: { logger: Logger; proxies?: Array<{ id: string; url: string }> }) {
    this.logger = options.logger.child({ module: "egress-manager" });
    if (options.proxies) {
      for (const p of options.proxies) {
        this.addProxy(p.id, p.url);
      }
    }
  }

  public addProxy(id: string, url: string): void {
    this.proxyPool.set(id, {
      id,
      url,
      healthScore: 1.0,
    });
  }

  public bindStickyProxy(nodeId: string, accountKey: string = ""): ProxyProfile | undefined {
    const existingProxyId = this.nodeBindings.get(nodeId);
    if (existingProxyId) {
      const p = this.proxyPool.get(existingProxyId);
      if (p && (!p.cooldownUntil || Date.now() > p.cooldownUntil)) {
        return p;
      }
    }

    // Select healthy proxy via stable hash
    const available = Array.from(this.proxyPool.values()).filter(
      (p) => !p.cooldownUntil || Date.now() > p.cooldownUntil,
    );

    if (available.length === 0) {
      return undefined;
    }

    const hash = crypto.createHash("sha256").update(`${nodeId}:${accountKey}`).digest("hex");
    const index = parseInt(hash.slice(0, 8), 16) % available.length;
    const selected = available[index];

    selected.stickyForNodeId = nodeId;
    this.nodeBindings.set(nodeId, selected.id);
    this.logger.info({ nodeId, proxyId: selected.id }, "Bound sticky egress proxy to node");
    return selected;
  }

  public reportRateLimit(nodeId: string, cooldownDurationMs: number = 900_000): void {
    const proxyId = this.nodeBindings.get(nodeId);
    if (!proxyId) return;

    const proxy = this.proxyPool.get(proxyId);
    if (proxy) {
      proxy.cooldownUntil = Date.now() + cooldownDurationMs;
      proxy.healthScore = Math.max(0.1, proxy.healthScore - 0.3);
      this.logger.warn(
        { nodeId, proxyId, cooldownUntil: proxy.cooldownUntil },
        "Proxy entered cooldown due to rate-limit",
      );
    }

    // Unbind so next request gets rotated to fresh proxy
    this.nodeBindings.delete(nodeId);
  }

  public getNodeEnv(nodeId: string): Record<string, string> {
    const proxyId = this.nodeBindings.get(nodeId);
    if (!proxyId) return {};

    const proxy = this.proxyPool.get(proxyId);
    if (!proxy || (proxy.cooldownUntil && Date.now() < proxy.cooldownUntil)) {
      return {};
    }

    return {
      HTTP_PROXY: proxy.url,
      HTTPS_PROXY: proxy.url,
      ALL_PROXY: proxy.url,
      NO_PROXY: "localhost,127.0.0.1,::1,.local",
    };
  }
}
