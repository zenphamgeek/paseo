import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  BarChart2,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  Database,
  DollarSign,
  Flame,
  Gauge,
  Layers,
  ListFilter,
  PieChart,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react-native";
import type {
  AnalyticsSummary,
  AnalyticsTimeRange,
  FleetRequestRecordUI,
  ModelAnalyticsMetric,
  ModelAnalyticsTotals,
  NodeModelDistribution,
  NodeUtilizationMetric,
  RetentionLogRecord,
  TimelineBucket,
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

function getModelColor(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "#fbbf24"; // Amber Gold
  if (m.includes("sonnet")) return "#c084fc"; // Purple
  if (m.includes("flash")) return "#38bdf8"; // Sky Blue
  if (m.includes("pro")) return "#60a5fa"; // Indigo Blue
  if (m.includes("fledge")) return "#34d399"; // Emerald Green
  if (m.includes("ling")) return "#2dd4bf"; // Teal
  if (m.includes("nemotron")) return "#a3e635"; // Lime
  return "#94a3b8"; // Slate
}

function getModelDisplayName(model: string): string {
  if (model === "claude-opus-4.8") return "Claude Opus 4.8";
  if (model === "claude-sonnet-5") return "Claude Sonnet 5";
  if (model === "claude-sonnet-5-5-high") return "Claude Sonnet 5.5";
  if (model === "gemini-3.8-flash-thinking") return "Gemini 3.8 Flash";
  if (model === "gemini-3.1-pro-high") return "Gemini 3.1 Pro";
  if (model === "opencode/fledge-alpha-free") return "OpenCode Fledge";
  if (model === "opencode/ling-3.1-flash-free") return "OpenCode Ling";
  if (model === "opencode/nemotron-3.5-lightning-free") return "OpenCode Nemotron";
  return model.replace("opencode/", "");
}

function formatTokens(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(2)}M`;
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}K`;
  return String(t);
}

interface FleetAnalyticsViewProps {
  onNavigateToRunner?: () => void;
}

export function FleetAnalyticsView({ onNavigateToRunner }: FleetAnalyticsViewProps) {
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>("24h");
  const [activeTab, setActiveTab] = useState<"models" | "node_load" | "timeline">("models");

  // Data states
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [nodeMetrics, setNodeMetrics] = useState<NodeUtilizationMetric[]>([]);
  const [models, setModels] = useState<ModelAnalyticsMetric[]>([]);
  const [modelTotals, setModelTotals] = useState<ModelAnalyticsTotals | null>(null);
  const [nodeDistributions, setNodeDistributions] = useState<NodeModelDistribution[]>([]);
  const [requests, setRequests] = useState<FleetRequestRecordUI[]>([]);
  const [retentionLogs, setRetentionLogs] = useState<RetentionLogRecord[]>([]);

  // Interactive UI states
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [clusterFilter, setClusterFilter] = useState<"all" | "opencode" | "agy">("all");
  const [nodeFilter, setNodeFilter] = useState<"all" | "agy" | "opencode">("all");
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPruning, setIsPruning] = useState(false);
  const [pruneResultMsg, setPruneResultMsg] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);
    const baseUrl = getDaemonApiBaseUrl();
    try {
      const [sumRes, timeRes, nodeRes, reqRes, retRes, modelRes, distRes] = await Promise.all([
        fetch(`${baseUrl}/api/fleet/analytics/summary?range=${timeRange}`),
        fetch(`${baseUrl}/api/fleet/analytics/timeline?range=${timeRange}`),
        fetch(`${baseUrl}/api/fleet/analytics/nodes?range=${timeRange}`),
        fetch(`${baseUrl}/api/fleet/analytics/requests?limit=40`),
        fetch(`${baseUrl}/api/fleet/analytics/retention`),
        fetch(`${baseUrl}/api/fleet/analytics/models?range=${timeRange}`),
        fetch(`${baseUrl}/api/fleet/analytics/node-models?range=${timeRange}`),
      ]);

      if (sumRes.ok) {
        const data = await sumRes.json();
        if (data.summary) setSummary(data.summary);
      }
      if (timeRes.ok) {
        const data = await timeRes.json();
        if (Array.isArray(data.timeline)) setTimeline(data.timeline);
      }
      if (nodeRes.ok) {
        const data = await nodeRes.json();
        if (Array.isArray(data.nodes)) setNodeMetrics(data.nodes);
      }
      if (reqRes.ok) {
        const data = await reqRes.json();
        if (Array.isArray(data.requests)) setRequests(data.requests);
      }
      if (retRes.ok) {
        const data = await retRes.json();
        if (Array.isArray(data.history)) setRetentionLogs(data.history);
      }
      if (modelRes.ok) {
        const data = await modelRes.json();
        if (Array.isArray(data.models)) {
          setModels(data.models);
          if (data.models.length > 0 && !selectedModelName) {
            setSelectedModelName(data.models[0].model);
          }
        }
        if (data.totals) setModelTotals(data.totals);
      }
      if (distRes.ok) {
        const data = await distRes.json();
        if (Array.isArray(data.distributions)) {
          setNodeDistributions(data.distributions);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch fleet analytics:", err);
    } finally {
      setIsLoading(false);
    }
  }, [timeRange, selectedModelName]);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 15000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  const handlePruneLogs = useCallback(async () => {
    if (isPruning) return;
    setIsPruning(true);
    setPruneResultMsg(null);
    const baseUrl = getDaemonApiBaseUrl();
    try {
      const res = await fetch(`${baseUrl}/api/fleet/analytics/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: 30 }),
      });
      if (res.ok) {
        const json = await res.json();
        const r = json.result;
        setPruneResultMsg(
          `Prune finished: ${r.recordsDeleted} records and ${r.filesDeleted} log files removed (>30 days).`,
        );
        fetchAnalytics();
      } else {
        setPruneResultMsg("Prune failed with status " + res.status);
      }
    } catch (err) {
      setPruneResultMsg("Prune failed: " + String(err));
    } finally {
      setIsPruning(false);
    }
  }, [isPruning, fetchAnalytics]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedRequestId((prev) => (prev === id ? null : id));
  }, []);

  const filteredRequests = useMemo(() => {
    if (clusterFilter === "all") return requests;
    return requests.filter((r) => r.cluster === clusterFilter);
  }, [requests, clusterFilter]);

  const filteredNodeDistributions = useMemo(() => {
    if (nodeFilter === "all") return nodeDistributions;
    return nodeDistributions.filter((n) => n.cluster === nodeFilter);
  }, [nodeDistributions, nodeFilter]);

  const maxTimelineRequests = useMemo(() => {
    if (timeline.length === 0) return 1;
    return Math.max(1, ...timeline.map((b) => b.requests));
  }, [timeline]);

  const selectedModelInfo = useMemo(() => {
    if (!selectedModelName) return models[0] || null;
    return models.find((m) => m.model === selectedModelName) || models[0] || null;
  }, [models, selectedModelName]);

  // 4D Scatter Matrix Bounds
  const scatterBounds = useMemo(() => {
    if (models.length === 0) {
      return { minDur: 500, maxDur: 5000, maxTok: 50000, maxReq: 10 };
    }
    const durations = models.map((m) => m.avgDurationMs);
    const tokens = models.map((m) => m.totalTokens);
    const reqs = models.map((m) => m.requestsCount);

    return {
      minDur: Math.max(200, Math.min(...durations) * 0.8),
      maxDur: Math.max(4500, Math.max(...durations) * 1.15),
      maxTok: Math.max(10000, Math.max(...tokens) * 1.15),
      maxReq: Math.max(1, Math.max(...reqs)),
    };
  }, [models]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* ── Top Bar Controls ── */}
      <View style={styles.topBar}>
        <View style={styles.titleGroup}>
          <BarChart2 size={22} color={styles.iconAccent.color} />
          <View>
            <Text style={styles.mainTitle}>Fleet Analytics & Tokenomics</Text>
            <Text style={styles.subTitle}>
              Multi-dimensional Model Intelligence, 100% Node Load Composition & 30-Day Retention DB
            </Text>
          </View>
        </View>

        <View style={styles.actionsGroup}>
          {/* Time Range Selector */}
          <View style={styles.timeRangeSelector}>
            {(["1h", "24h", "7d", "30d"] as AnalyticsTimeRange[]).map((r) => (
              <Pressable
                key={r}
                onPress={() => setTimeRange(r)}
                style={[styles.rangePill, timeRange === r && styles.rangePillActive]}
              >
                <Text style={[styles.rangeText, timeRange === r && styles.rangeTextActive]}>
                  {r.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Refresh Button */}
          <Pressable onPress={fetchAnalytics} style={styles.refreshBtn}>
            <RefreshCw size={13} color={styles.iconMuted.color} />
            <Text style={styles.refreshBtnText}>Sync</Text>
          </Pressable>

          {/* Auto-Prune Button */}
          <Pressable
            onPress={handlePruneLogs}
            disabled={isPruning}
            style={[styles.pruneBtn, isPruning && { opacity: 0.5 }]}
          >
            <Trash2 size={13} color={styles.iconWarning.color} />
            <Text style={styles.pruneBtnText}>{isPruning ? "Pruning..." : "Prune (>30d)"}</Text>
          </Pressable>
        </View>
      </View>

      {/* Prune Alert Result */}
      {pruneResultMsg && (
        <View style={styles.alertBanner}>
          <CheckCircle2 size={14} color={styles.iconAccent.color} />
          <Text style={styles.alertText}>{pruneResultMsg}</Text>
        </View>
      )}

      {/* ── Global Macro Totals Cards ── */}
      <View style={styles.kpiGrid}>
        {/* Total Requests & Fleet Success */}
        <View style={styles.kpiCard}>
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiLabel}>Total Swarm Requests</Text>
            <Layers size={16} color={styles.iconAccent.color} />
          </View>
          <Text style={styles.kpiValue}>
            {modelTotals?.totalRequests ?? summary?.totalRequests ?? 0}
          </Text>
          <View style={styles.kpiSubRow}>
            <CheckCircle2 size={12} color={styles.iconSuccess.color} />
            <Text style={styles.kpiSubSuccess}>
              {summary ? `${summary.successRate}% Success` : "100% Success"}
            </Text>
            <Text style={styles.kpiSub}>
              • {modelTotals ? `${(modelTotals.avgDurationMs / 1000).toFixed(1)}s avg` : "-"}
            </Text>
          </View>
        </View>

        {/* Commercial Cost Saved (USD) */}
        <View style={styles.kpiCard}>
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiLabel}>Commercial Value Saved</Text>
            <DollarSign size={16} color={styles.iconSuccess.color} />
          </View>
          <Text style={[styles.kpiValue, styles.textEmerald]}>
            +${(modelTotals?.totalSavedUsd ?? summary?.totalSavedUsd ?? 0).toFixed(3)}
          </Text>
          <View style={styles.kpiSubRow}>
            <Sparkles size={12} color={styles.iconSuccess.color} />
            <Text style={styles.kpiSubSuccess}>OpenCode Free Harness</Text>
          </View>
        </View>

        {/* Token Volume & Velocity */}
        <View style={styles.kpiCard}>
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiLabel}>Total Token Volume</Text>
            <Zap size={16} color={styles.iconPurple.color} />
          </View>
          <Text style={[styles.kpiValue, styles.textPurple]}>
            {formatTokens(modelTotals?.totalTokens ?? summary?.totalTokens ?? 0)}
          </Text>
          <View style={styles.kpiSubRow}>
            <Text style={styles.kpiSub}>
              Velocity: {summary?.tokenVelocityTps ? `${summary.tokenVelocityTps} TPS` : "0.8 TPS"}
            </Text>
            <Text style={styles.kpiSub}>• {summary?.tokenVelocityTpm ?? 48} TPM</Text>
          </View>
        </View>

        {/* Commercial Billed vs Blended Cost */}
        <View style={styles.kpiCard}>
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiLabel}>Total Billed vs Blended</Text>
            <ShieldCheck size={16} color={styles.iconBlue.color} />
          </View>
          <Text style={styles.kpiValue}>
            ${(modelTotals?.totalBilledUsd ?? summary?.totalBilledUsd ?? 0).toFixed(3)}
          </Text>
          <Text style={styles.kpiSub}>
            Effective: $
            {modelTotals?.totalTokens
              ? (modelTotals.totalBilledUsd / (modelTotals.totalTokens / 1_000_000)).toFixed(2)
              : "0.00"}
            /M tokens
          </Text>
        </View>

        {/* Active Models & Dominant */}
        <View style={styles.kpiCard}>
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiLabel}>Active Models Mesh</Text>
            <Cpu size={16} color={styles.iconWarning.color} />
          </View>
          <Text style={styles.kpiValue}>
            {modelTotals?.activeModelsCount ?? models.length} Models
          </Text>
          <Text style={styles.kpiSub} numberOfLines={1}>
            Top:{" "}
            {modelTotals?.mostActiveModel
              ? getModelDisplayName(modelTotals.mostActiveModel)
              : "Flash"}
          </Text>
        </View>
      </View>

      {/* ── View Switcher Navigation Tabs ── */}
      <View style={styles.tabNavRow}>
        <Pressable
          onPress={() => setActiveTab("models")}
          style={[styles.tabButton, activeTab === "models" && styles.tabButtonActive]}
        >
          <Compass size={15} color={activeTab === "models" ? "#38bdf8" : styles.iconMuted.color} />
          <Text style={[styles.tabText, activeTab === "models" && styles.tabTextActive]}>
            Model Tokenomics & 4D Matrix
          </Text>
          <View style={[styles.tabBadge, activeTab === "models" && styles.tabBadgeActive]}>
            <Text style={styles.tabBadgeText}>{models.length}</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab("node_load")}
          style={[styles.tabButton, activeTab === "node_load" && styles.tabButtonActive]}
        >
          <Share2
            size={15}
            color={activeTab === "node_load" ? "#34d399" : styles.iconMuted.color}
          />
          <Text style={[styles.tabText, activeTab === "node_load" && styles.tabTextActive]}>
            Node x Model Load % Matrix
          </Text>
          <View style={[styles.tabBadge, activeTab === "node_load" && styles.tabBadgeActive]}>
            <Text style={styles.tabBadgeText}>{nodeDistributions.length}</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => setActiveTab("timeline")}
          style={[styles.tabButton, activeTab === "timeline" && styles.tabButtonActive]}
        >
          <TrendingUp
            size={15}
            color={activeTab === "timeline" ? "#c084fc" : styles.iconMuted.color}
          />
          <Text style={[styles.tabText, activeTab === "timeline" && styles.tabTextActive]}>
            Swarm Timeline & Node Status
          </Text>
        </Pressable>
      </View>

      {/* ══════════════════════════════════════════════════════════════════
          TAB 1: MODEL TOKENOMICS & 4D PARETO FRONTIER MATRIX
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "models" && (
        <>
          {/* 4D Multi-Dimensional Scatter / Bubble Matrix */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <Compass size={17} color={styles.iconAccent.color} />
                <View>
                  <Text style={styles.sectionTitle}>
                    4D Model Efficiency Frontier & Pareto Matrix
                  </Text>
                  <Text style={styles.sectionSubtitle}>
                    Dim 1: Latency (X) • Dim 2: Token Volume (Y) • Dim 3: Request Count (Size) • Dim
                    4: Tier (Color)
                  </Text>
                </View>
              </View>

              <View style={styles.matrixLegendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: "#fbbf24" }]} />
                  <Text style={styles.legendText}>Ultra (Opus)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: "#38bdf8" }]} />
                  <Text style={styles.legendText}>AGY Pro (Gemini)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: "#34d399" }]} />
                  <Text style={styles.legendText}>OpenCode Free</Text>
                </View>
              </View>
            </View>

            {models.length === 0 ? (
              <View style={styles.emptyChartBox}>
                <Text style={styles.emptyChartText}>
                  No model telemetry collected in this period
                </Text>
              </View>
            ) : (
              <View style={styles.scatterContainer}>
                {/* Quadrant Background Markers */}
                <View style={styles.quadrantGrid}>
                  <View style={[styles.quadrantBox, { borderRightWidth: 1, borderBottomWidth: 1 }]}>
                    <Text style={styles.quadrantLabel}>HIGH THROUGHPUT WORKHORSE</Text>
                  </View>
                  <View style={[styles.quadrantBox, { borderBottomWidth: 1 }]}>
                    <Text style={styles.quadrantLabel}>DEEP REASONING & TOKENOMICS</Text>
                  </View>
                  <View style={[styles.quadrantBox, { borderRightWidth: 1 }]}>
                    <Text style={styles.quadrantLabel}>LIGHTWEIGHT UTILITIES</Text>
                  </View>
                  <View style={styles.quadrantBox}>
                    <Text style={styles.quadrantLabel}>BALANCED THINKING</Text>
                  </View>
                </View>

                {/* Render 4D Interactive Bubbles */}
                {models.map((m) => {
                  const xNorm = Math.max(
                    0.05,
                    Math.min(
                      0.92,
                      (m.avgDurationMs - scatterBounds.minDur) /
                        (scatterBounds.maxDur - scatterBounds.minDur || 1),
                    ),
                  );
                  const yNorm = Math.max(
                    0.08,
                    Math.min(0.88, m.totalTokens / (scatterBounds.maxTok || 1)),
                  );
                  const radius = Math.round(18 + (m.requestsCount / scatterBounds.maxReq) * 22);
                  const color = getModelColor(m.model);
                  const isSelected = selectedModelName === m.model;

                  return (
                    <Pressable
                      key={m.model}
                      onPress={() => setSelectedModelName(m.model)}
                      style={[
                        styles.scatterBubble,
                        {
                          left: `${xNorm * 100}%`,
                          bottom: `${yNorm * 100}%`,
                          width: radius * 2,
                          height: radius * 2,
                          marginLeft: -radius,
                          marginBottom: -radius,
                          backgroundColor: `${color}25`,
                          borderColor: color,
                          borderWidth: isSelected ? 2.5 : 1.5,
                          shadowColor: color,
                          shadowOpacity: isSelected ? 0.8 : 0.3,
                          shadowRadius: isSelected ? 12 : 5,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.bubbleLabel,
                          {
                            color: isSelected ? "#ffffff" : color,
                            fontWeight: isSelected ? "800" : "600",
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {getModelDisplayName(m.model).split(" ")[0]}
                      </Text>
                      <Text style={styles.bubbleSubLabel}>{m.requestsCount} req</Text>
                    </Pressable>
                  );
                })}

                {/* Axis Labels */}
                <View style={styles.axisXLabelRow}>
                  <Text style={styles.axisLabel}>← Rapid Execution (&lt;1.5s)</Text>
                  <Text style={styles.axisTitle}>Average Model Latency (Duration ms)</Text>
                  <Text style={styles.axisLabel}>Deep Thinking (&gt;4.0s) →</Text>
                </View>
                <View style={styles.axisYLabelCol}>
                  <Text style={styles.axisTitleVertical}>Token Throughput Volume (Tokens) ↑</Text>
                </View>
              </View>
            )}

            {/* Deep Model Inspector HUD Card (5th Dimension) */}
            {selectedModelInfo && (
              <View style={styles.inspectorHudCard}>
                <View style={styles.hudHeader}>
                  <View style={styles.hudHeaderLeft}>
                    <View
                      style={[
                        styles.hudColorBadge,
                        { backgroundColor: getModelColor(selectedModelInfo.model) },
                      ]}
                    />
                    <View>
                      <Text style={styles.hudModelTitle}>
                        {getModelDisplayName(selectedModelInfo.model)}
                      </Text>
                      <Text style={styles.hudModelMeta}>
                        Raw: {selectedModelInfo.model} • Tier:{" "}
                        {selectedModelInfo.tier.toUpperCase()} • Cluster:{" "}
                        {selectedModelInfo.cluster.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.hudShareBadge}>
                    <Text style={styles.hudShareText}>
                      {selectedModelInfo.sharePercent}% Swarm Share
                    </Text>
                  </View>
                </View>

                <View style={styles.hudMetricsGrid}>
                  <View style={styles.hudMetricItem}>
                    <Text style={styles.hudMetricLabel}>Total Requests</Text>
                    <Text style={styles.hudMetricValue}>{selectedModelInfo.requestsCount}</Text>
                    <Text style={styles.hudMetricSub}>
                      {selectedModelInfo.sharePercent}% of swarm
                    </Text>
                  </View>

                  <View style={styles.hudMetricItem}>
                    <Text style={styles.hudMetricLabel}>Tokens Consumed</Text>
                    <Text style={[styles.hudMetricValue, styles.textPurple]}>
                      {formatTokens(selectedModelInfo.totalTokens)}
                    </Text>
                    <Text style={styles.hudMetricSub}>
                      {selectedModelInfo.tokenSharePercent}% token volume
                    </Text>
                  </View>

                  <View style={styles.hudMetricItem}>
                    <Text style={styles.hudMetricLabel}>Avg Latency</Text>
                    <Text style={styles.hudMetricValue}>
                      {(selectedModelInfo.avgDurationMs / 1000).toFixed(2)}s
                    </Text>
                    <Text style={styles.hudMetricSub}>
                      {selectedModelInfo.avgDurationMs < 1800
                        ? "Blazing Fast"
                        : selectedModelInfo.avgDurationMs < 3000
                          ? "Optimal"
                          : "Deep Reasoning"}
                    </Text>
                  </View>

                  <View style={styles.hudMetricItem}>
                    <Text style={styles.hudMetricLabel}>Commercial Saved</Text>
                    <Text style={[styles.hudMetricValue, styles.textEmerald]}>
                      +${selectedModelInfo.costSavedUsd.toFixed(4)}
                    </Text>
                    <Text style={styles.hudMetricSub}>
                      Billed: ${selectedModelInfo.costBilledUsd.toFixed(4)}
                    </Text>
                  </View>
                </View>

                {/* Nodes Assigned Row */}
                <View style={styles.hudNodesRow}>
                  <Text style={styles.hudNodesLabel}>
                    Active Nodes Serving this Model ({selectedModelInfo.nodeCount}):
                  </Text>
                  <View style={styles.hudNodesChipsWrap}>
                    {selectedModelInfo.nodes.map((nodeId) => (
                      <View key={nodeId} style={styles.hudNodeChip}>
                        <Cpu size={10} color="#38bdf8" />
                        <Text style={styles.hudNodeChipText}>{nodeId}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* Model Intelligence Breakdown Table */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <Layers size={16} color={styles.iconSuccess.color} />
                <Text style={styles.sectionTitle}>
                  Model Tokenomics Intelligence Matrix ({models.length} Models)
                </Text>
              </View>
              <Text style={styles.sectionHeaderMeta}>Real-time SQLite Aggregation</Text>
            </View>

            <View style={styles.modelTable}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.thCell, { flex: 2 }]}>Model Name</Text>
                <Text style={[styles.thCell, { flex: 1.2 }]}>Tier / Cluster</Text>
                <Text style={[styles.thCell, { flex: 1.5 }]}>Request Share</Text>
                <Text style={[styles.thCell, { flex: 1.5 }]}>Token Share</Text>
                <Text style={[styles.thCell, { flex: 1 }]}>Latency</Text>
                <Text style={[styles.thCell, { flex: 1 }]}>Billed ($)</Text>
                <Text style={[styles.thCell, { flex: 1.2 }]}>Saved ($ ROI)</Text>
                <Text style={[styles.thCell, { flex: 1 }]}>Nodes</Text>
              </View>

              {models.map((m) => {
                const color = getModelColor(m.model);
                const isSelected = selectedModelName === m.model;

                return (
                  <Pressable
                    key={m.model}
                    onPress={() => setSelectedModelName(m.model)}
                    style={[styles.tableDataRow, isSelected && styles.tableDataRowSelected]}
                  >
                    <View
                      style={[
                        styles.tdCell,
                        { flex: 2, flexDirection: "row", alignItems: "center", gap: 7 },
                      ]}
                    >
                      <View style={[styles.modelDot, { backgroundColor: color }]} />
                      <Text
                        style={[
                          styles.modelRowName,
                          isSelected && { color: "#ffffff", fontWeight: "700" },
                        ]}
                      >
                        {getModelDisplayName(m.model)}
                      </Text>
                    </View>

                    <View style={[styles.tdCell, { flex: 1.2 }]}>
                      <View
                        style={[
                          styles.clusterBadge,
                          m.cluster === "opencode" ? styles.badgeOpenCode : styles.badgeAgy,
                        ]}
                      >
                        <Text style={styles.clusterBadgeText}>{m.tier.toUpperCase()}</Text>
                      </View>
                    </View>

                    {/* Requests + Share Bar */}
                    <View style={[styles.tdCell, { flex: 1.5, gap: 3 }]}>
                      <View style={styles.shareTextRow}>
                        <Text style={styles.shareTextVal}>{m.requestsCount}</Text>
                        <Text style={styles.shareTextSub}>({m.sharePercent}%)</Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressBar,
                            { width: `${Math.min(100, m.sharePercent)}%`, backgroundColor: color },
                          ]}
                        />
                      </View>
                    </View>

                    {/* Tokens + Share Bar */}
                    <View style={[styles.tdCell, { flex: 1.5, gap: 3 }]}>
                      <View style={styles.shareTextRow}>
                        <Text style={[styles.shareTextVal, styles.textPurple]}>
                          {formatTokens(m.totalTokens)}
                        </Text>
                        <Text style={styles.shareTextSub}>({m.tokenSharePercent}%)</Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressBar,
                            {
                              width: `${Math.min(100, m.tokenSharePercent)}%`,
                              backgroundColor: "#c084fc",
                            },
                          ]}
                        />
                      </View>
                    </View>

                    {/* Latency */}
                    <Text style={[styles.tdCell, styles.numText, { flex: 1 }]}>
                      {(m.avgDurationMs / 1000).toFixed(1)}s
                    </Text>

                    {/* Billed */}
                    <Text style={[styles.tdCell, styles.numText, { flex: 1 }]}>
                      ${m.costBilledUsd.toFixed(3)}
                    </Text>

                    {/* Saved */}
                    <Text style={[styles.tdCell, styles.savedText, { flex: 1.2 }]}>
                      +${m.costSavedUsd.toFixed(3)}
                    </Text>

                    {/* Nodes Count */}
                    <View
                      style={[
                        styles.tdCell,
                        { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
                      ]}
                    >
                      <Cpu size={12} color="#94a3b8" />
                      <Text style={styles.numText}>{m.nodeCount}</Text>
                    </View>
                  </Pressable>
                );
              })}

              {/* Summary / Total Footer Row */}
              {modelTotals && (
                <View style={styles.tableFooterRow}>
                  <View
                    style={[
                      styles.tdCell,
                      { flex: 2, flexDirection: "row", alignItems: "center", gap: 6 },
                    ]}
                  >
                    <ShieldCheck size={14} color="#38bdf8" />
                    <Text style={styles.footerTotalLabel}>TOTAL SWARM</Text>
                  </View>
                  <Text style={[styles.tdCell, styles.footerTotalText, { flex: 1.2 }]}>
                    {modelTotals.activeModelsCount} Models
                  </Text>
                  <Text style={[styles.tdCell, styles.footerTotalText, { flex: 1.5 }]}>
                    {modelTotals.totalRequests} reqs (100%)
                  </Text>
                  <Text
                    style={[
                      styles.tdCell,
                      styles.footerTotalText,
                      styles.textPurple,
                      { flex: 1.5 },
                    ]}
                  >
                    {formatTokens(modelTotals.totalTokens)} (100%)
                  </Text>
                  <Text style={[styles.tdCell, styles.footerTotalText, { flex: 1 }]}>
                    {(modelTotals.avgDurationMs / 1000).toFixed(1)}s
                  </Text>
                  <Text style={[styles.tdCell, styles.footerTotalText, { flex: 1 }]}>
                    ${modelTotals.totalBilledUsd.toFixed(3)}
                  </Text>
                  <Text
                    style={[
                      styles.tdCell,
                      styles.footerTotalText,
                      styles.textEmerald,
                      { flex: 1.2 },
                    ]}
                  >
                    +${modelTotals.totalSavedUsd.toFixed(3)}
                  </Text>
                  <Text style={[styles.tdCell, styles.footerTotalText, { flex: 1 }]}>29 Nodes</Text>
                </View>
              )}
            </View>
          </View>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 2: NODE X MODEL LOAD % COMPOSITION MATRIX
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "node_load" && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Share2 size={17} color={styles.iconSuccess.color} />
              <View>
                <Text style={styles.sectionTitle}>
                  Per-Node Model Load Composition (100% Stacked)
                </Text>
                <Text style={styles.sectionSubtitle}>
                  Exact distribution percentage of AI Models executed on each individual node in the
                  fleet
                </Text>
              </View>
            </View>

            {/* Cluster Filter */}
            <View style={styles.clusterFilterRow}>
              {(["all", "agy", "opencode"] as const).map((cf) => (
                <Pressable
                  key={cf}
                  onPress={() => setNodeFilter(cf)}
                  style={[
                    styles.clusterFilterPill,
                    nodeFilter === cf && styles.clusterFilterPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.clusterFilterText,
                      nodeFilter === cf && styles.clusterFilterTextActive,
                    ]}
                  >
                    {cf === "all"
                      ? "All (29 Nodes)"
                      : cf === "agy"
                        ? "AGY Mesh (15)"
                        : "OpenCode Free (14)"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {filteredNodeDistributions.length === 0 ? (
            <View style={styles.emptyChartBox}>
              <Text style={styles.emptyChartText}>
                No node load records match the selected filter
              </Text>
            </View>
          ) : (
            <View style={styles.nodeLoadList}>
              {filteredNodeDistributions.map((node) => {
                const isAgy = node.cluster === "agy";
                const isUltra = node.tier === "ultra";

                return (
                  <View key={node.nodeId} style={styles.nodeLoadCard}>
                    {/* Node Header Row */}
                    <View style={styles.nodeLoadHeader}>
                      <View style={styles.nodeLoadHeaderLeft}>
                        <Cpu size={14} color={isAgy ? "#38bdf8" : "#34d399"} />
                        <Text style={styles.nodeLoadId}>{node.nodeId}</Text>
                        <View
                          style={[
                            styles.clusterBadge,
                            isAgy ? styles.badgeAgy : styles.badgeOpenCode,
                          ]}
                        >
                          <Text style={styles.clusterBadgeText}>
                            {isAgy ? (isUltra ? "AGY ULTRA" : "AGY PRO") : "OPENCODE FREE"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.nodeLoadHeaderRight}>
                        <Text style={styles.nodeLoadMetaText}>
                          Total Load: <Text style={styles.textBold}>{node.totalRequests} req</Text>{" "}
                          • {formatTokens(node.totalTokens)} tokens
                        </Text>
                      </View>
                    </View>

                    {/* 100% Horizontal Stacked Bar */}
                    <View style={styles.stackedBarContainer}>
                      {node.models.map((m, idx) => {
                        const color = getModelColor(m.model);
                        const isFirst = idx === 0;
                        const isLast = idx === node.models.length - 1;

                        return (
                          <View
                            key={m.model}
                            style={[
                              styles.stackedBarSegment,
                              {
                                width: `${Math.max(1, m.sharePercent)}%`,
                                backgroundColor: color,
                                borderTopLeftRadius: isFirst ? 6 : 0,
                                borderBottomLeftRadius: isFirst ? 6 : 0,
                                borderTopRightRadius: isLast ? 6 : 0,
                                borderBottomRightRadius: isLast ? 6 : 0,
                              },
                            ]}
                          >
                            {m.sharePercent >= 12 && (
                              <Text style={styles.stackedBarText} numberOfLines={1}>
                                {m.sharePercent}%
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </View>

                    {/* Model Details Chips Row */}
                    <View style={styles.nodeModelChipsWrap}>
                      {node.models.map((m) => {
                        const color = getModelColor(m.model);
                        return (
                          <View key={m.model} style={styles.nodeModelChip}>
                            <View style={[styles.modelDotSmall, { backgroundColor: color }]} />
                            <Text style={styles.nodeModelChipName}>
                              {getModelDisplayName(m.model)}:
                            </Text>
                            <Text style={styles.nodeModelChipPercent}>{m.sharePercent}%</Text>
                            <Text style={styles.nodeModelChipSub}>
                              ({m.requestsCount} req • {formatTokens(m.tokens)})
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB 3: TIMELINE, NODE UTILIZATION & REQUEST LOGS
         ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "timeline" && (
        <>
          {/* 30-Day Retention DB Status Info Bar */}
          <View style={styles.retentionBanner}>
            <View style={styles.retentionLeft}>
              <Database size={15} color={styles.iconBlue.color} />
              <Text style={styles.retentionText}>
                <Text style={styles.retentionBold}>30-Day Auto Retention Active: </Text>
                Requests DB & output .log files older than 30 days are automatically pruned every 24
                hours.
              </Text>
            </View>
            {retentionLogs.length > 0 && (
              <Text style={styles.retentionMeta}>
                Last cleaned: {new Date(retentionLogs[0].cleanedAt).toLocaleTimeString()} (
                {retentionLogs[0].recordsDeleted} records, {retentionLogs[0].filesDeleted} files)
              </Text>
            )}
          </View>

          {/* Time-Series Timeline Chart (9Router-style Visual Buckets) */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <TrendingUp size={16} color={styles.iconAccent.color} />
                <Text style={styles.sectionTitle}>
                  Request & Token Velocity Timeline ({timeRange.toUpperCase()})
                </Text>
              </View>
              <Text style={styles.sectionHeaderMeta}>
                Interval: {timeRange === "1h" ? "5 min" : timeRange === "24h" ? "1 hour" : "1 day"}
              </Text>
            </View>

            {timeline.length === 0 ? (
              <View style={styles.emptyChartBox}>
                <Text style={styles.emptyChartText}>
                  No request traffic in selected time window
                </Text>
              </View>
            ) : (
              <View style={styles.chartContainer}>
                <View style={styles.chartBarsRow}>
                  {timeline.map((bucket, idx) => {
                    const heightPercent = Math.max(
                      8,
                      Math.round((bucket.requests / maxTimelineRequests) * 100),
                    );
                    const hasErrors = bucket.errors > 0;
                    return (
                      <View key={idx} style={styles.chartCol}>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              { height: `${heightPercent}%` },
                              hasErrors && styles.barFillError,
                            ]}
                          />
                        </View>
                        <Text style={styles.chartLabel} numberOfLines={1}>
                          {bucket.timeLabel}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <View style={styles.chartLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: "#38bdf8" }]} />
                    <Text style={styles.legendText}>Successful Requests</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: "#f87171" }]} />
                    <Text style={styles.legendText}>Errors</Text>
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* Node Utilization Table */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <Cpu size={16} color={styles.iconSuccess.color} />
                <Text style={styles.sectionTitle}>
                  Node Utilization & Quota Efficiency (29 Nodes)
                </Text>
              </View>
              <View style={styles.statusLegend}>
                <View style={styles.legendBadgeOptimal}>
                  <Text style={styles.legendBadgeText}>OPTIMAL</Text>
                </View>
                <View style={styles.legendBadgeHotspot}>
                  <Text style={styles.legendBadgeText}>HOTSPOT</Text>
                </View>
                <View style={styles.legendBadgeUnder}>
                  <Text style={styles.legendBadgeText}>UNDERUTILIZED</Text>
                </View>
                <View style={styles.legendBadgeIdle}>
                  <Text style={styles.legendBadgeText}>IDLE</Text>
                </View>
              </View>
            </View>

            {nodeMetrics.length === 0 ? (
              <View style={styles.emptyChartBox}>
                <Text style={styles.emptyChartText}>No node executions recorded yet</Text>
              </View>
            ) : (
              <View style={styles.nodeTable}>
                <View style={styles.tableHeaderRow}>
                  <Text style={[styles.thCell, { flex: 2 }]}>Node</Text>
                  <Text style={[styles.thCell, { flex: 1.5 }]}>Cluster & Tier</Text>
                  <Text style={[styles.thCell, { flex: 1.2 }]}>Load Share</Text>
                  <Text style={[styles.thCell, { flex: 1 }]}>Requests</Text>
                  <Text style={[styles.thCell, { flex: 1 }]}>Tokens</Text>
                  <Text style={[styles.thCell, { flex: 1 }]}>Saved ($)</Text>
                  <Text style={[styles.thCell, { flex: 1.2 }]}>Status</Text>
                </View>

                {nodeMetrics.map((node) => {
                  const isHotspot = node.status === "hotspot";
                  const isOptimal = node.status === "optimal";
                  const isUnder = node.status === "underutilized";
                  const isIdle = node.status === "idle";

                  return (
                    <View key={node.nodeId} style={styles.tableDataRow}>
                      <View
                        style={[
                          styles.tdCell,
                          { flex: 2, flexDirection: "row", alignItems: "center", gap: 6 },
                        ]}
                      >
                        <Cpu
                          size={13}
                          color={node.cluster === "opencode" ? "#34d399" : "#38bdf8"}
                        />
                        <Text style={styles.nodeIdText}>{node.nodeId}</Text>
                      </View>

                      <View
                        style={[
                          styles.tdCell,
                          { flex: 1.5, flexDirection: "row", alignItems: "center", gap: 4 },
                        ]}
                      >
                        <View
                          style={[
                            styles.clusterBadge,
                            node.cluster === "opencode" ? styles.badgeOpenCode : styles.badgeAgy,
                          ]}
                        >
                          <Text style={styles.clusterBadgeText}>
                            {node.cluster === "opencode" ? "OpenCode Free" : "AGY Mesh"}
                          </Text>
                        </View>
                      </View>

                      <View style={[styles.tdCell, { flex: 1.2, gap: 4 }]}>
                        <Text style={styles.shareText}>{node.sharePercent}%</Text>
                        <View style={styles.progressTrack}>
                          <View
                            style={[
                              styles.progressBar,
                              {
                                width: `${Math.min(100, node.sharePercent)}%`,
                                backgroundColor: isHotspot ? "#f59e0b" : "#38bdf8",
                              },
                            ]}
                          />
                        </View>
                      </View>

                      <Text style={[styles.tdCell, styles.numText, { flex: 1 }]}>
                        {node.requestsCount}
                      </Text>
                      <Text style={[styles.tdCell, styles.numText, { flex: 1 }]}>
                        {formatTokens(node.tokensConsumed)}
                      </Text>
                      <Text style={[styles.tdCell, styles.savedText, { flex: 1 }]}>
                        +${node.usdSaved.toFixed(3)}
                      </Text>

                      <View style={[styles.tdCell, { flex: 1.2 }]}>
                        <View
                          style={[
                            styles.nodeStatusPill,
                            isOptimal && styles.statusOptimal,
                            isHotspot && styles.statusHotspot,
                            isUnder && styles.statusUnder,
                            isIdle && styles.statusIdle,
                          ]}
                        >
                          <Text
                            style={[
                              styles.nodeStatusPillText,
                              isOptimal && styles.textOptimal,
                              isHotspot && styles.textHotspot,
                              isUnder && styles.textUnder,
                              isIdle && styles.textIdle,
                            ]}
                          >
                            {node.status.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Individual Request Audit Log Table */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <ListFilter size={16} color={styles.iconAccent.color} />
                <Text style={styles.sectionTitle}>
                  Individual Request Audit Logs ({filteredRequests.length})
                </Text>
              </View>

              <View style={styles.clusterFilterRow}>
                {(["all", "opencode", "agy"] as const).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setClusterFilter(c)}
                    style={[
                      styles.clusterFilterPill,
                      clusterFilter === c && styles.clusterFilterPillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.clusterFilterText,
                        clusterFilter === c && styles.clusterFilterTextActive,
                      ]}
                    >
                      {c === "all"
                        ? "All Clusters"
                        : c === "opencode"
                          ? "OpenCode Free"
                          : "AGY Mesh"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {filteredRequests.length === 0 ? (
              <View style={styles.emptyChartBox}>
                <Text style={styles.emptyChartText}>No logged requests in this filter</Text>
              </View>
            ) : (
              <View style={styles.requestsList}>
                {filteredRequests.map((req) => {
                  const isExpanded = expandedRequestId === req.id;
                  const isSuccess = req.status === "completed" && req.exitCode === 0;

                  return (
                    <View key={req.id} style={styles.reqCard}>
                      <Pressable onPress={() => toggleExpand(req.id)} style={styles.reqRow}>
                        <View style={styles.statusCol}>
                          {isSuccess ? (
                            <CheckCircle2 size={16} color={styles.iconSuccess.color} />
                          ) : (
                            <XCircle size={16} color={styles.iconDanger.color} />
                          )}
                        </View>

                        <View style={styles.reqMainCol}>
                          <View style={styles.reqHeaderRow}>
                            <Text style={styles.reqIdText}>{req.id}</Text>
                            <View style={styles.nodeTag}>
                              <Cpu
                                size={11}
                                color={req.cluster === "opencode" ? "#34d399" : "#38bdf8"}
                              />
                              <Text style={styles.nodeTagText}>{req.nodeId}</Text>
                            </View>
                            <Text style={styles.modelTagText}>
                              {getModelDisplayName(req.model)}
                            </Text>
                            {req.costSavedUsd && req.costSavedUsd > 0 ? (
                              <View style={styles.savedPill}>
                                <Text style={styles.savedPillText}>
                                  +${req.costSavedUsd.toFixed(4)} saved
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text
                            style={styles.promptSummary}
                            numberOfLines={isExpanded ? undefined : 1}
                          >
                            {req.promptSummary || "(No prompt preview available)"}
                          </Text>
                        </View>

                        <View style={styles.reqMetricsCol}>
                          <View style={styles.durationRow}>
                            <Clock size={11} color={styles.iconMuted.color} />
                            <Text style={styles.durationText}>
                              {(req.durationMs / 1000).toFixed(1)}s
                            </Text>
                          </View>
                          <Text style={styles.tokenText}>{req.totalTokens ?? 0} tokens</Text>
                        </View>

                        <View style={styles.expandCol}>
                          {isExpanded ? (
                            <ChevronDown size={15} color={styles.iconMuted.color} />
                          ) : (
                            <ChevronRight size={15} color={styles.iconMuted.color} />
                          )}
                        </View>
                      </Pressable>

                      {isExpanded && (
                        <View style={styles.expandedDetails}>
                          {req.outputPreview ? (
                            <View style={styles.outputBox}>
                              <Text style={styles.outputTitle}>Output Preview:</Text>
                              <Text style={styles.outputContent}>{req.outputPreview}</Text>
                            </View>
                          ) : null}
                          {req.errorMessage ? (
                            <View style={styles.errorBox}>
                              <Text style={styles.errorTitle}>Error Message:</Text>
                              <Text style={styles.errorContent}>{req.errorMessage}</Text>
                            </View>
                          ) : null}
                          <Text style={styles.timestampMeta}>
                            Executed at:{" "}
                            {req.createdIso || new Date(req.createdAt || Date.now()).toISOString()}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    backgroundColor: "transparent",
  },
  contentContainer: {
    paddingBottom: 40,
    gap: 16,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  titleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mainTitle: {
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: "700",
  },
  subTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
  actionsGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timeRangeSelector: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 2,
    gap: 2,
  },
  rangePill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  rangePillActive: {
    backgroundColor: theme.colors.accent,
  },
  rangeText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  rangeTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  refreshBtnText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  pruneBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pruneBtnText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
  },
  alertText: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "500",
  },

  /* ── KPI Grid ── */
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  kpiCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: theme.colors.surface1,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
  },
  kpiHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  kpiValue: {
    color: theme.colors.foreground,
    fontSize: 20,
    fontWeight: "700",
  },
  kpiSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  kpiSub: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  kpiSubSuccess: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "600",
  },
  textEmerald: {
    color: "#34d399",
  },
  textPurple: {
    color: "#c084fc",
  },
  textBold: {
    fontWeight: "700",
    color: theme.colors.foreground,
  },

  /* ── Navigation Tabs ── */
  tabNavRow: {
    flexDirection: "row",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: 4,
    flexWrap: "wrap",
  },
  tabButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  tabButtonActive: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tabText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  tabTextActive: {
    color: theme.colors.foreground,
    fontWeight: "700",
  },
  tabBadge: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tabBadgeActive: {
    backgroundColor: "rgba(56, 189, 248, 0.2)",
  },
  tabBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "700",
  },

  /* ── Section Cards ── */
  sectionCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 14,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "700",
  },
  sectionSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  sectionHeaderMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },

  /* ── 4D Scatter Matrix Container ── */
  scatterContainer: {
    height: 280,
    width: "100%",
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    position: "relative",
    overflow: "hidden",
    marginTop: 6,
  },
  quadrantGrid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 24,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  quadrantBox: {
    width: "50%",
    height: "50%",
    borderColor: "rgba(255, 255, 255, 0.04)",
    padding: 8,
  },
  quadrantLabel: {
    color: "rgba(255, 255, 255, 0.15)",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  scatterBubble: {
    position: "absolute",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    zIndex: 10,
  },
  bubbleLabel: {
    fontSize: 10,
    textAlign: "center",
  },
  bubbleSubLabel: {
    fontSize: 8,
    color: "rgba(255, 255, 255, 0.6)",
  },
  axisXLabelRow: {
    position: "absolute",
    bottom: 4,
    left: 12,
    right: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  axisTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  axisTitleVertical: {
    color: theme.colors.foregroundMuted,
    fontSize: 9,
    fontWeight: "600",
    transform: [{ rotate: "-90deg" }],
  },
  axisLabel: {
    color: "rgba(255, 255, 255, 0.35)",
    fontSize: 9,
  },
  axisYLabelCol: {
    position: "absolute",
    top: 20,
    left: -20,
    bottom: 40,
    justifyContent: "center",
  },
  matrixLegendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  /* ── Deep Model Inspector HUD ── */
  inspectorHudCard: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    gap: 10,
  },
  hudHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hudHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hudColorBadge: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  hudModelTitle: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "700",
  },
  hudModelMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },
  hudShareBadge: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  hudShareText: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "700",
  },
  hudMetricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  hudMetricItem: {
    flex: 1,
    minWidth: 120,
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  hudMetricLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    textTransform: "uppercase",
  },
  hudMetricValue: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "700",
  },
  hudMetricSub: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },
  hudNodesRow: {
    gap: 6,
  },
  hudNodesLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  hudNodesChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  hudNodeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: theme.colors.surface1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  hudNodeChipText: {
    color: theme.colors.foreground,
    fontSize: 10,
    fontWeight: "500",
  },

  /* ── Model Intelligence Table ── */
  modelTable: {
    width: "100%",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface2,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tableDataRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  tableDataRowSelected: {
    backgroundColor: "rgba(56, 189, 248, 0.08)",
  },
  tableFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface2,
    borderTopWidth: 2,
    borderTopColor: theme.colors.accent,
  },
  footerTotalLabel: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  footerTotalText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  thCell: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tdCell: {
    justifyContent: "center",
  },
  modelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modelDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modelRowName: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontWeight: "600",
  },
  shareTextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  shareTextVal: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: "700",
  },
  shareTextSub: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },
  numText: {
    color: theme.colors.foreground,
    fontSize: 11,
  },
  savedText: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "600",
  },

  /* ── Node x Model Load Stacked Bars ── */
  nodeLoadList: {
    gap: 12,
  },
  nodeLoadCard: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  nodeLoadHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  nodeLoadHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  nodeLoadId: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "700",
  },
  nodeLoadHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  nodeLoadMetaText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  stackedBarContainer: {
    height: 20,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: 6,
    flexDirection: "row",
    overflow: "hidden",
  },
  stackedBarSegment: {
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  stackedBarText: {
    color: "#000000",
    fontSize: 10,
    fontWeight: "800",
  },
  nodeModelChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  nodeModelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  nodeModelChipName: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: "600",
  },
  nodeModelChipPercent: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: "700",
  },
  nodeModelChipSub: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },

  /* ── Timeline & Node Status Styles ── */
  retentionBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexWrap: "wrap",
    gap: 8,
  },
  retentionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 280,
  },
  retentionText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  retentionBold: {
    color: theme.colors.foreground,
    fontWeight: "700",
  },
  retentionMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },
  chartContainer: {
    gap: 12,
  },
  chartBarsRow: {
    height: 120,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    paddingTop: 10,
  },
  chartCol: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    height: "100%",
    justifyContent: "flex-end",
  },
  barTrack: {
    flex: 1,
    width: "100%",
    backgroundColor: theme.colors.surface2,
    borderRadius: 4,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    backgroundColor: "#38bdf8",
    borderRadius: 4,
  },
  barFillError: {
    backgroundColor: "#f87171",
  },
  chartLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 9,
    textAlign: "center",
  },
  chartLegend: {
    flexDirection: "row",
    gap: 14,
    justifyContent: "flex-end",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },

  /* ── Status Badges ── */
  statusLegend: {
    flexDirection: "row",
    gap: 6,
  },
  legendBadgeOptimal: {
    backgroundColor: "rgba(52, 211, 153, 0.15)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  legendBadgeHotspot: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  legendBadgeUnder: {
    backgroundColor: "rgba(148, 163, 184, 0.15)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  legendBadgeIdle: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  legendBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
  },
  nodeTable: {
    width: "100%",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  nodeIdText: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontWeight: "600",
  },
  clusterBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeOpenCode: {
    backgroundColor: "rgba(52, 211, 153, 0.15)",
  },
  badgeAgy: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
  },
  clusterBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  shareText: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: "600",
  },
  progressTrack: {
    height: 4,
    backgroundColor: theme.colors.surface2,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 2,
  },
  nodeStatusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  statusOptimal: {
    backgroundColor: "rgba(52, 211, 153, 0.15)",
  },
  statusHotspot: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  statusUnder: {
    backgroundColor: "rgba(148, 163, 184, 0.15)",
  },
  statusIdle: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
  },
  nodeStatusPillText: {
    fontSize: 9,
    fontWeight: "700",
  },
  textOptimal: {
    color: "#34d399",
  },
  textHotspot: {
    color: "#f59e0b",
  },
  textUnder: {
    color: "#94a3b8",
  },
  textIdle: {
    color: "#ef4444",
  },

  /* ── Filter Pills ── */
  clusterFilterRow: {
    flexDirection: "row",
    gap: 6,
  },
  clusterFilterPill: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
  },
  clusterFilterPillActive: {
    backgroundColor: theme.colors.accent,
  },
  clusterFilterText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "500",
  },
  clusterFilterTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },

  /* ── Requests List ── */
  requestsList: {
    gap: 6,
  },
  reqCard: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  reqRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    gap: 8,
  },
  statusCol: {
    width: 24,
    alignItems: "center",
  },
  reqMainCol: {
    flex: 1,
    gap: 3,
  },
  reqHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  reqIdText: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: "700",
  },
  nodeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  nodeTagText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "500",
  },
  modelTagText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },
  savedPill: {
    backgroundColor: "rgba(52, 211, 153, 0.15)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  savedPillText: {
    color: "#34d399",
    fontSize: 9,
    fontWeight: "700",
  },
  promptSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  reqMetricsCol: {
    alignItems: "flex-end",
    gap: 2,
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  durationText: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: "600",
  },
  tokenText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },
  expandCol: {
    paddingLeft: 4,
  },
  expandedDetails: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: 8,
  },
  outputBox: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 6,
    padding: 8,
    gap: 4,
  },
  outputTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  outputContent: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontFamily: "monospace",
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderRadius: 6,
    padding: 8,
    gap: 4,
  },
  errorTitle: {
    color: "#ef4444",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  errorContent: {
    color: "#ef4444",
    fontSize: 11,
    fontFamily: "monospace",
  },
  timestampMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
  },
  emptyChartBox: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyChartText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
  iconAccent: {
    color: theme.colors.accent,
  },
  iconSuccess: {
    color: "#34d399",
  },
  iconPurple: {
    color: "#c084fc",
  },
  iconBlue: {
    color: "#38bdf8",
  },
  iconWarning: {
    color: "#f59e0b",
  },
  iconDanger: {
    color: "#ef4444",
  },
  iconMuted: {
    color: theme.colors.foregroundMuted,
  },
}));
