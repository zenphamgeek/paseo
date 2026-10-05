import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DispatchTaskPayload,
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

export function useFleetData() {
  const [nodes, setNodes] = useState<FleetNodeSummary[]>([]);
  const [summary, setSummary] = useState<FleetClusterSummary>(DEFAULT_SUMMARY);
  const [jobs, setJobs] = useState<FleetJobRecord[]>([]);
  const [council, setCouncil] = useState<FleetCouncilData | null>(null);
  const [telemetry, setTelemetry] = useState<SwarmTelemetrySnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchAllFleetData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    const baseUrl = getDaemonApiBaseUrl();

    try {
      const settled = await Promise.allSettled([
        fetch(`${baseUrl}/api/fleet/nodes`),
        fetch(`${baseUrl}/api/fleet/summary`),
        fetch(`${baseUrl}/api/fleet/jobs`),
        fetch(`${baseUrl}/api/fleet/council`),
        fetch(`${baseUrl}/api/fleet/telemetry`),
      ]);

      if (!mountedRef.current) return;

      const [nodesData, summaryData, jobsData, councilData, telemetryData] = await Promise.all([
        extractJsonIfOk<{ nodes?: FleetNodeSummary[] }>(settled[0]),
        extractJsonIfOk<{ summary?: FleetClusterSummary }>(settled[1]),
        extractJsonIfOk<{ jobs?: FleetJobRecord[] }>(settled[2]),
        extractJsonIfOk<FleetCouncilData>(settled[3]),
        extractJsonIfOk<SwarmTelemetrySnapshot>(settled[4]),
      ]);

      if (nodesData?.nodes) setNodes(nodesData.nodes);
      if (summaryData?.summary) setSummary(summaryData.summary);
      if (jobsData?.jobs) setJobs(jobsData.jobs);
      if (councilData) setCouncil(councilData);
      if (telemetryData) setTelemetry(telemetryData);

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
  }, []);

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

  const toggleAutonomous = useCallback(() => {
    setSummary((prev) => ({
      ...prev,
      autonomousEnabled: !prev.autonomousEnabled,
    }));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAllFleetData();

    // Auto-refresh every 8 seconds
    const interval = setInterval(() => {
      fetchAllFleetData(true);
    }, 8000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchAllFleetData]);

  return {
    nodes,
    summary,
    jobs,
    council,
    telemetry,
    isLoading,
    isRefreshing,
    lastUpdated,
    error,
    refreshQuotas,
    dispatchTask,
    toggleAutonomous,
  };
}
