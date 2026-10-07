import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ModalAllocationResultUI,
  ModalCliRunResultUI,
  ModalExecutionLogUI,
  ModalGpuProfileUI,
  ModalGpuSwarmSummaryUI,
  ModalGpuWorkerUI,
  ModalIntelliSenseSummaryUI,
  ModalLogMetricsUI,
  ModalRetentionPolicyUI,
  ModalWorkloadRecommendationUI,
  ModalWorkloadUI,
  ModalWorkspaceCreditUI,
  SmartCrossMeshRecommendationUI,
  SmartRebalanceStatusUI,
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

const DEFAULT_MODAL_SUMMARY: ModalGpuSwarmSummaryUI = {
  available: true,
  totalProfiles: 22,
  activeProfile: "asmr",
  totalWorkers: 13,
  totalRunningContainers: 0,
  hardwareSpectrum: {
    "A100-80GB": 1,
    H100: 2,
    A10G: 2,
    T4: 8,
    L4: 0,
  },
  clusterHealth: "healthy",
  latencyMs: 1.5,
  endpoint: "http://127.0.0.1:7777/api/fleet/modal",
  cliVersion: "1.4.3",
};

export function useModalGpuData() {
  const [summary, setSummary] = useState<ModalGpuSwarmSummaryUI>(DEFAULT_MODAL_SUMMARY);
  const [profiles, setProfiles] = useState<ModalGpuProfileUI[]>([]);
  const [workers, setWorkers] = useState<ModalGpuWorkerUI[]>([]);
  const [workloads, setWorkloads] = useState<ModalWorkloadUI[]>([]);
  const [creditsSummary, setCreditsSummary] = useState<ModalIntelliSenseSummaryUI | null>(null);
  const [workspacesCredits, setWorkspacesCredits] = useState<ModalWorkspaceCreditUI[]>([]);
  const [recommendations, setRecommendations] = useState<ModalWorkloadRecommendationUI[]>([]);
  const [modalLogs, setModalLogs] = useState<ModalExecutionLogUI[]>([]);
  const [modalRetention, setModalRetention] = useState<ModalRetentionPolicyUI | null>(null);
  const [modalMetrics, setModalMetrics] = useState<ModalLogMetricsUI | null>(null);
  const [modalLogsTotal, setModalLogsTotal] = useState(0);
  const [modalLogsPage, setModalLogsPage] = useState(1);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [rebalanceStatus, setRebalanceStatus] = useState<SmartRebalanceStatusUI | null>(null);
  const [crossMeshRecommendations, setCrossMeshRecommendations] = useState<
    SmartCrossMeshRecommendationUI[]
  >([]);
  const [isRebalancing, setIsRebalancing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExecutingCli, setIsExecutingCli] = useState(false);
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const [cliHistory, setCliHistory] = useState<ModalCliRunResultUI[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchModalData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);

    const baseUrl = getDaemonApiBaseUrl();

    try {
      const settled = await Promise.allSettled([
        fetch(`${baseUrl}/api/fleet/modal/summary`),
        fetch(`${baseUrl}/api/fleet/modal/profiles`),
        fetch(`${baseUrl}/api/fleet/modal/workers`),
        fetch(`${baseUrl}/api/fleet/modal/workloads`),
        fetch(`${baseUrl}/api/fleet/modal/credits`),
        fetch(`${baseUrl}/api/fleet/modal/recommendations`),
        fetch(`${baseUrl}/api/fleet/modal/logs?limit=50&page=1`),
        fetch(`${baseUrl}/api/fleet/modal/logs/metrics`),
        fetch(`${baseUrl}/api/fleet/modal/rebalance/recommendations`),
      ]);

      if (!mountedRef.current) return;

      const [
        summaryRes,
        profilesRes,
        workersRes,
        workloadsRes,
        creditsRes,
        recsRes,
        logsRes,
        metricsRes,
        rebalanceRes,
      ] = settled;

      if (summaryRes.status === "fulfilled" && summaryRes.value.ok) {
        const data = (await summaryRes.value.json()) as { summary: ModalGpuSwarmSummaryUI };
        if (data?.summary) setSummary(data.summary);
      }

      if (profilesRes.status === "fulfilled" && profilesRes.value.ok) {
        const data = (await profilesRes.value.json()) as { profiles: ModalGpuProfileUI[] };
        if (Array.isArray(data?.profiles)) setProfiles(data.profiles);
      }

      if (workersRes.status === "fulfilled" && workersRes.value.ok) {
        const data = (await workersRes.value.json()) as { workers: ModalGpuWorkerUI[] };
        if (Array.isArray(data?.workers)) setWorkers(data.workers);
      }

      if (workloadsRes.status === "fulfilled" && workloadsRes.value.ok) {
        const data = (await workloadsRes.value.json()) as { workloads: ModalWorkloadUI[] };
        if (Array.isArray(data?.workloads)) setWorkloads(data.workloads);
      }

      if (creditsRes.status === "fulfilled" && creditsRes.value.ok) {
        const data = (await creditsRes.value.json()) as {
          summary: ModalIntelliSenseSummaryUI;
          workspaces: ModalWorkspaceCreditUI[];
        };
        if (data?.summary) setCreditsSummary(data.summary);
        if (Array.isArray(data?.workspaces)) setWorkspacesCredits(data.workspaces);
      }

      if (recsRes.status === "fulfilled" && recsRes.value.ok) {
        const data = (await recsRes.value.json()) as {
          recommendations: ModalWorkloadRecommendationUI[];
        };
        if (Array.isArray(data?.recommendations)) setRecommendations(data.recommendations);
      }

      if (logsRes.status === "fulfilled" && logsRes.value.ok) {
        const data = (await logsRes.value.json()) as any;
        if (Array.isArray(data?.logs)) setModalLogs(data.logs);
        if (data?.retention) setModalRetention(data.retention);
        if (data?.total_count !== undefined) setModalLogsTotal(data.total_count);
      }

      if (metricsRes.status === "fulfilled" && metricsRes.value.ok) {
        const data = (await metricsRes.value.json()) as ModalLogMetricsUI;
        if (data?.status === "success") setModalMetrics(data);
      }

      if (rebalanceRes.status === "fulfilled" && rebalanceRes.value.ok) {
        const data = (await rebalanceRes.value.json()) as SmartRebalanceStatusUI;
        if (data?.status === "active") {
          setRebalanceStatus(data);
          if (Array.isArray(data?.recommendations))
            setCrossMeshRecommendations(data.recommendations);
        }
      }

      setError(null);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  const fetchModalLogs = useCallback(
    async (params?: {
      page?: number;
      limit?: number;
      workspace?: string;
      status?: string;
      app_id?: string;
    }) => {
      setIsLogsLoading(true);
      const baseUrl = getDaemonApiBaseUrl();
      const q = new URLSearchParams();
      if (params?.page) q.set("page", String(params.page));
      if (params?.limit) q.set("limit", String(params.limit));
      if (params?.workspace) q.set("workspace", params.workspace);
      if (params?.status && params.status !== "ALL") q.set("status", params.status);
      if (params?.app_id) q.set("app_id", params.app_id);

      try {
        const res = await fetch(`${baseUrl}/api/fleet/modal/logs?${q.toString()}`);
        if (res.ok) {
          const data = (await res.json()) as any;
          if (Array.isArray(data?.logs)) setModalLogs(data.logs);
          if (data?.retention) setModalRetention(data.retention);
          if (data?.total_count !== undefined) setModalLogsTotal(data.total_count);
          if (params?.page) setModalLogsPage(params.page);
        }
      } catch {
        // Fallback
      } finally {
        setIsLogsLoading(false);
      }
    },
    [],
  );

  const pruneModalLogs = useCallback(
    async (retentionDays = 14): Promise<{ success: boolean; deletedRows: number }> => {
      const baseUrl = getDaemonApiBaseUrl();
      try {
        const res = await fetch(`${baseUrl}/api/fleet/modal/logs/retention`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retention_days: retentionDays }),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          await fetchModalLogs({ page: 1 });
          return { success: true, deletedRows: Number(data?.deleted_rows || 0) };
        }
        return { success: false, deletedRows: 0 };
      } catch {
        return { success: false, deletedRows: 0 };
      }
    },
    [fetchModalLogs],
  );

  const fetchCrossMeshRebalance = useCallback(async (forceRefresh = false) => {
    setIsRebalancing(true);
    const baseUrl = getDaemonApiBaseUrl();
    try {
      const res = await fetch(
        `${baseUrl}/api/fleet/modal/rebalance/recommendations${forceRefresh ? "?force_refresh=true" : ""}`,
      );
      if (res.ok) {
        const data = (await res.json()) as SmartRebalanceStatusUI;
        setRebalanceStatus(data);
        if (Array.isArray(data?.recommendations)) setCrossMeshRecommendations(data.recommendations);
      }
    } catch {
      // Fallback
    } finally {
      setIsRebalancing(false);
    }
  }, []);

  const applyCrossMeshRebalance = useCallback(
    async (
      recommendationId: string,
      actionPayload?: Record<string, unknown>,
    ): Promise<{ success: boolean; message: string }> => {
      setIsRebalancing(true);
      const baseUrl = getDaemonApiBaseUrl();
      try {
        const res = await fetch(`${baseUrl}/api/fleet/modal/rebalance/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recommendation_id: recommendationId,
            action_payload: actionPayload,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          await fetchCrossMeshRebalance(true);
          return { success: true, message: data?.message || "Rebalance executed successfully." };
        }
        return { success: false, message: "Failed to apply rebalance" };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, message: msg };
      } finally {
        setIsRebalancing(false);
      }
    },
    [fetchCrossMeshRebalance],
  );

  const switchProfile = useCallback(
    async (profileName: string): Promise<boolean> => {
      setIsSwitchingProfile(true);
      const baseUrl = getDaemonApiBaseUrl();
      try {
        const res = await fetch(`${baseUrl}/api/fleet/modal/profile/switch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: profileName }),
        });
        if (res.ok) {
          await fetchModalData(true);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        setIsSwitchingProfile(false);
      }
    },
    [fetchModalData],
  );

  const executeCli = useCallback(
    async (command: string, args: string[] = []): Promise<ModalCliRunResultUI> => {
      setIsExecutingCli(true);
      const baseUrl = getDaemonApiBaseUrl();
      try {
        const res = await fetch(`${baseUrl}/api/fleet/modal/cli/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, args }),
        });
        const result = (await res.json()) as ModalCliRunResultUI;
        setCliHistory((prev) => [result, ...prev.slice(0, 19)]);
        return result;
      } catch (err: any) {
        const errorResult: ModalCliRunResultUI = {
          command: `modal ${command} ${args.join(" ")}`,
          exitCode: 1,
          stdout: "",
          stderr: err?.message || String(err),
          durationMs: 0,
          timestamp: Date.now(),
        };
        setCliHistory((prev) => [errorResult, ...prev.slice(0, 19)]);
        return errorResult;
      } finally {
        setIsExecutingCli(false);
      }
    },
    [],
  );

  const allocateWorkload = useCallback(
    async (appId: string): Promise<ModalAllocationResultUI | null> => {
      setIsAllocating(true);
      const baseUrl = getDaemonApiBaseUrl();
      try {
        const res = await fetch(`${baseUrl}/api/fleet/modal/allocate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appId }),
        });
        if (res.ok) {
          const result = (await res.json()) as ModalAllocationResultUI;
          await fetchModalData(true);
          return result;
        }
        return null;
      } catch {
        return null;
      } finally {
        setIsAllocating(false);
      }
    },
    [fetchModalData],
  );

  useEffect(() => {
    mountedRef.current = true;
    void fetchModalData(false);

    const interval = setInterval(() => {
      void fetchModalData(true);
    }, 12_000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchModalData]);

  return {
    summary,
    profiles,
    workers,
    workloads,
    creditsSummary,
    workspacesCredits,
    recommendations,
    modalLogs,
    modalRetention,
    modalMetrics,
    modalLogsTotal,
    modalLogsPage,
    isLogsLoading,
    rebalanceStatus,
    crossMeshRecommendations,
    isRebalancing,
    isLoading,
    isRefreshing,
    isExecutingCli,
    isSwitchingProfile,
    isAllocating,
    cliHistory,
    error,
    refreshData: fetchModalData,
    fetchModalLogs,
    pruneModalLogs,
    fetchCrossMeshRebalance,
    applyCrossMeshRebalance,
    switchProfile,
    executeCli,
    allocateWorkload,
  };
}
