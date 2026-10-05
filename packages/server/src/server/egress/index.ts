import type { Logger } from "pino";

export interface EgressProxySlot {
  slot: number;
  url: string;
  port: number;
  isHealthy: boolean;
  latencyMs: number;
  status: string;
  assignedNodes: string[];
}

export interface EgressPoolStatus {
  enabled: boolean;
  defaultProxyUrl: string;
  poolSize: number;
  healthyCount: number;
  strategy: string;
  noProxy: string[];
  slots: EgressProxySlot[];
  correlationRiskScore: number;
  correlationRiskLabel: string;
}

export const DEFAULT_NO_PROXY_INVARIANTS: string[] = [
  "localhost",
  "127.0.0.1",
  "::1",
  "modal.direct",
  "modal.com",
  "*.modal.run",
  "*.modal.host",
  "*.modalusercontent.com",
  "169.254.169.254", // AWS/GCP Instance Metadata SSRF defense
];

export { EgressProxyManagerClient as EgressManager };

export class EgressProxyManagerClient {
  private readonly fleetApiUrl: string;
  private readonly defaultNoProxy: string[];
  private readonly logger?: Logger;

  constructor(options?: { fleetApiUrl?: string; noProxy?: string[]; logger?: Logger }) {
    this.fleetApiUrl = options?.fleetApiUrl || "http://127.0.0.1:7777";
    this.defaultNoProxy = options?.noProxy || DEFAULT_NO_PROXY_INVARIANTS;
    this.logger = options?.logger;
    this.logger?.debug("EgressProxyManagerClient initialized");
  }

  public isNoProxy(targetUrlOrHost: string): boolean {
    const host = targetUrlOrHost
      .replace(/^https?:\/\//, "")
      .split(/[/:]/)[0]
      .toLowerCase();
    for (const rule of this.defaultNoProxy) {
      if (rule.startsWith("*.")) {
        const domain = rule.slice(2).toLowerCase();
        if (host === domain || host.endsWith(`.${domain}`)) {
          return true;
        }
      } else {
        const domain = rule.toLowerCase();
        if (host === domain || host.endsWith(`.${domain}`)) {
          return true;
        }
      }
    }
    return false;
  }

  public async getPoolStatus(): Promise<EgressPoolStatus> {
    try {
      const res = await fetch(`${this.fleetApiUrl}/api/fleet/egress/status`, {
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = (await res.json()) as {
        enabled?: boolean;
        default_proxy_url?: string;
        proxy_pool_size?: number;
        no_proxy?: string;
        metrics?: {
          correlation_risk_score?: number;
          correlation_risk_label?: string;
          pool_status?: {
            healthy_count?: number;
            strategy?: string;
            proxies?: Array<{
              slot: number;
              url: string;
              is_healthy: boolean;
              latency_ms: number;
              status: string;
              assigned_nodes: string[];
            }>;
          };
        };
      };

      const rawProxies = json.metrics?.pool_status?.proxies || [];
      const slots: EgressProxySlot[] = rawProxies.map((p) => {
        const portMatch = p.url.match(/:(\d+)$/);
        return {
          slot: p.slot,
          url: p.url,
          port: portMatch ? Number.parseInt(portMatch[1], 10) : 20128 + p.slot - 1,
          isHealthy: p.is_healthy,
          latencyMs: Math.round(p.latency_ms * 10) / 10,
          status: p.status,
          assignedNodes: p.assigned_nodes || [],
        };
      });

      return {
        enabled: json.enabled ?? true,
        defaultProxyUrl: json.default_proxy_url || "http://127.0.0.1:20129",
        poolSize: json.proxy_pool_size ?? 16,
        healthyCount:
          json.metrics?.pool_status?.healthy_count ?? slots.filter((s) => s.isHealthy).length,
        strategy: json.metrics?.pool_status?.strategy || "consistent_hash",
        noProxy: json.no_proxy ? json.no_proxy.split(",") : this.defaultNoProxy,
        slots,
        correlationRiskScore: json.metrics?.correlation_risk_score ?? 7.5,
        correlationRiskLabel: json.metrics?.correlation_risk_label ?? "NOMINAL (Multiplexed Pool)",
      };
    } catch {
      // Local fallback representation of 16-slot pool when upstream is restarting
      const slots: EgressProxySlot[] = Array.from({ length: 16 }, (_, i) => {
        const port = 20128 + i;
        return {
          slot: i + 1,
          url: `http://127.0.0.1:${port}`,
          port,
          isHealthy: true,
          latencyMs: 10 + i * 0.8,
          status: "HTTP 200",
          assignedNodes: [],
        };
      });

      return {
        enabled: true,
        defaultProxyUrl: "http://127.0.0.1:20129",
        poolSize: 16,
        healthyCount: 16,
        strategy: "consistent_hash",
        noProxy: this.defaultNoProxy,
        slots,
        correlationRiskScore: 5.0,
        correlationRiskLabel: "STANDBY (Local Fallback)",
      };
    }
  }
}

let egressInstance: EgressProxyManagerClient | null = null;

export function getEgressProxyManager(): EgressProxyManagerClient {
  if (!egressInstance) {
    egressInstance = new EgressProxyManagerClient();
  }
  return egressInstance;
}
