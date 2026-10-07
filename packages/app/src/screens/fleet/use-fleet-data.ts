import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalyticsTimeRange,
  DispatchTaskPayload,
  FleetAuthMatrix,
  FleetClusterSummary,
  FleetCouncilData,
  FleetJobRecord,
  FleetNodeSummary,
  SwarmTelemetrySnapshot,
} from "./types";

function getDaemonApiBaseUrl(): string {
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    !window.location.origin.startsWith("file:")
  ) {
    return window.location.origin;
  }
  return "http://127.0.0.1:6768";
}

const DEFAULT_SUMMARY: FleetClusterSummary = {
  totalNodes: 15,
  onlineNodes: 15,
  busyNodes: 0,
  ultraNodes: 3,
  proNodes: 12,
  totalTokensCapacity: 15_000_000,
  totalTokensUsed: 1_250_000,
  overallQuotaPercent: 92,
  clusterHealth: "healthy",
  autonomousEnabled: true,
  activeCouncilMode: "hybrid",
};

async function extractJsonIfOk<T>(result: PromiseSettledResult<Response>): Promise<T | null> {
  if (result.status === "fulfilled" && result.value.ok) {
    try {
      return (await result.value.json()) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export function useFleetData(initialRetention: AnalyticsTimeRange = "24h") {
  const [retentionPeriod, setRetentionPeriodState] = useState<AnalyticsTimeRange>(initialRetention);
  const [nodes, setNodes] = useState<FleetNodeSummary[]>([]);
  const [summary, setSummary] = useState<FleetClusterSummary>(DEFAULT_SUMMARY);
  const [jobs, setJobs] = useState<FleetJobRecord[]>([]);
  const [council, setCouncil] = useState<FleetCouncilData | null>(null);
  const [telemetry, setTelemetry] = useState<SwarmTelemetrySnapshot | null>(null);
  const [authStatus, setAuthStatus] = useState<FleetAuthMatrix | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchAllFleetData = useCallback(
    async (silent = false, range: AnalyticsTimeRange = retentionPeriod) => {
      if (!silent) setIsLoading(true);
      const baseUrl = getDaemonApiBaseUrl();

      try {
        const settled = await Promise.allSettled([
          fetch(`${baseUrl}/api/fleet/nodes?range=${range}`),
          fetch(`${baseUrl}/api/fleet/summary`),
          fetch(`${baseUrl}/api/fleet/jobs`),
          fetch(`${baseUrl}/api/fleet/council`),
          fetch(`${baseUrl}/api/fleet/telemetry`),
          fetch(`${baseUrl}/api/fleet/auth/status`),
        ]);

        if (!mountedRef.current) return;

        const [nodesData, summaryData, jobsData, councilData, telemetryData, authData] =
          await Promise.all([
            extractJsonIfOk<{ nodes?: FleetNodeSummary[] }>(settled[0]),
            extractJsonIfOk<{ summary?: FleetClusterSummary }>(settled[1]),
            extractJsonIfOk<{ jobs?: FleetJobRecord[] }>(settled[2]),
            extractJsonIfOk<FleetCouncilData>(settled[3]),
            extractJsonIfOk<SwarmTelemetrySnapshot>(settled[4]),
            extractJsonIfOk<FleetAuthMatrix>(settled[5]),
          ]);

        if (nodesData?.nodes) setNodes(nodesData.nodes);
        if (summaryData?.summary) setSummary(summaryData.summary);
        if (jobsData?.jobs) setJobs(jobsData.jobs);
        if (councilData) setCouncil(councilData);
        if (telemetryData) setTelemetry(telemetryData);
        if (authData) setAuthStatus(authData);

        setLastUpdated(Date.now());
        setError(null);
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  const refreshQuotas = useCallback(async () => {
    setIsRefreshing(true);
    const baseUrl = getDaemonApiBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/fleet/quota/refresh`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.nodes)) setNodes(data.nodes);
        if (data.summary) setSummary(data.summary);
        setLastUpdated(Date.now());
      }
    } catch {
      // Soft fallback to standard fetch
      await fetchAllFleetData(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchAllFleetData]);

  const runAutoConfig = useCallback(async () => {
    setIsRefreshing(true);
    const baseUrl = getDaemonApiBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/fleet/auth/autoconfig`, { method: "POST" });
      if (res.ok) {
        const authRes = await fetch(`${baseUrl}/api/fleet/auth/status`);
        if (authRes.ok) {
          const json = (await authRes.json()) as FleetAuthMatrix;
          setAuthStatus(json);
        }
        return await res.json();
      }
    } catch (err) {
      console.warn("Auto-config failed", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const saveManualAuth = useCallback(
    async (provider: string, token: string, authType = "api_key", account?: string) => {
      const baseUrl = getDaemonApiBaseUrl();
      try {
        const res = await fetch(`${baseUrl}/api/fleet/auth/manual`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, token, authType, account }),
        });
        if (res.ok) {
          const authRes = await fetch(`${baseUrl}/api/fleet/auth/status`);
          if (authRes.ok) {
            const json = (await authRes.json()) as FleetAuthMatrix;
            setAuthStatus(json);
          }
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [],
  );

  const dispatchTask = useCallback(async (payload: DispatchTaskPayload) => {
    const baseUrl = getDaemonApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/fleet/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Dispatch failed with status ${res.status}`);
    }
    const json = await res.json();
    if (json.job) {
      setJobs((prev) => [json.job, ...prev]);
    }
    return json;
  }, []);

  const [isTelemetryHalted, setIsTelemetryHalted] = useState(false);

  const toggleHaltTelemetry = useCallback(() => {
    setIsTelemetryHalted((prev) => !prev);
  }, []);

  const toggleAutonomous = useCallback(() => {
    setSummary((prev) => ({
      ...prev,
      autonomousEnabled: !prev.autonomousEnabled,
    }));
  }, []);

  const setRetentionPeriod = useCallback(
    (range: AnalyticsTimeRange) => {
      setRetentionPeriodState(range);
      void fetchAllFleetData(true, range);
    },
    [fetchAllFleetData],
  );

  useEffect(() => {
    mountedRef.current = true;
    fetchAllFleetData(false, retentionPeriod);

    // Auto-refresh with sovereign stealth deperiodic jitter: uniform distribution in [2800ms, 5200ms] (GEMINI.md Sec 2)
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    const scheduleNextPoll = () => {
      if (isCancelled) return;
      const jitterMs = Math.floor(2800 + Math.random() * (5200 - 2800 + 1));
      timerId = setTimeout(() => {
        if (!isCancelled && !isTelemetryHalted) {
          fetchAllFleetData(true, retentionPeriod);
        }
        scheduleNextPoll();
      }, jitterMs);
    };

    scheduleNextPoll();

    return () => {
      isCancelled = true;
      mountedRef.current = false;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [fetchAllFleetData, isTelemetryHalted, retentionPeriod]);

  return {
    nodes,
    summary,
    jobs,
    council,
    telemetry,
    authStatus,
    isLoading,
    isRefreshing,
    isTelemetryHalted,
    lastUpdated,
    error,
    retentionPeriod,
    setRetentionPeriod,
    refreshQuotas,
    runAutoConfig,
    saveManualAuth,
    dispatchTask,
    toggleAutonomous,
    toggleHaltTelemetry,
  };
}
