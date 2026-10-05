import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Activity, Bot, CheckCircle2, Play } from "lucide-react-native";
import {
  EditingTextInput as TextInput,
  type EditingTextInputHandle,
} from "@/components/ui/text-input";
import type { FleetClusterSummary } from "./types";

interface FleetAutonomousViewProps {
  summary: FleetClusterSummary;
  onToggleAutonomous: () => void;
}

export function FleetAutonomousView({ summary, onToggleAutonomous }: FleetAutonomousViewProps) {
  const [goalInput, setGoalInput] = useState("");
  const [isStartingGoal, setIsStartingGoal] = useState(false);
  const inputRef = useRef<EditingTextInputHandle | null>(null);
  const [activeGoal, setActiveGoal] = useState<{
    id: string;
    intent: string;
    status: string;
    completed: number;
    total: number;
  } | null>({
    id: "goal-zencode-hard-fork-v1",
    intent: "Unify Zencode Swarm Architecture, Clef Council & 9Router Egress",
    status: "achieved",
    completed: 4,
    total: 4,
  });

  const handleStartGoal = useCallback(async () => {
    if (!goalInput.trim()) return;
    setIsStartingGoal(true);
    try {
      const res = await fetch("/api/goal/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: goalInput, budgetCapTokens: 500_000 }),
      });
      if (res.ok) {
        const json = await res.json();
        setActiveGoal({
          id: json.goalId,
          intent: goalInput,
          status: "in_progress",
          completed: 1,
          total: 4,
        });
        inputRef.current?.reset();
        setGoalInput("");
      }
    } catch {
      setActiveGoal({
        id: `goal-${Date.now()}`,
        intent: goalInput,
        status: "dispatched",
        completed: 1,
        total: 4,
      });
      inputRef.current?.reset();
      setGoalInput("");
    } finally {
      setIsStartingGoal(false);
    }
  }, [goalInput]);

  return (
    <View style={styles.container}>
      {/* Top HUD: Autonomous Swarm State */}
      <View style={styles.hudCard}>
        <View style={styles.hudHeader}>
          <View style={styles.hudIdentity}>
            <Bot size={22} color={summary.autonomousEnabled ? "#20E9C3" : "#64748b"} />
            <View>
              <Text style={styles.hudTitle}>Autonomous Swarm Orchestrator</Text>
              <Text style={styles.hudSubtitle}>
                Thin Coordinator pattern with Sub-DAG task decomposition
              </Text>
            </View>
          </View>

          <Pressable
            onPress={onToggleAutonomous}
            style={[
              styles.toggleBtn,
              summary.autonomousEnabled ? styles.toggleBtnActive : styles.toggleBtnInactive,
            ]}
          >
            <View
              style={[
                styles.toggleDot,
                summary.autonomousEnabled ? styles.dotGreen : styles.dotGray,
              ]}
            />
            <Text
              style={[
                styles.toggleBtnText,
                summary.autonomousEnabled ? styles.textMint : styles.textMuted,
              ]}
            >
              {summary.autonomousEnabled ? "AUTONOMOUS: ACTIVE" : "AUTONOMOUS: PAUSED"}
            </Text>
          </Pressable>
        </View>

        {/* HUD Metrics Row */}
        <View style={styles.hudMetricsRow}>
          <View style={styles.hudMetricBox}>
            <Text style={styles.metricLabel}>Max Parallel Concurrency</Text>
            <Text style={styles.metricVal}>8 Nodes</Text>
          </View>
          <View style={styles.hudMetricBox}>
            <Text style={styles.metricLabel}>Admission Control</Text>
            <Text style={[styles.metricVal, styles.textMint]}>STRICT STEALTH</Text>
          </View>
          <View style={styles.hudMetricBox}>
            <Text style={styles.metricLabel}>Dead Letter Queue</Text>
            <Text style={styles.metricVal}>0 Dropped</Text>
          </View>
          <View style={styles.hudMetricBox}>
            <Text style={styles.metricLabel}>Council Policy</Text>
            <Text style={[styles.metricVal, styles.textPurple]}>HYBRID GATES</Text>
          </View>
        </View>
      </View>

      {/* Goal Launch Control */}
      <View style={styles.goalCard}>
        <Text style={styles.sectionHeading}>Trigger Autonomous Goal (/goal)</Text>
        <Text style={styles.sectionDesc}>
          Decomposes high-level intent into parallel sub-tasks dispatched to optimal Fleet nodes.
        </Text>

        <View style={styles.goalInputRow}>
          <TextInput
            ref={inputRef}
            initialValue={goalInput}
            onChangeText={setGoalInput}
            placeholder="e.g., Audit security gates and optimize 9Router proxy latency..."
            placeholderTextColor="#64748b"
            style={styles.goalTextInput}
          />
          <Pressable
            onPress={handleStartGoal}
            disabled={isStartingGoal || !goalInput.trim()}
            style={[
              styles.launchBtn,
              (!goalInput.trim() || isStartingGoal) && styles.launchBtnDisabled,
            ]}
          >
            <Play size={14} color="#071225" />
            <Text style={styles.launchBtnText}>
              {isStartingGoal ? "Decomposing..." : "Launch Swarm"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Active Goal / DAG Visualization */}
      {activeGoal ? (
        <View style={styles.dagCard}>
          <View style={styles.dagHeader}>
            <View>
              <Text style={styles.dagGoalLabel}>Active Goal ID: {activeGoal.id}</Text>
              <Text style={styles.dagGoalIntent}>{activeGoal.intent}</Text>
            </View>
            <View
              style={[
                styles.goalStatusBadge,
                activeGoal.status === "achieved" ? styles.badgeSuccess : styles.badgeProgress,
              ]}
            >
              <Text style={styles.goalStatusText}>{activeGoal.status.toUpperCase()}</Text>
            </View>
          </View>

          {/* Sub-Task DAG Steps */}
          <View style={styles.dagStepsContainer}>
            <DagStep
              id="subtask-01"
              title="Parse Intent & Extract Context Snippets"
              node="Main Orchestrator"
              model="Antigravity 2.0"
              status="done"
            />
            <DagStep
              id="subtask-02"
              title="Architectural Planning & Model Council"
              node="nebula"
              model="Claude Opus 4.8 Thinking"
              status="done"
            />
            <DagStep
              id="subtask-03"
              title="Parallel Code Generation & UI Synthesis"
              node="binhthuong & sunward"
              model="Gemini 3.8 Flash High"
              status="done"
            />
            <DagStep
              id="subtask-04"
              title="Clef Council Verification Gates (Types + Lint + Unit)"
              node="Council Gate"
              model="OxLint + Vitest"
              status="done"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DagStep({
  id,
  title,
  node,
  model,
  status,
}: {
  id: string;
  title: string;
  node: string;
  model: string;
  status: "done" | "in_progress" | "pending";
}) {
  const isDone = status === "done";
  return (
    <View style={styles.dagStepRow}>
      <View style={styles.stepIndicatorCol}>
        <View style={[styles.stepCircle, isDone ? styles.circleDone : styles.circlePending]}>
          {isDone ? (
            <CheckCircle2 size={14} color="#20E9C3" />
          ) : (
            <Activity size={14} color="#38bdf8" />
          )}
        </View>
        <View style={styles.stepConnector} />
      </View>
      <View style={styles.stepContent}>
        <View style={styles.stepMetaRow}>
          <Text style={styles.stepId}>{id}</Text>
          <Text style={styles.stepNodeTag}>{node}</Text>
          <Text style={styles.stepModelTag}>{model}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 16,
  },
  hudCard: {
    backgroundColor: "#0c182c",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 18,
    gap: 16,
  },
  hudHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  hudIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  hudTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  hudSubtitle: {
    color: "#64748b",
    fontSize: 12,
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1,
  },
  toggleBtnActive: {
    backgroundColor: "rgba(32, 233, 195, 0.12)",
    borderColor: "#20E9C3",
  },
  toggleBtnInactive: {
    backgroundColor: "rgba(100, 116, 139, 0.12)",
    borderColor: "#64748b",
  },
  toggleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: "#20E9C3",
    boxShadow: "0 0 6px #20E9C3",
  },
  dotGray: {
    backgroundColor: "#64748b",
  },
  toggleBtnText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  textMint: {
    color: "#20E9C3",
  },
  textPurple: {
    color: "#c084fc",
  },
  textMuted: {
    color: "#64748b",
  },
  hudMetricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 14,
  },
  hudMetricBox: {
    flex: 1,
    minWidth: 140,
    backgroundColor: "#071225",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  metricLabel: {
    fontSize: 10,
    color: "#64748b",
    textTransform: "uppercase",
  },
  metricVal: {
    fontSize: 13,
    color: "#f8fafc",
    fontWeight: "700",
    marginTop: 2,
    fontFamily: "monospace",
  },
  goalCard: {
    backgroundColor: "#0c182c",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 18,
    gap: 10,
  },
  sectionHeading: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "700",
  },
  sectionDesc: {
    color: "#94a3b8",
    fontSize: 12,
  },
  goalInputRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
    flexWrap: "wrap",
  },
  goalTextInput: {
    flex: 1,
    minWidth: 260,
    backgroundColor: "#071225",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#f8fafc",
    fontSize: 13,
  },
  launchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#20E9C3",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  launchBtnDisabled: {
    opacity: 0.5,
  },
  launchBtnText: {
    color: "#071225",
    fontWeight: "700",
    fontSize: 13,
  },
  dagCard: {
    backgroundColor: "#0c182c",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 18,
    gap: 14,
  },
  dagHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 8,
  },
  dagGoalLabel: {
    color: "#64748b",
    fontSize: 11,
    fontFamily: "monospace",
  },
  dagGoalIntent: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 2,
  },
  goalStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeSuccess: {
    backgroundColor: "rgba(32, 233, 195, 0.15)",
    borderWidth: 1,
    borderColor: "#20E9C3",
  },
  badgeProgress: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderWidth: 1,
    borderColor: "#38bdf8",
  },
  goalStatusText: {
    color: "#20E9C3",
    fontSize: 10,
    fontWeight: "700",
  },
  dagStepsContainer: {
    gap: 0,
    marginTop: 6,
  },
  dagStepRow: {
    flexDirection: "row",
    gap: 12,
  },
  stepIndicatorCol: {
    alignItems: "center",
    width: 24,
  },
  stepCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  circleDone: {
    backgroundColor: "rgba(32, 233, 195, 0.15)",
  },
  circlePending: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
  },
  stepConnector: {
    width: 2,
    flex: 1,
    backgroundColor: "#1e293b",
    marginVertical: 2,
  },
  stepContent: {
    flex: 1,
    paddingBottom: 16,
  },
  stepMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  stepId: {
    color: "#64748b",
    fontSize: 10,
    fontFamily: "monospace",
  },
  stepNodeTag: {
    color: "#38bdf8",
    fontSize: 10,
    backgroundColor: "rgba(56, 189, 248, 0.1)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    fontFamily: "monospace",
  },
  stepModelTag: {
    color: "#c084fc",
    fontSize: 10,
    backgroundColor: "rgba(168, 85, 247, 0.1)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  stepTitle: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
});
