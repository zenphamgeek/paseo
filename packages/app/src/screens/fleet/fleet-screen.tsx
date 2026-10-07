import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  ChevronRight,
  Cpu,
  Home,
  Key,
  ListFilter,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  BarChart2,
  Terminal,
  Zap,
} from "lucide-react-native";
import { PageLayout } from "@/components/page-layout";
import { FleetAnalyticsView } from "./fleet-analytics-view";
import { FleetAuthView } from "./fleet-auth-view";
import { FleetAutonomousView } from "./fleet-autonomous-view";
import { FleetCouncilView } from "./fleet-council-view";
import { FleetGpuSwarmView } from "./fleet-gpu-swarm-view";
import { FleetJobsView } from "./fleet-jobs-view";
import { FleetNodesView, getNodeAttentionMeta } from "./fleet-nodes-view";
import { FleetOnboardingView } from "./fleet-onboarding-view";
import { UserMinimalUsageView } from "./user-minimal-usage-view";
import { FleetRunnerView } from "./fleet-runner-view";
import { FleetSelfHealingView } from "./fleet-self-healing-view";
import { FleetTelemetryView } from "./fleet-telemetry-view";
import type { FleetActiveTab, FleetClusterSummary } from "./types";
import { useFleetData } from "./use-fleet-data";

interface FleetHeaderActionsProps {
  summary: FleetClusterSummary;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
}

function FleetHeaderActions({ summary, isRefreshing, onRefresh, onBack }: FleetHeaderActionsProps) {
  return (
    <View style={styles.headerActions}>
      <Pressable
        onPress={onBack}
        style={styles.headerBackBtn}
        testID="fleet-header-back-btn"
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ArrowLeft size={13} color={styles.iconAccent.color} />
        <Text style={styles.headerBackBtnText}>Back</Text>
      </Pressable>

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
  onSetOnboarding: () => void;
  onSetNodes: () => void;
  onSetAutonomous: () => void;
  onSetAnalytics: () => void;
  onSetGpuSwarm: () => void;
  onSetCouncil: () => void;
  onSetRunner: () => void;
  onSetJobs: () => void;
  onSetTelemetry: () => void;
  onSetAuth: () => void;
  onSetSelfHealing: () => void;
  nodesCount: number;
  jobsCount: number;
  attentionCount?: number;
}

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  icon: React.ComponentType<{ size: number; color: string }>;
  testID?: string;
  badge?: {
    text: string;
    variant?: "critical" | "warning" | "neutral";
  };
}

function TabButton({ label, isActive, onPress, icon: Icon, testID, badge }: TabButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabBtn, isActive && styles.tabBtnActive]}
      testID={testID}
    >
      <Icon size={14} color={isActive ? styles.iconAccent.color : styles.iconMuted.color} />
      <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
      {badge ? (
        <View
          style={[
            styles.tabBadge,
            badge.variant === "critical" && styles.tabBadgeCritical,
            badge.variant === "warning" && styles.tabBadgeWarning,
          ]}
        >
          <Text
            style={[
              styles.tabBadgeText,
              badge.variant === "critical" && styles.tabBadgeTextCritical,
              badge.variant === "warning" && styles.tabBadgeTextWarning,
            ]}
          >
            {badge.text}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function FleetTabsBar({
  activeTab,
  onSetOnboarding,
  onSetNodes,
  onSetAutonomous,
  onSetAnalytics,
  onSetGpuSwarm,
  onSetCouncil,
  onSetRunner,
  onSetJobs,
  onSetTelemetry,
  onSetAuth,
  onSetSelfHealing,
  nodesCount,
  jobsCount,
  attentionCount = 0,
}: FleetTabsBarProps) {
  return (
    <View style={styles.tabsRow}>
      <TabButton
        label="Onboarding & Passkey"
        isActive={activeTab === "onboarding"}
        onPress={onSetOnboarding}
        icon={Key}
        testID="tab-btn-onboarding"
      />
      <TabButton
        label={`Nodes & Quotas (${nodesCount || 15})`}
        isActive={activeTab === "nodes"}
        onPress={onSetNodes}
        icon={Cpu}
        badge={
          attentionCount > 0 ? { text: `${attentionCount} Alert`, variant: "critical" } : undefined
        }
      />
      <TabButton
        label="Autonomous Swarm"
        isActive={activeTab === "autonomous"}
        onPress={onSetAutonomous}
        icon={Bot}
      />
      <TabButton
        label="Analytics & Tokenomics"
        isActive={activeTab === "analytics"}
        onPress={onSetAnalytics}
        icon={BarChart2}
        testID="tab-btn-analytics"
      />
      <TabButton
        label="Modal GPU Swarm"
        isActive={activeTab === "gpu_swarm"}
        onPress={onSetGpuSwarm}
        icon={Zap}
        testID="tab-btn-gpu-swarm"
      />
      <TabButton
        label="Self-Healing & Git Fix"
        isActive={activeTab === "self_healing"}
        onPress={onSetSelfHealing}
        icon={ShieldAlert}
        testID="tab-btn-self-healing"
      />
      <TabButton
        label="Clef Council Matrix"
        isActive={activeTab === "council"}
        onPress={onSetCouncil}
        icon={ShieldCheck}
      />
      <TabButton
        label="Telemetry & Health"
        isActive={activeTab === "telemetry"}
        onPress={onSetTelemetry}
        icon={Activity}
      />
      <TabButton
        label="OAuth & Plugins"
        isActive={activeTab === "auth"}
        onPress={onSetAuth}
        icon={Key}
        testID="tab-btn-auth"
      />
      <TabButton
        label="Swarm Prompt Runner"
        isActive={activeTab === "runner"}
        onPress={onSetRunner}
        icon={Terminal}
      />
      <TabButton
        label={`History (${jobsCount})`}
        isActive={activeTab === "jobs"}
        onPress={onSetJobs}
        icon={ListFilter}
      />
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
    telemetry,
    authStatus,
    isLoading,
    isRefreshing,
    isTelemetryHalted,
    retentionPeriod,
    setRetentionPeriod,
    refreshQuotas,
    runAutoConfig,
    saveManualAuth,
    dispatchTask,
    toggleAutonomous,
    toggleHaltTelemetry,
  } = useFleetData();

  const handleSetOnboarding = useCallback(() => setActiveTab("onboarding"), []);
  const handleSetNodes = useCallback(() => setActiveTab("nodes"), []);
  const handleSetAutonomous = useCallback(() => setActiveTab("autonomous"), []);
  const handleSetAnalytics = useCallback(() => setActiveTab("analytics"), []);
  const handleSetGpuSwarm = useCallback(() => setActiveTab("gpu_swarm"), []);
  const handleSetCouncil = useCallback(() => setActiveTab("council"), []);
  const handleSetRunner = useCallback(() => setActiveTab("runner"), []);
  const handleSetJobs = useCallback(() => setActiveTab("jobs"), []);
  const handleSetTelemetry = useCallback(() => setActiveTab("telemetry"), []);
  const handleSetAuth = useCallback(() => setActiveTab("auth"), []);
  const handleSetSelfHealing = useCallback(() => setActiveTab("self_healing"), []);

  const leaveFleet = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        leaveFleet();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [leaveFleet]);

  const headerActions = useMemo(
    () => (
      <FleetHeaderActions
        summary={summary}
        isRefreshing={isRefreshing}
        onRefresh={refreshQuotas}
        onBack={leaveFleet}
      />
    ),
    [summary, isRefreshing, refreshQuotas, leaveFleet],
  );

  const attentionCount = useMemo(() => {
    return nodes.filter((n) => getNodeAttentionMeta(n).isAttentionRequired).length;
  }, [nodes]);

  const [isAdmin, setIsAdmin] = useState(true);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const role = window.localStorage?.getItem("zencode_user_role");
      const token = window.localStorage?.getItem("zencode_access_token");
      if (role && role !== "admin") {
        setIsAdmin(false);
      } else if (token && !token.startsWith("zen_live_admin_")) {
        setIsAdmin(false);
      } else {
        setIsAdmin(true);
      }
    } catch {
      // ignore
    }
  }, []);

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  if (!isAdmin) {
    return (
      <PageLayout
        title="Tài Khoản & Hạn Mức Zencode"
        onBack={leaveFleet}
        testID="user-minimal-fleet-page"
        fluid
      >
        <UserMinimalUsageView onBack={leaveFleet} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Fleet Swarm Command Center"
      onBack={leaveFleet}
      actions={headerActions}
      testID="fleet-command-center"
      fluid
    >
      <View style={styles.content}>
        {/* Navigation & Breadcrumbs Ribbon */}
        <View style={styles.navRibbon}>
          <Pressable
            onPress={leaveFleet}
            style={styles.backButtonLarge}
            accessibilityRole="button"
            accessibilityLabel="Quay lại Không gian làm việc"
            testID="fleet-back-to-workspace-btn"
          >
            <ArrowLeft size={14} color={styles.iconAccent.color} />
            <Text style={styles.backButtonText}>Quay lại Không gian làm việc</Text>
            <View style={styles.escBadge}>
              <Text style={styles.escBadgeText}>ESC</Text>
            </View>
          </Pressable>

          <View style={styles.breadcrumbs}>
            <Pressable
              onPress={() => router.replace("/")}
              style={styles.breadcrumbItem}
              testID="fleet-breadcrumb-home"
            >
              <Home size={13} color={styles.iconMuted.color} />
              <Text style={styles.breadcrumbText}>Zencode</Text>
            </Pressable>
            <ChevronRight size={12} color={styles.iconMuted.color} />
            <View style={styles.breadcrumbActive}>
              <Cpu size={13} color={styles.iconAccent.color} />
              <Text style={styles.breadcrumbActiveText}>Autonomous Fleet Hub</Text>
            </View>
          </View>

          <View style={styles.stealthPill}>
            <ShieldCheck size={12} color="#10b981" />
            <Text style={styles.stealthPillText}>STEALTH MODE ACTIVE</Text>
          </View>
        </View>

        <FleetKpiGrid summary={summary} nodesCount={nodes.length} />

        <FleetTabsBar
          activeTab={activeTab}
          onSetOnboarding={handleSetOnboarding}
          onSetNodes={handleSetNodes}
          onSetAutonomous={handleSetAutonomous}
          onSetAnalytics={handleSetAnalytics}
          onSetGpuSwarm={handleSetGpuSwarm}
          onSetCouncil={handleSetCouncil}
          onSetRunner={handleSetRunner}
          onSetJobs={handleSetJobs}
          onSetTelemetry={handleSetTelemetry}
          onSetAuth={handleSetAuth}
          onSetSelfHealing={handleSetSelfHealing}
          nodesCount={nodes.length}
          jobsCount={jobs.length}
          attentionCount={attentionCount}
        />

        {/* Tab Content Display */}
        <View style={styles.tabContentArea}>
          {activeTab === "onboarding" ? <FleetOnboardingView /> : null}

          {activeTab === "nodes" ? (
            <FleetNodesView
              nodes={nodes}
              retentionPeriod={retentionPeriod}
              onRetentionChange={setRetentionPeriod}
              _onRefreshQuotas={refreshQuotas}
              _isRefreshing={isRefreshing}
            />
          ) : null}

          {activeTab === "autonomous" ? (
            <FleetAutonomousView
              summary={summary}
              nodes={nodes}
              onToggleAutonomous={toggleAutonomous}
            />
          ) : null}

          {activeTab === "analytics" ? (
            <FleetAnalyticsView onNavigateToRunner={handleSetRunner} />
          ) : null}

          {activeTab === "gpu_swarm" ? <FleetGpuSwarmView /> : null}

          {activeTab === "self_healing" ? <FleetSelfHealingView /> : null}

          {activeTab === "council" ? <FleetCouncilView _council={council} /> : null}

          {activeTab === "telemetry" ? (
            <FleetTelemetryView
              telemetry={telemetry}
              isLoading={isLoading}
              onRefresh={refreshQuotas}
              isHalted={isTelemetryHalted}
              onToggleHalt={toggleHaltTelemetry}
            />
          ) : null}

          {activeTab === "auth" ? (
            <FleetAuthView
              authStatus={authStatus}
              isLoading={isLoading}
              onRefresh={refreshQuotas}
              onAutoConfig={runAutoConfig}
              onSaveManualAuth={saveManualAuth}
            />
          ) : null}

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
  headerBackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  headerBackBtnText: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: "600",
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
  navRibbon: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
  },
  backButtonLarge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
  },
  backButtonText: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontWeight: "600",
  },
  escBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  escBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  breadcrumbs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  breadcrumbItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  breadcrumbText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "500",
  },
  breadcrumbActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  breadcrumbActiveText: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  stealthPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  stealthPillText: {
    color: "#10b981",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
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
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 9999,
    backgroundColor: theme.colors.surface2,
    marginLeft: 2,
  },
  tabBadgeCritical: {
    backgroundColor: "rgba(244, 63, 94, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.5)",
  },
  tabBadgeWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.5)",
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
  },
  tabBadgeTextCritical: {
    color: "#fb7185",
  },
  tabBadgeTextWarning: {
    color: "#f59e0b",
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
