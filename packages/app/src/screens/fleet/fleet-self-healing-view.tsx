import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  GitPullRequest,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react-native";
import type { CircuitBreakerUIStatus, IncidentRecord } from "./types";

export function FleetSelfHealingView() {
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [cbStatus, setCbStatus] = useState<CircuitBreakerUIStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [healingId, setHealingId] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [autonomouslyHealingId, setAutonomouslyHealingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [incRes, statRes] = await Promise.all([
        fetch("/api/fleet/self-healing/incidents"),
        fetch("/api/fleet/self-healing/status"),
      ]);
      if (incRes.ok) {
        const incJson = await incRes.json();
        setIncidents(incJson.incidents || []);
      }
      if (statRes.ok) {
        const statJson = await statRes.json();
        setCbStatus(statJson.status || null);
      }
    } catch {
      // offline or server starting
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const timer = setInterval(() => void fetchData(), 10000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const handleResetCircuitBreaker = useCallback(
    async (key?: string) => {
      try {
        const res = await fetch("/api/fleet/self-healing/circuit-breaker/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        if (res.ok) {
          setFeedbackMsg("Circuit breaker reset successfully.");
          await fetchData();
        }
      } catch {
        setFeedbackMsg("Failed to reset circuit breaker.");
      }
    },
    [fetchData],
  );

  const handleHealIncident = useCallback(
    async (id: string) => {
      setHealingId(id);
      try {
        const res = await fetch(`/api/fleet/self-healing/incidents/${id}/heal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pushToRemote: false }),
        });
        if (res.ok) {
          const json = await res.json();
          setFeedbackMsg(`Branch created: ${json.result?.branchName}`);
          await fetchData();
        }
      } catch {
        setFeedbackMsg("Failed to trigger autonomous heal.");
      } finally {
        setHealingId(null);
      }
    },
    [fetchData],
  );

  const handlePushBranch = useCallback(
    async (id: string) => {
      setPushingId(id);
      try {
        const res = await fetch(`/api/fleet/self-healing/incidents/${id}/heal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pushToRemote: true }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.result?.pushed) {
            setFeedbackMsg(`Branch pushed to remote git: ${json.result?.branchName}`);
          } else {
            setFeedbackMsg(`Push error: ${json.result?.error || "Offline / no remote"}`);
          }
          await fetchData();
        }
      } catch {
        setFeedbackMsg("Failed to push branch.");
      } finally {
        setPushingId(null);
      }
    },
    [fetchData],
  );

  const handleAutonomousHeal = useCallback(
    async (id: string) => {
      setAutonomouslyHealingId(id);
      try {
        const res = await fetch(`/api/fleet/self-healing/incidents/${id}/autonomous`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoMerge: true, testCommand: "npm run test:unit" }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.result?.merged) {
            setFeedbackMsg(
              `🤖 Autonomous Heal: 100% tests passed! Auto-merged into ${json.result?.targetBranch} (${json.result?.mergeCommitSha || ""})`,
            );
          } else if (json.result?.reverted) {
            setFeedbackMsg(
              `⚠️ Autonomous Heal: Tests failed! Instant auto-revert executed to ${json.result?.originalSha}. Workspace restored.`,
            );
          } else {
            setFeedbackMsg(`Autonomous Heal completed: ${json.result?.status || "OK"}`);
          }
          await fetchData();
        } else {
          setFeedbackMsg("Autonomous heal failed.");
        }
      } catch {
        setFeedbackMsg("Failed to invoke autonomous heal.");
      } finally {
        setAutonomouslyHealingId(null);
      }
    },
    [fetchData],
  );

  const handleSimulateDeadlock = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/self-healing/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "hook",
          hookName: "jsonhook__db-target-guard_PreToolUse_0_0",
          exitCode: 2,
          stderr:
            "/usr/bin/python3: can't open file 'hooks/scripts/check_db_target.py': [Errno 2] No such file or directory",
          command: "python3 hooks/scripts/check_db_target.py",
        }),
      });
      if (res.ok) {
        setFeedbackMsg("Simulated Hook Deadlock incident reported.");
        await fetchData();
      }
    } catch {
      setFeedbackMsg("Simulation failed.");
    }
  }, [fetchData]);

  const isTripped = cbStatus?.isTripped ?? false;
  const isolatedCount = cbStatus?.isolatedHooks?.length ?? 0;

  return (
    <View style={styles.container}>
      {/* HUD Banner */}
      <View
        style={[styles.hudBanner, isTripped ? styles.hudBannerTripped : styles.hudBannerHealthy]}
      >
        <View style={styles.hudIconCol}>
          {isTripped ? (
            <ShieldAlert size={28} color={styles.iconWarning.color} />
          ) : (
            <ShieldCheck size={28} color={styles.iconAccent.color} />
          )}
        </View>

        <View style={styles.hudBody}>
          <Text style={styles.hudTitle}>
            {isTripped
              ? `CIRCUIT BREAKER ENGAGED — ${isolatedCount} HOOK(S) ISOLATED (FAIL-SAFE)`
              : "CIRCUIT BREAKER STANDBY — ALL AGENT HOOKS & TOOLS OPERATIONAL"}
          </Text>
          <Text style={styles.hudDesc}>
            {isTripped
              ? "Repeated hook runtime crashes detected. Broken hooks are temporarily bypassed in safe mode to prevent agent paralysis."
              : "Active guard watching agent loops, hook crashes (exit status 2), and deadlocks. Automatic fix branching enabled."}
          </Text>

          {cbStatus?.isolatedHooks && cbStatus.isolatedHooks.length > 0 ? (
            <View style={styles.isolatedRow}>
              <Text style={styles.isolatedLabel}>Isolated Hooks:</Text>
              {cbStatus.isolatedHooks.map((h) => (
                <View key={h} style={styles.isolatedPill}>
                  <Text style={styles.isolatedPillText}>{h}</Text>
                  <Pressable onPress={() => void handleResetCircuitBreaker(h)}>
                    <RotateCcw size={12} color={styles.iconWarning.color} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.hudActions}>
          <Pressable
            onPress={() => void handleResetCircuitBreaker()}
            style={styles.actionBtnSecondary}
          >
            <RotateCcw size={13} color={styles.iconMuted.color} />
            <Text style={styles.actionBtnText}>Reset Guard</Text>
          </Pressable>

          <Pressable onPress={handleSimulateDeadlock} style={styles.actionBtnAccent}>
            <Zap size={13} color={styles.iconAccent.color} />
            <Text style={styles.actionBtnTextAccent}>Simulate Deadlock</Text>
          </Pressable>
        </View>
      </View>

      {/* Feedback Toast */}
      {feedbackMsg ? (
        <View style={styles.feedbackToast}>
          <Text style={styles.feedbackText}>{feedbackMsg}</Text>
          <Pressable onPress={() => setFeedbackMsg(null)}>
            <Text style={styles.feedbackClose}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Incidents Section Header */}
      <View style={styles.sectionHeaderRow}>
        <View style={styles.sectionTitleRow}>
          <AlertTriangle size={16} color={styles.iconAccent.color} />
          <Text style={styles.sectionTitle}>Agent Incident Ledger & Auto-Fix Branches</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{incidents.length}</Text>
          </View>
        </View>

        <Pressable onPress={() => void fetchData()} style={styles.syncBtn} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color={styles.iconAccent.color} />
          ) : (
            <RefreshCw size={13} color={styles.iconMuted.color} />
          )}
          <Text style={styles.syncBtnText}>Refresh</Text>
        </Pressable>
      </View>

      {/* Incidents List */}
      <View style={styles.incidentsList}>
        {incidents.length === 0 ? (
          <View style={styles.emptyCard}>
            <CheckCircle2 size={24} color={styles.iconAccent.color} />
            <Text style={styles.emptyTitle}>Zero Active Incidents</Text>
            <Text style={styles.emptySub}>
              No hook crashes or tool deadlocks recorded. When an agent experiences a runtime
              defect, Zencode intercepts the failure and synthesizes a fix proposal here.
            </Text>
          </View>
        ) : (
          incidents.map((incident) => {
            const isHealing = healingId === incident.id;
            const isPushing = pushingId === incident.id;
            const isAutonomous = autonomouslyHealingId === incident.id;
            const hasBranch = Boolean(incident.branchName);

            return (
              <View key={incident.id} style={styles.incidentCard}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    <Text style={styles.incidentId}>{incident.id}</Text>
                    <View
                      style={[
                        styles.statusPill,
                        incident.status === "auto_merged"
                          ? styles.statusAutoMerged
                          : incident.status === "reverted"
                            ? styles.statusReverted
                            : incident.status === "verifying"
                              ? styles.statusVerifying
                              : incident.status === "branch_pushed"
                                ? styles.statusPushed
                                : incident.status === "branch_created"
                                  ? styles.statusCreated
                                  : styles.statusDetected,
                      ]}
                    >
                      <Text style={styles.statusPillText}>{incident.status.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.sourceTag}>
                      {incident.source} {incident.hookName ? `• ${incident.hookName}` : ""}
                    </Text>
                  </View>

                  <Text style={styles.timestamp}>
                    {new Date(incident.timestamp).toLocaleTimeString()}
                  </Text>
                </View>

                {/* Stderr Code Block */}
                {incident.stderr ? (
                  <View style={styles.stderrBox}>
                    <View style={styles.stderrHeader}>
                      <Terminal size={12} color={styles.iconError.color} />
                      <Text style={styles.stderrLabel}>
                        CRASH LOG (Exit Code: {incident.exitCode ?? 2})
                      </Text>
                    </View>
                    <Text style={styles.stderrContent} numberOfLines={4}>
                      {incident.stderr.trim()}
                    </Text>
                  </View>
                ) : null}

                {/* Proposed Fix Card */}
                {incident.proposedFix ? (
                  <View style={styles.fixBox}>
                    <Text style={styles.fixSummary}>💡 {incident.proposedFix.summary}</Text>
                    <Text style={styles.fixRootCause}>
                      <Text style={styles.boldText}>RCA: </Text>
                      {incident.proposedFix.rootCause}
                    </Text>

                    {incident.proposedFix.patchFiles.length > 0 ? (
                      <View style={styles.patchFilesRow}>
                        <Text style={styles.patchFilesLabel}>Patched Files:</Text>
                        {incident.proposedFix.patchFiles.map((p) => (
                          <View key={p.path} style={styles.patchFilePill}>
                            <Text style={styles.patchFilePath}>{p.path}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* Branch & Actions Row */}
                <View style={styles.cardActionsRow}>
                  {hasBranch ? (
                    <View style={styles.branchBox}>
                      <GitBranch size={14} color={styles.iconAccent.color} />
                      <Text style={styles.branchName}>{incident.branchName}</Text>
                      <Text style={styles.reviewHint}>
                        Run: git checkout {incident.branchName} && git diff HEAD~1
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.btnRow}>
                    {incident.status !== "auto_merged" ? (
                      <Pressable
                        onPress={() => void handleAutonomousHeal(incident.id)}
                        disabled={isAutonomous}
                        style={styles.automergeBtn}
                      >
                        {isAutonomous ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <CheckCircle2 size={14} color="#fff" />
                        )}
                        <Text style={styles.automergeBtnText}>
                          {isAutonomous ? "Testing & Merging..." : "🤖 Auto-Merge (Test Verified)"}
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={styles.mergedPill}>
                        <CheckCircle2 size={13} color="#10b981" />
                        <Text style={styles.mergedPillText}>Auto-Merged to Main</Text>
                      </View>
                    )}

                    {!hasBranch ? (
                      <Pressable
                        onPress={() => void handleHealIncident(incident.id)}
                        disabled={isHealing}
                        style={styles.healBtn}
                      >
                        {isHealing ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Zap size={14} color="#fff" />
                        )}
                        <Text style={styles.healBtnText}>
                          {isHealing ? "Synthesizing..." : "⚡ Branch Only"}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => void handlePushBranch(incident.id)}
                        disabled={isPushing}
                        style={styles.pushBtn}
                      >
                        {isPushing ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <GitPullRequest size={14} color="#fff" />
                        )}
                        <Text style={styles.pushBtnText}>
                          {isPushing ? "Pushing..." : "🚀 Push Branch"}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    gap: 16,
  },
  hudBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  hudBannerHealthy: {
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.borderAccent,
  },
  hudBannerTripped: {
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.statusMerged,
  },
  hudIconCol: {
    paddingTop: 2,
  },
  hudBody: {
    flex: 1,
    gap: 6,
  },
  hudTitle: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  hudDesc: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  isolatedRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  isolatedLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.statusMerged,
  },
  isolatedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  isolatedPillText: {
    fontSize: 11,
    fontFamily: "monospace",
    color: theme.colors.foreground,
  },
  hudActions: {
    gap: 8,
  },
  actionBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionBtnAccent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionBtnText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  actionBtnTextAccent: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  feedbackToast: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  feedbackText: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  feedbackClose: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "700",
  },
  countBadge: {
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  countBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  syncBtnText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  incidentsList: {
    gap: 12,
  },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 36,
    gap: 8,
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "700",
  },
  emptySub: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    textAlign: "center",
    maxWidth: 500,
    lineHeight: 18,
  },
  incidentCard: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  incidentId: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusDetected: {
    backgroundColor: theme.colors.surface2,
  },
  statusCreated: {
    backgroundColor: theme.colors.accent,
  },
  statusPushed: {
    backgroundColor: theme.colors.statusMerged,
  },
  statusAutoMerged: {
    backgroundColor: "#059669",
  },
  statusReverted: {
    backgroundColor: "#dc2626",
  },
  statusVerifying: {
    backgroundColor: "#d97706",
  },
  statusPillText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  sourceTag: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  timestamp: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  stderrBox: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 6,
  },
  stderrHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stderrLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  stderrContent: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontFamily: "monospace",
    lineHeight: 16,
  },
  fixBox: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  fixSummary: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  fixRootCause: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  boldText: {
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  patchFilesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  patchFilesLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  patchFilePill: {
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  patchFilePath: {
    color: theme.colors.foreground,
    fontSize: 10,
    fontFamily: "monospace",
  },
  cardActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 12,
  },
  branchBox: {
    flex: 1,
    minWidth: 260,
    gap: 2,
  },
  branchName: {
    color: theme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  reviewHint: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontFamily: "monospace",
  },
  btnRow: {
    flexDirection: "row",
    gap: 8,
  },
  automergeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#059669",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  automergeBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  mergedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: "#059669",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  mergedPillText: {
    color: "#10b981",
    fontSize: 12,
    fontWeight: "700",
  },
  healBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  healBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  pushBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.statusMerged,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pushBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  iconAccent: {
    color: theme.colors.accent,
  },
  iconWarning: {
    color: theme.colors.statusMerged,
  },
  iconError: {
    color: theme.colors.statusMerged,
  },
  iconMuted: {
    color: theme.colors.foregroundMuted,
  },
}));
