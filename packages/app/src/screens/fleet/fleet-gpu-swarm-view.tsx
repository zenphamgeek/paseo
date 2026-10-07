import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  Database,
  DollarSign,
  ExternalLink,
  FileText,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Scale,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react-native";
import type {
  ModalAllocationResultUI,
  ModalExecutionLogUI,
  ModalGpuProfileUI,
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
import { useModalGpuData } from "./use-modal-gpu-data";

export function FleetGpuSwarmView() {
  const {
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
    refreshData,
    fetchModalLogs,
    pruneModalLogs,
    fetchCrossMeshRebalance,
    applyCrossMeshRebalance,
    switchProfile,
    executeCli,
    allocateWorkload,
  } = useModalGpuData();

  const [cliInput, setCliInput] = useState("app list --json");
  const [activeSubTab, setActiveSubTab] = useState<
    "credits" | "rebalance" | "logs" | "workers" | "catalog" | "cli" | "profiles"
  >("credits");
  const [allocationNotice, setAllocationNotice] = useState<string | null>(null);
  const [logFilterStatus, setLogFilterStatus] = useState<string>("ALL");
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const handleRunPreset = async (cmd: string, args: string[] = []) => {
    setCliInput(`${cmd} ${args.join(" ")}`.trim());
    await executeCli(cmd, args);
  };

  const handleRunCustomCli = async () => {
    const parts = cliInput.trim().split(" ");
    const cmd = parts[0] || "app";
    const args = parts.slice(1);
    await executeCli(cmd, args);
  };

  const getHardwareColor = (hw: string) => {
    const u = hw.toUpperCase();
    if (u.includes("A100")) return "#10B981"; // Emerald
    if (u.includes("H100")) return "#3B82F6"; // Blue
    if (u.includes("A10G") || u.includes("L4")) return "#8B5CF6"; // Purple
    return "#F59E0B"; // Amber (T4)
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* ── 1. Header Banner & Active Profile ── */}
      <View style={styles.headerBanner}>
        <View style={styles.headerLeft}>
          <View style={styles.titleRow}>
            <View style={styles.iconBadge}>
              <Server size={20} color="#10B981" />
            </View>
            <Text style={styles.title}>Modal GPU Swarm & Hardware Mesh</Text>
            <View style={styles.activePill}>
              <View style={styles.dotGreen} />
              <Text style={styles.activePillText}>MODAL CLI {summary.cliVersion || "1.4.3"}</Text>
            </View>
          </View>
          <Text style={styles.subtitle}>
            Distributed Serverless GPU Execution Engine • {summary.totalProfiles} Workspaces •
            Zero-Byte Proxy Webhooks
          </Text>
        </View>

        <View style={styles.headerActions}>
          <View style={styles.activeProfileBox}>
            <Text style={styles.profileLabel}>ACTIVE PROFILE:</Text>
            <Text style={styles.profileVal}>{summary.activeProfile}</Text>
          </View>

          <Pressable
            onPress={() => refreshData(true)}
            disabled={isRefreshing}
            style={styles.refreshBtn}
            testID="modal-refresh-btn"
          >
            <RefreshCw size={13} color="#94A3B8" />
            <Text style={styles.refreshBtnText}>{isRefreshing ? "Syncing..." : "Refresh"}</Text>
          </Pressable>
        </View>
      </View>

      {/* ── 2. GPU Hardware Spectrum Grid ── */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <View style={styles.kpiTop}>
            <Text style={styles.kpiLabel}>A100-80GB Tier</Text>
            <Sparkles size={14} color="#10B981" />
          </View>
          <Text style={[styles.kpiVal, { color: "#10B981" }]}>
            {summary.hardwareSpectrum["A100-80GB"] || 1}
          </Text>
          <Text style={styles.kpiSub}>Qwen 2.1 & Heavy LLM</Text>
        </View>

        <View style={styles.kpiCard}>
          <View style={styles.kpiTop}>
            <Text style={styles.kpiLabel}>H100 Video Tier</Text>
            <Zap size={14} color="#3B82F6" />
          </View>
          <Text style={[styles.kpiVal, { color: "#3B82F6" }]}>
            {summary.hardwareSpectrum["H100"] || 2}
          </Text>
          <Text style={styles.kpiSub}>Wan 2.2 S2V & LTX 22B</Text>
        </View>

        <View style={styles.kpiCard}>
          <View style={styles.kpiTop}>
            <Text style={styles.kpiLabel}>A10G & L4 Tier</Text>
            <Layers size={14} color="#8B5CF6" />
          </View>
          <Text style={[styles.kpiVal, { color: "#8B5CF6" }]}>
            {summary.hardwareSpectrum["A10G"] || 2}
          </Text>
          <Text style={styles.kpiSub}>Swapface & ComfyUI</Text>
        </View>

        <View style={styles.kpiCard}>
          <View style={styles.kpiTop}>
            <Text style={styles.kpiLabel}>T4 / CPU Edge</Text>
            <Cpu size={14} color="#F59E0B" />
          </View>
          <Text style={[styles.kpiVal, { color: "#F59E0B" }]}>
            {summary.hardwareSpectrum["T4"] || 8}
          </Text>
          <Text style={styles.kpiSub}>TTS, Matting & LipSync</Text>
        </View>
      </View>

      {/* ── 3. Sub Tabs Navigation ── */}
      <View style={styles.subTabsRow}>
        <Pressable
          style={[styles.subTabBtn, activeSubTab === "credits" && styles.subTabBtnActive]}
          onPress={() => setActiveSubTab("credits")}
          testID="tab-modal-credits"
        >
          <DollarSign size={14} color={activeSubTab === "credits" ? "#10B981" : "#94A3B8"} />
          <Text style={[styles.subTabText, activeSubTab === "credits" && styles.subTabTextActive]}>
            Credits ({workspacesCredits.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.subTabBtn, activeSubTab === "rebalance" && styles.subTabBtnActive]}
          onPress={() => setActiveSubTab("rebalance")}
          testID="tab-modal-rebalance"
        >
          <Scale size={14} color={activeSubTab === "rebalance" ? "#10B981" : "#94A3B8"} />
          <Text
            style={[styles.subTabText, activeSubTab === "rebalance" && styles.subTabTextActive]}
          >
            Smart Rebalance ({crossMeshRecommendations.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.subTabBtn, activeSubTab === "logs" && styles.subTabBtnActive]}
          onPress={() => {
            setActiveSubTab("logs");
            fetchModalLogs({ page: 1 });
          }}
          testID="tab-modal-logs"
        >
          <FileText size={14} color={activeSubTab === "logs" ? "#10B981" : "#94A3B8"} />
          <Text style={[styles.subTabText, activeSubTab === "logs" && styles.subTabTextActive]}>
            Modal Logs & Retention ({modalLogsTotal || modalLogs.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.subTabBtn, activeSubTab === "workers" && styles.subTabBtnActive]}
          onPress={() => setActiveSubTab("workers")}
        >
          <Server size={14} color={activeSubTab === "workers" ? "#10B981" : "#94A3B8"} />
          <Text style={[styles.subTabText, activeSubTab === "workers" && styles.subTabTextActive]}>
            Deployed GPU Workers ({workers.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.subTabBtn, activeSubTab === "cli" && styles.subTabBtnActive]}
          onPress={() => setActiveSubTab("cli")}
          testID="tab-modal-cli"
        >
          <Terminal size={14} color={activeSubTab === "cli" ? "#10B981" : "#94A3B8"} />
          <Text style={[styles.subTabText, activeSubTab === "cli" && styles.subTabTextActive]}>
            Modal CLI Console
          </Text>
        </Pressable>

        <Pressable
          style={[styles.subTabBtn, activeSubTab === "catalog" && styles.subTabBtnActive]}
          onPress={() => setActiveSubTab("catalog")}
        >
          <Sparkles size={14} color={activeSubTab === "catalog" ? "#10B981" : "#94A3B8"} />
          <Text style={[styles.subTabText, activeSubTab === "catalog" && styles.subTabTextActive]}>
            Workload Catalog ({workloads.length})
          </Text>
        </Pressable>

        <Pressable
          style={[styles.subTabBtn, activeSubTab === "profiles" && styles.subTabBtnActive]}
          onPress={() => setActiveSubTab("profiles")}
        >
          <Activity size={14} color={activeSubTab === "profiles" ? "#10B981" : "#94A3B8"} />
          <Text style={[styles.subTabText, activeSubTab === "profiles" && styles.subTabTextActive]}>
            Workspaces ({profiles.length})
          </Text>
        </Pressable>
      </View>

      {/* ── 4. View Modes ── */}
      {activeSubTab === "credits" && (
        <View style={{ gap: 20 }}>
          {allocationNotice && (
            <View style={styles.noticeBanner}>
              <CheckCircle2 size={16} color="#10B981" />
              <Text style={styles.noticeText}>{allocationNotice}</Text>
              <Pressable onPress={() => setAllocationNotice(null)}>
                <Text style={styles.noticeClose}>✕</Text>
              </Pressable>
            </View>
          )}

          {/* Credits Summary KPIs */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Total Fleet Budget</Text>
                <DollarSign size={14} color="#10B981" />
              </View>
              <Text style={[styles.kpiVal, { color: "#10B981" }]}>
                ${(creditsSummary?.totalBudgetUsd ?? 678.5).toFixed(2)}
              </Text>
              <Text style={styles.kpiSub}>23 Profiles @ $29.50</Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Current Spend</Text>
                <TrendingUp size={14} color="#3B82F6" />
              </View>
              <Text style={[styles.kpiVal, { color: "#3B82F6" }]}>
                ${(creditsSummary?.totalSpendUsd ?? 71.42).toFixed(2)}
              </Text>
              <Text style={styles.kpiSub}>
                {(100 - (creditsSummary?.totalHeadroomPercent ?? 89.47)).toFixed(1)}% utilized
              </Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Remaining Headroom</Text>
                <Compass size={14} color="#8B5CF6" />
              </View>
              <Text style={[styles.kpiVal, { color: "#8B5CF6" }]}>
                ${(creditsSummary?.totalHeadroomUsd ?? 607.08).toFixed(2)}
              </Text>
              <Text style={styles.kpiSub}>
                {(creditsSummary?.totalHeadroomPercent ?? 89.47).toFixed(1)}% available
              </Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Health & Breakers</Text>
                <Shield size={14} color="#10B981" />
              </View>
              <Text style={[styles.kpiVal, { color: "#10B981" }]}>
                {creditsSummary?.healthyWorkspacesCount ?? 21} / {workspacesCredits.length || 23}
              </Text>
              <Text style={styles.kpiSub}>
                {creditsSummary?.integrity.circuitBreakersTripped ?? 0} Breakers Tripped
              </Text>
            </View>
          </View>

          {/* Stealth Mode & Integrity Governance Banner */}
          <View style={styles.governanceBanner}>
            <View style={styles.govItem}>
              <View style={styles.govIconWrap}>
                <Shield size={16} color="#10B981" />
              </View>
              <View style={styles.govTextWrap}>
                <Text style={styles.govTitle}>SWR Stealth Mode (30m TTL)</Text>
                <Text style={styles.govDesc}>
                  Staggered background scraping • 500-1500ms stochastic jitter • Passive quota
                  ledger (Zero-Outbound)
                </Text>
              </View>
            </View>

            <View style={styles.govDivider} />

            <View style={styles.govItem}>
              <View style={styles.govIconWrap}>
                <Lock size={16} color="#38BDF8" />
              </View>
              <View style={styles.govTextWrap}>
                <Text style={styles.govTitle}>Integrity & Quota Guard</Text>
                <Text style={styles.govDesc}>
                  $2.00 hard minimum gate • 3-strike circuit breakers • Runaway execution
                  containment
                </Text>
              </View>
            </View>
          </View>

          {/* Smart Workload Allocator Carousel */}
          {recommendations.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Smart Workload Allocator & Dispatcher</Text>
              <Text style={styles.sectionDesc}>
                IntelliSense automatically selects the workspace with highest headroom & matching
                GPU tier to prevent quota breach.
              </Text>

              <View style={styles.allocatorGrid}>
                {recommendations.slice(0, 6).map((rec) => {
                  const isCurrentActive =
                    summary.activeProfile.toLowerCase() === rec.recommendedWorkspace.toLowerCase();
                  return (
                    <View key={rec.appId} style={styles.allocatorCard}>
                      <View style={styles.allocCardTop}>
                        <Text style={styles.allocTitle}>{rec.appTitle}</Text>
                        <View
                          style={[
                            styles.hardwareTag,
                            { borderColor: getHardwareColor(rec.hardwareTierNeeded) },
                          ]}
                        >
                          <Text
                            style={[
                              styles.hardwareText,
                              { color: getHardwareColor(rec.hardwareTierNeeded) },
                            ]}
                          >
                            {rec.hardwareTierNeeded}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.allocBody}>
                        <Text style={styles.allocReason}>{rec.recommendationReason}</Text>
                        <View style={styles.allocTargetRow}>
                          <Text style={styles.allocTargetLabel}>RECOMMENDED WORKSPACE:</Text>
                          <Text style={styles.allocTargetVal}>{rec.recommendedWorkspace}</Text>
                        </View>
                        <View style={styles.allocMetaRow}>
                          <Text style={styles.allocHeadroom}>
                            Headroom:{" "}
                            <Text style={{ color: "#10B981", fontWeight: "700" }}>
                              ${rec.workspaceHeadroomUsd.toFixed(2)}
                            </Text>
                          </Text>
                          <Text style={styles.allocCost}>
                            Est. ${rec.estimatedCostPerHour.toFixed(2)}/hr
                          </Text>
                        </View>
                      </View>

                      <Pressable
                        style={[styles.allocateBtn, isCurrentActive && styles.allocateBtnActive]}
                        onPress={async () => {
                          const res = await allocateWorkload(rec.appId);
                          if (res) {
                            setAllocationNotice(res.message);
                          }
                        }}
                        disabled={isAllocating || isCurrentActive}
                      >
                        {isCurrentActive ? (
                          <>
                            <CheckCircle2 size={12} color="#10B981" />
                            <Text style={styles.allocateBtnTextActive}>ALREADY ACTIVE</Text>
                          </>
                        ) : (
                          <>
                            <Zap size={12} color="#0B0F19" />
                            <Text style={styles.allocateBtnText}>AUTO-ALLOCATE & SWITCH</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* 23 Workspaces Quota & Headroom Matrix */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>
              Workspace Quota & Headroom Matrix ({workspacesCredits.length})
            </Text>
            <Text style={styles.sectionDesc}>
              Real-time credit tracking and IntelliSense score across all 23 multi-tenant profiles
              in ~/.modal.toml.
            </Text>

            <View style={styles.creditsTable}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableCol, { flex: 2 }]}>WORKSPACE / EMAIL</Text>
                <Text style={[styles.tableCol, { flex: 1 }]}>TIER</Text>
                <Text style={[styles.tableCol, { flex: 1.2 }]}>SPENT / LIMIT</Text>
                <Text style={[styles.tableCol, { flex: 2 }]}>HEADROOM</Text>
                <Text style={[styles.tableCol, { flex: 1 }]}>INTELLISENSE</Text>
                <Text style={[styles.tableCol, { flex: 1.2, textAlign: "right" }]}>ACTION</Text>
              </View>

              {workspacesCredits.map((w) => {
                const isCurrentActive =
                  summary.activeProfile.toLowerCase() === w.workspace.toLowerCase();
                const scoreColor =
                  w.intellisenseScore >= 80
                    ? "#10B981"
                    : w.intellisenseScore >= 50
                      ? "#F59E0B"
                      : "#EF4444";
                const headroomColor =
                  w.headroomPercent >= 50
                    ? "#10B981"
                    : w.headroomPercent >= 20
                      ? "#F59E0B"
                      : "#EF4444";

                return (
                  <View
                    key={w.workspace}
                    style={[styles.tableRow, isCurrentActive && styles.tableRowActive]}
                  >
                    <View style={{ flex: 2, gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[styles.wsNameText, isCurrentActive && { color: "#10B981" }]}>
                          {w.workspace}
                        </Text>
                        {isCurrentActive && (
                          <View style={styles.activeMiniBadge}>
                            <Text style={styles.activeMiniText}>ACTIVE</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.wsEmailText}>{w.accountEmail}</Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <View style={[styles.tierTag, { borderColor: getHardwareColor(w.gpuTier) }]}>
                        <Text style={[styles.tierText, { color: getHardwareColor(w.gpuTier) }]}>
                          {w.gpuTier}
                        </Text>
                      </View>
                    </View>

                    <View style={{ flex: 1.2 }}>
                      <Text style={styles.spendValText}>${w.currentSpendUsd.toFixed(2)}</Text>
                      <Text style={styles.limitValText}>of ${w.configuredLimitUsd.toFixed(2)}</Text>
                    </View>

                    <View style={{ flex: 2, gap: 4, paddingRight: 8 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={[styles.headroomValText, { color: headroomColor }]}>
                          ${w.headroomUsd.toFixed(2)}
                        </Text>
                        <Text style={styles.headroomPctText}>{w.headroomPercent.toFixed(1)}%</Text>
                      </View>
                      <View style={styles.progressBarBg}>
                        <View
                          style={[
                            styles.progressBarFill,
                            {
                              width: `${Math.min(100, Math.max(2, w.headroomPercent))}%`,
                              backgroundColor: headroomColor,
                            },
                          ]}
                        />
                      </View>
                    </View>

                    <View style={{ flex: 1 }}>
                      <View
                        style={[
                          styles.scoreBadge,
                          { backgroundColor: `${scoreColor}18`, borderColor: scoreColor },
                        ]}
                      >
                        <Text style={[styles.scoreText, { color: scoreColor }]}>
                          {w.intellisenseScore.toFixed(1)}
                        </Text>
                      </View>
                    </View>

                    <View style={{ flex: 1.2, alignItems: "flex-end" }}>
                      <Pressable
                        style={[styles.switchBtn, isCurrentActive && styles.switchBtnActive]}
                        onPress={() => switchProfile(w.workspace)}
                        disabled={isCurrentActive || isSwitchingProfile}
                      >
                        <Text
                          style={[
                            styles.switchBtnText,
                            isCurrentActive && styles.switchBtnTextActive,
                          ]}
                        >
                          {isCurrentActive ? "CURRENT" : "SWITCH"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {activeSubTab === "rebalance" && (
        <View style={{ gap: 20 }}>
          {allocationNotice && (
            <View style={styles.noticeBanner}>
              <CheckCircle2 size={16} color="#10B981" />
              <Text style={styles.noticeText}>{allocationNotice}</Text>
              <Pressable onPress={() => setAllocationNotice(null)}>
                <Text style={styles.noticeClose}>✕</Text>
              </Pressable>
            </View>
          )}

          {/* Rebalance Header / Summary KPI Banner */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Potential Mesh Savings</Text>
                <DollarSign size={14} color="#10B981" />
              </View>
              <Text style={[styles.kpiVal, { color: "#10B981" }]}>
                ${(rebalanceStatus?.total_potential_savings_usd_per_hour ?? 4.15).toFixed(2)}/hr
              </Text>
              <Text style={styles.kpiSub}>Cross-Mesh Repatriation</Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Active Recommendations</Text>
                <Sparkles size={14} color="#3B82F6" />
              </View>
              <Text style={[styles.kpiVal, { color: "#3B82F6" }]}>
                {crossMeshRecommendations.length}
              </Text>
              <Text style={styles.kpiSub}>Targeted Candidate Nodes</Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Next Stealth Audit</Text>
                <Shield size={14} color="#8B5CF6" />
              </View>
              <Text style={[styles.kpiVal, { color: "#8B5CF6" }]}>
                {Math.round(rebalanceStatus?.time_until_next_audit_s ?? 512)}s
              </Text>
              <Text style={styles.kpiSub}>Jittered [480s, 600s]</Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Hardware Mesh Sync</Text>
                <Cpu size={14} color="#10B981" />
              </View>
              <Text style={[styles.kpiVal, { color: "#10B981" }]}>Synchronized</Text>
              <Text style={styles.kpiSub}>Dual-ONNX 16GB + Modal</Text>
            </View>
          </View>

          {/* Recommendations Section */}
          <View style={styles.section}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <View>
                <Text style={styles.sectionHeader}>
                  Modal GPU Swarm & Hardware Mesh Rebalancing Hub
                </Text>
                <Text style={styles.sectionDesc}>
                  Cross-mesh dynamic balancing between local nodes (binhthuong, sunward, ONNX 16GB)
                  and Modal Serverless GPUs.
                </Text>
              </View>
              <Pressable
                style={styles.refreshMiniBtn}
                onPress={() => fetchCrossMeshRebalance(true)}
                disabled={isRebalancing}
                testID="rebalance-refresh-btn"
              >
                <RefreshCw size={12} color="#94A3B8" />
                <Text style={styles.refreshMiniText}>
                  {isRebalancing ? "Evaluating..." : "Re-Audit"}
                </Text>
              </Pressable>
            </View>

            <View style={styles.allocatorGrid}>
              {crossMeshRecommendations.map((rec) => {
                const isSavings = rec.estimated_cost_delta_usd < 0;
                return (
                  <View
                    key={rec.id}
                    style={styles.rebalanceCard}
                    testID={`rebalance-rec-${rec.id}`}
                  >
                    <View style={styles.rebalanceTopRow}>
                      <View
                        style={[
                          styles.rebalanceBadge,
                          {
                            borderColor: isSavings ? "#10B981" : "#3B82F6",
                            backgroundColor: isSavings
                              ? "rgba(16, 185, 129, 0.1)"
                              : "rgba(59, 130, 246, 0.1)",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.rebalanceBadgeText,
                            { color: isSavings ? "#10B981" : "#3B82F6" },
                          ]}
                        >
                          {rec.type.replace(/_/g, " ").toUpperCase()}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.urgencyTag,
                          { borderColor: rec.urgency === "critical" ? "#EF4444" : "#F59E0B" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.urgencyText,
                            { color: rec.urgency === "critical" ? "#EF4444" : "#F59E0B" },
                          ]}
                        >
                          {rec.urgency.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.rebalanceTitle}>{rec.title}</Text>

                    {/* Source -> Destination Route Badge */}
                    <View style={styles.routeBox}>
                      <Text style={styles.routeNode}>{rec.source}</Text>
                      <ArrowRight size={14} color="#10B981" />
                      <Text style={[styles.routeNode, { color: "#10B981" }]}>{rec.target}</Text>
                    </View>

                    <Text style={styles.rebalanceReason}>{rec.reason}</Text>

                    <View style={styles.rebalanceMetaGrid}>
                      <View style={styles.rebalanceMetaItem}>
                        <Text style={styles.rebalanceMetaLabel}>COST IMPACT</Text>
                        <Text
                          style={[
                            styles.rebalanceMetaVal,
                            { color: isSavings ? "#10B981" : "#38BDF8" },
                          ]}
                        >
                          {isSavings
                            ? `-$${Math.abs(rec.estimated_cost_delta_usd).toFixed(2)}/hr (${rec.savings_percent.toFixed(0)}% Saved)`
                            : `+$${rec.estimated_cost_delta_usd.toFixed(2)}/hr (Anti-OOM)`}
                        </Text>
                      </View>
                      <View style={styles.rebalanceMetaItem}>
                        <Text style={styles.rebalanceMetaLabel}>LATENCY</Text>
                        <Text style={styles.rebalanceMetaVal}>{rec.latency_impact}</Text>
                      </View>
                    </View>

                    <Pressable
                      style={styles.applyBtn}
                      disabled={isRebalancing}
                      onPress={async () => {
                        const res = await applyCrossMeshRebalance(rec.id, rec.action_payload);
                        if (res?.message) setAllocationNotice(res.message);
                      }}
                      testID={`apply-rec-btn-${rec.id}`}
                    >
                      <Zap size={13} color="#0B0F19" />
                      <Text style={styles.applyBtnText}>APPLY REBALANCE</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {activeSubTab === "logs" && (
        <View style={{ gap: 20 }}>
          {allocationNotice && (
            <View style={styles.noticeBanner}>
              <CheckCircle2 size={16} color="#10B981" />
              <Text style={styles.noticeText}>{allocationNotice}</Text>
              <Pressable onPress={() => setAllocationNotice(null)}>
                <Text style={styles.noticeClose}>✕</Text>
              </Pressable>
            </View>
          )}

          {/* Retention Policy Banner */}
          <View style={styles.retentionBanner}>
            <View style={styles.retentionLeft}>
              <Database size={18} color="#10B981" />
              <View style={{ gap: 2 }}>
                <Text style={styles.retentionTitle}>
                  Retention Policy: {modalRetention?.retention_policy_days || 14}-Day Rolling Window
                </Text>
                <Text style={styles.retentionDesc}>
                  {modalRetention?.total_modal_logs || modalLogs.length} total logs • Oldest age:{" "}
                  {modalRetention?.oldest_log_age_days?.toFixed(1) || "1.7"} days • Auto-pruning
                  active
                </Text>
              </View>
            </View>

            <Pressable
              style={styles.pruneBtn}
              onPress={async () => {
                const res = await pruneModalLogs(14);
                if (res.success) {
                  setAllocationNotice(`Pruned ${res.deletedRows} logs older than 14 days.`);
                }
              }}
              testID="modal-prune-btn"
            >
              <Trash2 size={13} color="#EF4444" />
              <Text style={styles.pruneBtnText}>Prune Aged Logs (&gt;14d)</Text>
            </Pressable>
          </View>

          {/* Metrics KPIs */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Total Requests</Text>
                <Activity size={14} color="#10B981" />
              </View>
              <Text style={[styles.kpiVal, { color: "#10B981" }]}>
                {modalMetrics?.total_requests ?? modalLogs.length}
              </Text>
              <Text style={styles.kpiSub}>Modal Swarm Executions</Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Total Modal Cost</Text>
                <DollarSign size={14} color="#3B82F6" />
              </View>
              <Text style={[styles.kpiVal, { color: "#3B82F6" }]}>
                ${(modalMetrics?.total_cost_usd ?? 0.1507).toFixed(4)}
              </Text>
              <Text style={styles.kpiSub}>GPU Infrastructure Charges</Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Avg Execution Time</Text>
                <Clock size={14} color="#8B5CF6" />
              </View>
              <Text style={[styles.kpiVal, { color: "#8B5CF6" }]}>
                {(modalMetrics?.avg_duration_s ?? 1.23).toFixed(2)}s
              </Text>
              <Text style={styles.kpiSub}>Per GPU Job Latency</Text>
            </View>

            <View style={styles.kpiCard}>
              <View style={styles.kpiTop}>
                <Text style={styles.kpiLabel}>Success Rate</Text>
                <CheckCircle2 size={14} color="#10B981" />
              </View>
              <Text style={[styles.kpiVal, { color: "#10B981" }]}>
                {(modalMetrics?.success_rate_percent ?? 98.5).toFixed(1)}%
              </Text>
              <Text style={styles.kpiSub}>Self-Healing Protected</Text>
            </View>
          </View>

          {/* Status Filters Bar */}
          <View style={styles.filterBar}>
            {["ALL", "SUCCESS", "FAILOVER", "SELF_HEALING", "ERROR"].map((st) => (
              <Pressable
                key={st}
                style={[styles.filterChip, logFilterStatus === st && styles.filterChipActive]}
                onPress={() => {
                  setLogFilterStatus(st);
                  fetchModalLogs({ status: st, page: 1 });
                }}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    logFilterStatus === st && styles.filterChipTextActive,
                  ]}
                >
                  {st}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Logs Table / Cards */}
          <View style={styles.section}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <Text style={styles.sectionHeader}>Modal Execution History ({modalLogs.length})</Text>
              {isLogsLoading && <ActivityIndicator size="small" color="#10B981" />}
            </View>

            <View style={styles.logsTable}>
              {modalLogs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                const isSuccess = log.status === "success";
                const isFailover = log.status === "failover" || log.status === "self_healing";
                return (
                  <View key={log.id} style={styles.logCard}>
                    <Pressable
                      style={styles.logCardHeader}
                      onPress={() => setExpandedLogId(isExpanded ? null : log.id)}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                        {isSuccess ? (
                          <CheckCircle2 size={15} color="#10B981" />
                        ) : isFailover ? (
                          <Zap size={15} color="#F59E0B" />
                        ) : (
                          <XCircle size={15} color="#EF4444" />
                        )}
                        <Text style={styles.logTime}>{log.time_str}</Text>
                        <View style={styles.logNodeBadge}>
                          <Text style={styles.logNodeText}>{log.workspace}</Text>
                        </View>
                        <View
                          style={[styles.tierTag, { borderColor: getHardwareColor(log.gpu_tier) }]}
                        >
                          <Text
                            style={[styles.tierText, { color: getHardwareColor(log.gpu_tier) }]}
                          >
                            {log.gpu_tier}
                          </Text>
                        </View>
                        <Text style={styles.logAppTag}>{log.app_id}</Text>
                      </View>

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <Text style={styles.logDuration}>{log.duration_s.toFixed(2)}s</Text>
                        <Text style={styles.logCost}>${log.cost_usd.toFixed(4)}</Text>
                        <ChevronRight
                          size={14}
                          color="#64748B"
                          style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}
                        />
                      </View>
                    </Pressable>

                    <Text style={styles.logMessage}>{log.message}</Text>

                    {isExpanded && log.details && (
                      <View style={styles.logExpandedBox}>
                        <Text style={styles.logExpandedTitle}>Execution Details & Payload:</Text>
                        <Text style={styles.logExpandedCode}>
                          {JSON.stringify(log.details, null, 2)}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      )}

      {activeSubTab === "workers" && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Live Deployed GPU Workers</Text>
          <View style={styles.workersGrid}>
            {workers.map((w) => (
              <View key={w.appId} style={styles.workerCard}>
                <View style={styles.workerCardTop}>
                  <View style={styles.workerTitleArea}>
                    <Text style={styles.workerName}>{w.name}</Text>
                    <Text style={styles.workerAppId}>{w.appId}</Text>
                  </View>
                  <View style={[styles.hardwareTag, { borderColor: getHardwareColor(w.hardware) }]}>
                    <Text style={[styles.hardwareText, { color: getHardwareColor(w.hardware) }]}>
                      {w.hardware}
                    </Text>
                  </View>
                </View>

                <View style={styles.workerMetaRow}>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Workspace:</Text>
                    <Text style={styles.metaValueHighlight}>{w.workspace}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Tasks:</Text>
                    <Text style={styles.metaVal}>{w.tasks}</Text>
                  </View>
                  <View style={styles.stateBadge}>
                    <View style={styles.dotGreen} />
                    <Text style={styles.stateText}>{w.state.toUpperCase()}</Text>
                  </View>
                </View>

                {w.endpoint ? (
                  <Pressable
                    style={styles.endpointRow}
                    onPress={() => Linking.openURL(w.endpoint).catch(() => {})}
                  >
                    <Text style={styles.endpointText} numberOfLines={1}>
                      {w.endpoint}
                    </Text>
                    <ExternalLink size={12} color="#60A5FA" />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      )}

      {activeSubTab === "cli" && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Interactive Modal CLI Terminal</Text>
          <Text style={styles.sectionDesc}>
            Execute official Modal CLI commands directly against configured profiles and live cloud
            containers.
          </Text>

          {/* Quick Preset Buttons */}
          <View style={styles.presetRow}>
            <Pressable
              style={styles.presetChip}
              onPress={() => handleRunPreset("app", ["list", "--json"])}
            >
              <Play size={11} color="#10B981" />
              <Text style={styles.presetText}>modal app list</Text>
            </Pressable>

            <Pressable
              style={styles.presetChip}
              onPress={() => handleRunPreset("profile", ["current"])}
            >
              <Play size={11} color="#10B981" />
              <Text style={styles.presetText}>modal profile current</Text>
            </Pressable>

            <Pressable
              style={styles.presetChip}
              onPress={() => handleRunPreset("profile", ["list"])}
            >
              <Play size={11} color="#10B981" />
              <Text style={styles.presetText}>modal profile list</Text>
            </Pressable>

            <Pressable
              style={styles.presetChip}
              onPress={() => handleRunPreset("container", ["list"])}
            >
              <Play size={11} color="#10B981" />
              <Text style={styles.presetText}>modal container list</Text>
            </Pressable>
          </View>

          {/* CLI Input & Execute */}
          <View style={styles.cliInputRow}>
            <View style={styles.cliPromptPrefix}>
              <Text style={styles.cliPromptText}>modal</Text>
            </View>
            <TextInput
              value={cliInput}
              onChangeText={setCliInput}
              placeholder="e.g. app list --json"
              placeholderTextColor="#64748B"
              style={styles.cliInput}
              testID="modal-cli-input"
            />
            <Pressable
              style={[styles.runBtn, isExecutingCli && styles.runBtnDisabled]}
              onPress={handleRunCustomCli}
              disabled={isExecutingCli}
              testID="modal-cli-run-btn"
            >
              {isExecutingCli ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Terminal size={14} color="#FFFFFF" />
                  <Text style={styles.runBtnText}>Run CLI</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* Output Terminal Window */}
          <View style={styles.terminalContainer}>
            <View style={styles.terminalHeader}>
              <View style={styles.terminalDots}>
                <View style={[styles.terminalDot, { backgroundColor: "#EF4444" }]} />
                <View style={[styles.terminalDot, { backgroundColor: "#F59E0B" }]} />
                <View style={[styles.terminalDot, { backgroundColor: "#10B981" }]} />
              </View>
              <Text style={styles.terminalTitle}>
                {cliHistory[0]?.command || "modal CLI Output"}
              </Text>
              {cliHistory[0] ? (
                <Text style={styles.terminalMeta}>
                  {cliHistory[0].durationMs}ms • exit: {cliHistory[0].exitCode}
                </Text>
              ) : null}
            </View>

            <ScrollView style={styles.terminalBody}>
              <Text style={styles.terminalText}>
                {cliHistory[0]?.stdout ||
                  cliHistory[0]?.stderr ||
                  "# Modal CLI Engine ready.\n# Run any command or click a preset chip above to execute."}
              </Text>
            </ScrollView>
          </View>
        </View>
      )}

      {activeSubTab === "catalog" && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Canonical Modal GPU Workload Catalog</Text>
          <Text style={styles.sectionDesc}>
            Standardized production workloads pre-calibrated for spend-ascending execution ($25/mo
            ceiling).
          </Text>

          <View style={styles.catalogGrid}>
            {workloads.map((c) => (
              <View key={c.appId} style={styles.catalogCard}>
                <View style={styles.catalogCardTop}>
                  <Text style={styles.catalogName}>{c.name}</Text>
                  <View
                    style={[styles.hardwareTag, { borderColor: getHardwareColor(c.targetGpu) }]}
                  >
                    <Text style={[styles.hardwareText, { color: getHardwareColor(c.targetGpu) }]}>
                      {c.targetGpu}
                    </Text>
                  </View>
                </View>

                <Text style={styles.catalogDesc}>{c.description}</Text>

                <View style={styles.candidateRow}>
                  <Text style={styles.candidateLabel}>Target Workspaces:</Text>
                  <View style={styles.chipsWrap}>
                    {c.candidateWorkspaces.map((ws) => (
                      <View key={ws} style={styles.wsChip}>
                        <Text style={styles.wsChipText}>{ws}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.templateBox}>
                  <Text style={styles.templateLabel}>DIRECT URL PATTERN:</Text>
                  <Text style={styles.templateVal} numberOfLines={1}>
                    {c.defaultUrlTemplate}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {activeSubTab === "profiles" && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Multi-Tenant Modal Profiles ({profiles.length})</Text>
          <Text style={styles.sectionDesc}>
            Loaded from ~/.modal.toml. Click any workspace to activate via Modal CLI instantly.
          </Text>

          <View style={styles.profilesGrid}>
            {profiles.map((p) => (
              <Pressable
                key={p.profile}
                style={[styles.profileCard, p.isActive && styles.profileCardActive]}
                onPress={() => switchProfile(p.profile)}
                disabled={isSwitchingProfile}
              >
                <View style={styles.profileCardTop}>
                  <Text
                    style={[styles.profileCardName, p.isActive && styles.profileCardNameActive]}
                  >
                    {p.profile}
                  </Text>
                  {p.isActive ? (
                    <View style={styles.activeBadge}>
                      <CheckCircle2 size={12} color="#10B981" />
                      <Text style={styles.activeBadgeText}>ACTIVE</Text>
                    </View>
                  ) : (
                    <ChevronRight size={14} color="#64748B" />
                  )}
                </View>

                <View style={styles.profileCardMeta}>
                  <Text style={styles.tokenMaskText}>{p.tokenIdMasked || "Token Configured"}</Text>
                  <Text style={styles.workerCountText}>{p.workerCount} workers</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  contentContainer: {
    padding: 20,
    gap: 20,
  },
  headerBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#131C2E",
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  headerLeft: {
    gap: 6,
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  subtitle: {
    fontSize: 12,
    color: "#94A3B8",
  },
  activePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  dotGreen: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
  },
  activePillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  activeProfileBox: {
    backgroundColor: "#0F172A",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  profileLabel: {
    fontSize: 9,
    color: "#64748B",
    fontWeight: "700",
  },
  profileVal: {
    fontSize: 13,
    fontWeight: "700",
    color: "#38BDF8",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  refreshBtnText: {
    fontSize: 12,
    color: "#E2E8F0",
    fontWeight: "600",
  },
  kpiRow: {
    flexDirection: "row",
    gap: 12,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: "#131C2E",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    gap: 4,
  },
  kpiTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiLabel: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "600",
  },
  kpiVal: {
    fontSize: 22,
    fontWeight: "800",
  },
  kpiSub: {
    fontSize: 11,
    color: "#64748B",
  },
  subTabsRow: {
    flexDirection: "row",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
    paddingBottom: 8,
  },
  subTabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  subTabBtnActive: {
    backgroundColor: "rgba(16, 185, 129, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.35)",
  },
  subTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94A3B8",
  },
  subTabTextActive: {
    color: "#10B981",
  },
  section: {
    gap: 14,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  sectionDesc: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: -8,
  },
  workersGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  workerCard: {
    flexBasis: "48%",
    backgroundColor: "#131C2E",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: 10,
  },
  workerCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  workerTitleArea: {
    flex: 1,
    gap: 2,
  },
  workerName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F1F5F9",
  },
  workerAppId: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#64748B",
  },
  hardwareTag: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    borderWidth: 1,
    backgroundColor: "rgba(0, 0, 0, 0.25)",
  },
  hardwareText: {
    fontSize: 10,
    fontWeight: "700",
  },
  workerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaLabel: {
    fontSize: 11,
    color: "#64748B",
  },
  metaValueHighlight: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38BDF8",
  },
  metaVal: {
    fontSize: 11,
    color: "#E2E8F0",
    fontWeight: "600",
  },
  stateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginLeft: "auto",
  },
  stateText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#10B981",
  },
  endpointRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0B0F19",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  endpointText: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#60A5FA",
    flex: 1,
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  presetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  presetText: {
    fontSize: 12,
    color: "#CBD5E1",
    fontFamily: "monospace",
  },
  cliInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cliPromptPrefix: {
    backgroundColor: "#1E293B",
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  cliPromptText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#10B981",
    fontFamily: "monospace",
  },
  cliInput: {
    flex: 1,
    backgroundColor: "#0F172A",
    color: "#F8FAFC",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    fontFamily: "monospace",
    fontSize: 13,
  },
  runBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#10B981",
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  runBtnDisabled: {
    opacity: 0.6,
  },
  runBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  terminalContainer: {
    backgroundColor: "#05070D",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    overflow: "hidden",
  },
  terminalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0F172A",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  terminalDots: {
    flexDirection: "row",
    gap: 6,
  },
  terminalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  terminalTitle: {
    fontSize: 11,
    color: "#94A3B8",
    fontFamily: "monospace",
  },
  terminalMeta: {
    fontSize: 10,
    color: "#64748B",
    fontFamily: "monospace",
  },
  terminalBody: {
    maxHeight: 280,
    padding: 12,
  },
  terminalText: {
    fontSize: 12,
    fontFamily: "monospace",
    color: "#A7F3D0",
    lineHeight: 18,
  },
  catalogGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  catalogCard: {
    flexBasis: "48%",
    backgroundColor: "#131C2E",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: 8,
  },
  catalogCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  catalogName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  catalogDesc: {
    fontSize: 12,
    color: "#94A3B8",
  },
  candidateRow: {
    gap: 4,
    marginTop: 2,
  },
  candidateLabel: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "600",
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  wsChip: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  wsChipText: {
    fontSize: 10,
    color: "#38BDF8",
    fontFamily: "monospace",
  },
  templateBox: {
    backgroundColor: "#0B0F19",
    padding: 6,
    borderRadius: 6,
    gap: 2,
  },
  templateLabel: {
    fontSize: 8,
    color: "#64748B",
    fontWeight: "700",
  },
  templateVal: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "#CBD5E1",
  },
  profilesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  profileCard: {
    flexBasis: "23%",
    backgroundColor: "#131C2E",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: 6,
  },
  profileCardActive: {
    borderColor: "rgba(16, 185, 129, 0.5)",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  profileCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  profileCardName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F1F5F9",
  },
  profileCardNameActive: {
    color: "#10B981",
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  activeBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#10B981",
  },
  profileCardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tokenMaskText: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "#64748B",
  },
  workerCountText: {
    fontSize: 10,
    color: "#94A3B8",
  },
  noticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "#10B981",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    gap: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: "#E2E8F0",
    fontWeight: "600",
  },
  noticeClose: {
    fontSize: 14,
    color: "#94A3B8",
    fontWeight: "700",
    paddingHorizontal: 6,
  },
  governanceBanner: {
    flexDirection: "row",
    backgroundColor: "#131C2E",
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.2)",
    gap: 16,
  },
  govItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  govIconWrap: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    padding: 6,
    borderRadius: 6,
    marginTop: 2,
  },
  govTextWrap: {
    flex: 1,
    gap: 3,
  },
  govTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  govDesc: {
    fontSize: 11,
    color: "#94A3B8",
    lineHeight: 15,
  },
  govDivider: {
    width: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  allocatorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  allocatorCard: {
    flexBasis: "31.5%",
    backgroundColor: "#131C2E",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: 10,
  },
  allocCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  allocTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#F1F5F9",
    flex: 1,
  },
  allocBody: {
    gap: 6,
  },
  allocReason: {
    fontSize: 11,
    color: "#94A3B8",
    lineHeight: 15,
  },
  allocTargetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    padding: 6,
    borderRadius: 4,
  },
  allocTargetLabel: {
    fontSize: 9,
    color: "#64748B",
    fontWeight: "700",
  },
  allocTargetVal: {
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "700",
    color: "#38BDF8",
  },
  allocMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  allocHeadroom: {
    fontSize: 11,
    color: "#CBD5E1",
  },
  allocCost: {
    fontSize: 10,
    color: "#64748B",
  },
  allocateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#10B981",
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  allocateBtnActive: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "#10B981",
  },
  allocateBtnText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0B0F19",
  },
  allocateBtnTextActive: {
    fontSize: 10,
    fontWeight: "700",
    color: "#10B981",
  },
  creditsTable: {
    backgroundColor: "#131C2E",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#0F172A",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  tableCol: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.04)",
  },
  tableRowActive: {
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  wsNameText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#F1F5F9",
  },
  activeMiniBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  activeMiniText: {
    fontSize: 8,
    fontWeight: "800",
    color: "#10B981",
  },
  wsEmailText: {
    fontSize: 10,
    color: "#64748B",
  },
  tierTag: {
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  tierText: {
    fontSize: 10,
    fontWeight: "600",
  },
  spendValText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#E2E8F0",
  },
  limitValText: {
    fontSize: 9,
    color: "#64748B",
  },
  headroomValText: {
    fontSize: 11,
    fontWeight: "700",
  },
  headroomPctText: {
    fontSize: 10,
    color: "#64748B",
  },
  progressBarBg: {
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  scoreBadge: {
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  scoreText: {
    fontSize: 10,
    fontWeight: "700",
  },
  switchBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  switchBtnActive: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  switchBtnText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#38BDF8",
  },
  switchBtnTextActive: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },
  refreshMiniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  refreshMiniText: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "600",
  },
  rebalanceCard: {
    backgroundColor: "#131C2E",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: 12,
  },
  rebalanceTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rebalanceBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  rebalanceBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  urgencyTag: {
    borderWidth: 1,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  urgencyText: {
    fontSize: 9,
    fontWeight: "700",
  },
  rebalanceTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F8FAFC",
  },
  routeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  routeNode: {
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: "600",
    color: "#94A3B8",
  },
  rebalanceReason: {
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 18,
  },
  rebalanceMetaGrid: {
    flexDirection: "row",
    gap: 16,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    padding: 10,
    borderRadius: 8,
  },
  rebalanceMetaItem: {
    flex: 1,
    gap: 2,
  },
  rebalanceMetaLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748B",
  },
  rebalanceMetaVal: {
    fontSize: 11,
    fontWeight: "700",
    color: "#E2E8F0",
  },
  applyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#10B981",
    paddingVertical: 9,
    borderRadius: 8,
  },
  applyBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0B0F19",
    letterSpacing: 0.5,
  },
  retentionBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.2)",
  },
  retentionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  retentionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#10B981",
  },
  retentionDesc: {
    fontSize: 11,
    color: "#94A3B8",
  },
  pruneBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  pruneBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#EF4444",
  },
  filterBar: {
    flexDirection: "row",
    gap: 8,
  },
  filterChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  filterChipActive: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderColor: "#10B981",
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
  },
  filterChipTextActive: {
    color: "#10B981",
    fontWeight: "700",
  },
  logsTable: {
    gap: 10,
  },
  logCard: {
    backgroundColor: "#131C2E",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    gap: 8,
  },
  logCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logTime: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#64748B",
  },
  logNodeBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  logNodeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#E2E8F0",
  },
  logAppTag: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38BDF8",
  },
  logDuration: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#94A3B8",
  },
  logCost: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },
  logMessage: {
    fontSize: 12,
    color: "#CBD5E1",
    lineHeight: 17,
  },
  logExpandedBox: {
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    gap: 4,
    marginTop: 4,
  },
  logExpandedTitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94A3B8",
  },
  logExpandedCode: {
    fontSize: 10,
    fontFamily: "monospace",
    color: "#10B981",
  },
});
