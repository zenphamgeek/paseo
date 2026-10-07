import { execFileSync } from "node:child_process";
import { hostname } from "node:os";

let hostName: string | undefined;

/**
 * Returns a sanitized, privacy-preserving host name/label.
 * SECURITY INVARIANT:
 * Never leak internal Kubernetes pod names, container IDs, worker hostnames,
 * or deployment hashes (e.g. zencode-prod-app-dc7878ff5-22qc7) to clients or UI.
 */
export function getHostName(): string {
  if (hostName) return hostName;

  // 1. Explicit environment override takes precedence
  const explicitOverride =
    process.env.PASEO_HOST_LABEL ||
    process.env.ZENCODE_HOST_LABEL ||
    process.env.PASEO_COMPUTER_NAME;
  if (explicitOverride && explicitOverride.trim()) {
    hostName = explicitOverride.trim();
    return hostName;
  }

  // 2. In production or containerized environments, default to an anonymous label
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.PASEO_NODE_ENV === "production";
  const isKubernetes =
    Boolean(process.env.KUBERNETES_SERVICE_HOST) || Boolean(process.env.ZENCODE_K8S);

  const raw =
    process.platform === "darwin"
      ? (() => {
          try {
            return execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], {
              encoding: "utf8",
            }).trim();
          } catch {
            return hostname();
          }
        })()
      : hostname();

  // If raw hostname matches pod hash patterns (e.g. zencode-prod-app-dc7878ff5-22qc7, 64-char container hex, etc.)
  const isPodOrContainerId =
    /^[a-z0-9-]+-[a-z0-9]{5,10}-[a-z0-9]{5}$/i.test(raw) ||
    /^[0-9a-f]{12,64}$/i.test(raw) ||
    raw.includes("-prod-") ||
    raw.includes("-qa-") ||
    raw.startsWith("pod-") ||
    raw.startsWith("k8s-") ||
    raw.includes(".inno");

  if (isProduction || isKubernetes || isPodOrContainerId) {
    hostName = "Zencode Cloud";
    return hostName;
  }

  hostName = raw || "Zencode Engine";
  return hostName;
}
