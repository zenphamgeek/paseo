import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "@react-navigation/native";
import { Bot, Cpu, ListFilter, RefreshCw, ShieldCheck, Terminal, Zap } from "lucide-react-native";
import { PageLayout } from "@/components/page-layout";
import { FleetAutonomousView } from "./fleet-autonomous-view";
import { FleetCouncilView } from "./fleet-council-view";
import { FleetJobsView } from "./fleet-jobs-view";
import { FleetNodesView } from "./fleet-nodes-view";
import { FleetRunnerView } from "./fleet-runner-view";
import type { FleetActiveTab, FleetClusterSummary } from "./types";
import { useFleetData } from "./use-fleet-data";

interface FleetHeaderActionsProps {
  summary: FleetClusterSummary;
  isRefreshing: boolean;
  onRefresh: () => void;
}

function FleetHeaderActions({ summary, isRefreshing, onRefresh }: FleetHeaderActionsProps) {
  return (
    <View style={styles.headerActions}>
      <View style={styles.clusterPill}>
        <View style={styles.dotGreen} />
        <Text style={styles.clusterPillText}>
          {summary.onlineNodes}/{summary.totalNodes} NODES ONLINE
        </Text>
      </View>

      <Pressable
        onPress={onRefresh}
        disabled={isRefreshing}
        style={styles.refreshBtn}
        testID="fleet-refresh-quotas-btn"
      >
        <RefreshCw size={13} color={styles.iconMuted.color} />
        <Text style={styles.refreshBtnText}>{isRefreshing ? "Syncing..." : "Refresh"}</Text>
      </Pressable>
    </View>
  );
}

interface FleetKpiGridProps {
  summary: FleetClusterSummary;
  nodesCount: number;
}

function FleetKpiGrid({ summary, nodesCount }: FleetKpiGridProps) {
  return (
    <View style={styles.kpiGrid}>
      <View style={styles.kpiCard}>
        <View style={styles.kpiHeader}>
          <Text style={styles.kpiLabel}>Fleet Nodes</Text>
          <Cpu size={16} color={styles.iconAccent.color} />
        </View>
        <Text style={styles.kpiValue}>{nodesCount || summary.totalNodes}</Text>
        <Text style={styles.kpiSub}>
          {summary.ultraNodes} Ultra (Opus) • {summary.proNodes} Pro (Gemini)
        </Text>
      </View>

      <View style={styles.kpiCard}>
        <View style={styles.kpiHeader}>
          <Text style={styles.kpiLabel}>Cluster Quota</Text>
          <Zap size={16} color={styles.iconAccent.color} />
        </View>
        <Text style={[styles.kpiValue, styles.textMint]}>{summary.overallQuotaPercent}%</Text>
        <Text style={styles.kpiSub}>Dual 5h & Weekly Windows</Text>
      </View>

      <View style={styles.kpiCard}>
        <View style={styles.kpiHeader}>
          <Text style={styles.kpiLabel}>Council Gates</Text>
          <ShieldCheck size={16} color={styles.iconMerged.color} />
        </View>
        <Text style={[styles.kpiValue, styles.textPurple]}>100% PASS</Text>
        <Text style={styles.kpiSub}>Hybrid (Deterministic + Semantic)</Text>
      </View>

      <View style={styles.kpiCard}>
        <View style={styles.kpiHeader}>
          <Text style={styles.kpiLabel}>9Router Egress</Text>
          <Bot size={16} color={styles.iconMuted.color} />
        </View>
        <Text style={styles.kpiValue}>ACTIVE</Text>
        <Text style={styles.kpiSub}>Stealth Zero-Outbound Telemetry</Text>
      </View>
    </View>
  );
}

interface FleetTabsBarProps {
  activeTab: FleetActiveTab;
  onSetNodes: () => void;
  onSetAutonomous: () => void;
  onSetCouncil: () => void;
  onSetRunner: () => void;
  onSetJobs: () => void;
  nodesCount: number;
  jobsCount: number;
}

function FleetTabsBar({
  activeTab,
  onSetNodes,
  onSetAutonomous,
  onSetCouncil,
  onSetRunner,
  onSetJobs,
  nodesCount,
  jobsCount,
}: FleetTabsBarProps) {
  return (
    <View style={styles.tabsRow}>
      <Pressable
        onPress={onSetNodes}
        style={[styles.tabBtn, activeTab === "nodes" && styles.tabBtnActive]}
      >
        <Cpu
          size={14}
          color={activeTab === "nodes" ? styles.iconAccent.color : styles.iconMuted.color}
        />
        <Text style={[styles.tabText, activeTab === "nodes" && styles.tabTextActive]}>
          Nodes & Quotas ({nodesCount || 15})
        </Text>
      </Pressable>

      <Pressable
        onPress={onSetAutonomous}
        style={[styles.tabBtn, activeTab === "autonomous" && styles.tabBtnActive]}
      >
        <Bot
          size={14}
          color={activeTab === "autonomous" ? styles.iconAccent.color : styles.iconMuted.color}
        />
        <Text style={[styles.tabText, activeTab === "autonomous" && styles.tabTextActive]}>
          Autonomous Swarm
        </Text>
      </Pressable>

      <Pressable
        onPress={onSetCouncil}
        style={[styles.tabBtn, activeTab === "council" && styles.tabBtnActive]}
      >
        <ShieldCheck
          size={14}
          color={activeTab === "council" ? styles.iconAccent.color : styles.iconMuted.color}
        />
        <Text style={[styles.tabText, activeTab === "council" && styles.tabTextActive]}>
          Clef Council Matrix
        </Text>
      </Pressable>

      <Pressable
        onPress={onSetRunner}
        style={[styles.tabBtn, activeTab === "runner" && styles.tabBtnActive]}
      >
        <Terminal
          size={14}
          color={activeTab === "runner" ? styles.iconAccent.color : styles.iconMuted.color}
        />
        <Text style={[styles.tabText, activeTab === "runner" && styles.tabTextActive]}>
          Swarm Prompt Runner
        </Text>
      </Pressable>

      <Pressable
        onPress={onSetJobs}
        style={[styles.tabBtn, activeTab === "jobs" && styles.tabBtnActive]}
      >
        <ListFilter
          size={14}
          color={activeTab === "jobs" ? styles.iconAccent.color : styles.iconMuted.color}
        />
        <Text style={[styles.tabText, activeTab === "jobs" && styles.tabTextActive]}>
          History ({jobsCount})
        </Text>
      </Pressable>
    </View>
  );
}

export function FleetScreen() {
  const isFocused = useIsFocused();
  const [activeTab, setActiveTab] = useState<FleetActiveTab>("nodes");

  const {
    nodes,
    summary,
    jobs,
    council,
    isRefreshing,
    refreshQuotas,
    dispatchTask,
    toggleAutonomous,
  } = useFleetData();

  const handleSetNodes = useCallback(() => setActiveTab("nodes"), []);
  const handleSetAutonomous = useCallback(() => setActiveTab("autonomous"), []);
  const handleSetCouncil = useCallback(() => setActiveTab("council"), []);
  const handleSetRunner = useCallback(() => setActiveTab("runner"), []);
  const handleSetJobs = useCallback(() => setActiveTab("jobs"), []);

  const headerActions = useMemo(
    () => (
      <FleetHeaderActions summary={summary} isRefreshing={isRefreshing} onRefresh={refreshQuotas} />
    ),
    [summary, isRefreshing, refreshQuotas],
  );

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return (
    <PageLayout
      title="Fleet Swarm Command Center"
      actions={headerActions}
      testID="fleet-command-center"
    >
      <View style={styles.content}>
        <FleetKpiGrid summary={summary} nodesCount={nodes.length} />

        <FleetTabsBar
          activeTab={activeTab}
          onSetNodes={handleSetNodes}
          onSetAutonomous={handleSetAutonomous}
          onSetCouncil={handleSetCouncil}
          onSetRunner={handleSetRunner}
          onSetJobs={handleSetJobs}
          nodesCount={nodes.length}
          jobsCount={jobs.length}
        />

        {/* Tab Content Display */}
        <View style={styles.tabContentArea}>
          {activeTab === "nodes" ? (
            <FleetNodesView
              nodes={nodes}
              _onRefreshQuotas={refreshQuotas}
              _isRefreshing={isRefreshing}
            />
          ) : null}

          {activeTab === "autonomous" ? (
            <FleetAutonomousView summary={summary} onToggleAutonomous={toggleAutonomous} />
          ) : null}

          {activeTab === "council" ? <FleetCouncilView _council={council} /> : null}

          {activeTab === "runner" ? (
            <FleetRunnerView nodes={nodes} onDispatchTask={dispatchTask} />
          ) : null}

          {activeTab === "jobs" ? <FleetJobsView jobs={jobs} /> : null}
        </View>
      </View>
    </PageLayout>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  content: {
    width: "100%",
    gap: 20,
    paddingBottom: 36,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  clusterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.statusSuccessTint,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
  },
  dotGreen: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  clusterPillText: {
    color: theme.colors.statusSuccess,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  refreshBtnText: {
    color: theme.colors.foreground,
    fontSize: 11,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  kpiCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
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
    fontSize: 22,
    fontWeight: "800",
    fontFamily: "monospace",
  },
  kpiSub: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  textMint: {
    color: theme.colors.accent,
  },
  textPurple: {
    color: theme.colors.statusMerged,
  },
  tabsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: 4,
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabBtnActive: {
    borderBottomColor: theme.colors.accent,
  },
  tabText: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  tabTextActive: {
    color: theme.colors.foreground,
  },
  tabContentArea: {
    width: "100%",
  },
  iconAccent: {
    color: theme.colors.accent,
  },
  iconMuted: {
    color: theme.colors.foregroundMuted,
  },
  iconMerged: {
    color: theme.colors.statusMerged,
  },
}));
