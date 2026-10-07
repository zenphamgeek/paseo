import React, { memo, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Cpu, ArrowRight, Zap } from "lucide-react-native";
import type { FleetExecutionMetadata } from "@getpaseo/protocol/fleet-types";
import {
  parseFleetExecutionFromMessage,
  resolveFleetExecutionDetails,
} from "./fleet-execution-label";

export { parseFleetExecutionFromMessage, resolveFleetExecutionDetails };

export interface FleetExecutionBadgeProps {
  fleetExecution?: FleetExecutionMetadata;
  message?: string;
  disableOuterSpacing?: boolean;
}

export const FleetExecutionBadge = memo(function FleetExecutionBadge({
  fleetExecution,
  message,
  disableOuterSpacing,
}: FleetExecutionBadgeProps) {
  const parsed = useMemo(() => {
    if (fleetExecution) return fleetExecution;
    if (message) return parseFleetExecutionFromMessage(message);
    return null;
  }, [fleetExecution, message]);

  if (!parsed) {
    return null;
  }

  const orchestratorNode = parsed.orchestratorNode || "zenpham@gmail.com";
  const orchestratorModel = parsed.orchestratorModel || "gemini-2.5-pro";
  const workerNode = parsed.workerNode || "binhthuong@gmail.com";
  const workerModel = parsed.workerModel || "claude-opus-5-5-high";
  const tier = (parsed.tier || "pro").toUpperCase();
  const isUltra = tier === "ULTRA";

  return (
    <View
      testID="fleet-execution-badge"
      style={[styles.container, !disableOuterSpacing && styles.containerSpacing]}
    >
      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconCircle}>
            <Cpu size={14} color="#818cf8" />
          </View>
          <View style={styles.pulseDot} />
          <Text style={styles.headerTitle}>FLEET MODE ACTIVE</Text>
        </View>

        <View style={styles.headerRight}>
          <View style={[styles.tierPill, isUltra ? styles.tierPillUltra : styles.tierPillPro]}>
            <Zap size={10} color={isUltra ? "#f59e0b" : "#06b6d4"} />
            <Text style={[styles.tierText, isUltra ? styles.tierTextUltra : styles.tierTextPro]}>
              {tier}
            </Text>
          </View>
          {parsed.taskId ? (
            <Text style={styles.taskIdText} numberOfLines={1}>
              #{parsed.taskId.slice(-8)}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Delegation Routing Flow (Orchestrator ➔ Worker) */}
      <View style={styles.routingRow}>
        {/* Orchestrator Box */}
        <View style={styles.nodeBox} testID="fleet-orchestrator-label">
          <Text style={styles.roleLabel}>ORCHESTRATOR</Text>
          <Text style={styles.nodeName} numberOfLines={1} selectable>
            {orchestratorNode}
          </Text>
          <View style={styles.modelPill}>
            <Text style={styles.orchestratorModelText} numberOfLines={1} selectable>
              {orchestratorModel}
            </Text>
          </View>
        </View>

        {/* Direction Connector */}
        <View style={styles.connector}>
          <ArrowRight size={14} color="#818cf8" />
          <Text style={styles.connectorText}>DISPATCHED</Text>
        </View>

        {/* Worker Box */}
        <View style={[styles.nodeBox, styles.workerNodeBox]} testID="fleet-worker-label">
          <Text style={styles.workerRoleLabel}>DELEGATED WORKER</Text>
          <Text style={styles.nodeName} numberOfLines={1} selectable>
            {workerNode}
          </Text>
          <View style={[styles.modelPill, styles.workerModelPill]}>
            <Text style={styles.workerModelText} numberOfLines={1} selectable>
              {workerModel}
            </Text>
          </View>
        </View>
      </View>

      {/* Clef Pre-Flight Gatekeeper & Zero-Token Pass */}
      {parsed.clefGate && (
        <View style={styles.clefBar} testID="clef-gate-badge">
          <View style={styles.clefLeft}>
            <Zap size={10} color="#34d399" />
            <Text style={styles.clefTitle}>CLEF GATE</Text>
            <Text style={styles.clefModelText} numberOfLines={1}>
              {parsed.clefGate.model}
            </Text>
          </View>
          <View style={styles.clefRight}>
            {parsed.clefGate.latencyMs !== undefined && (
              <Text style={styles.clefMetaText}>{parsed.clefGate.latencyMs}ms</Text>
            )}
            {parsed.clefGate.complexityScore !== undefined && (
              <Text style={styles.clefMetaText}>
                Complexity: {parsed.clefGate.complexityScore}/4.0
              </Text>
            )}
            <View style={styles.zeroTokenPill}>
              <Text style={styles.zeroTokenText}>ZERO-TOKEN PASS</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    backgroundColor: "rgba(30, 27, 75, 0.35)",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.35)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: "hidden",
  },
  containerSpacing: {
    marginBottom: 8,
    marginTop: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(99, 102, 241, 0.15)",
    paddingBottom: 6,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  iconCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(99, 102, 241, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10b981",
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#c7d2fe",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
  },
  tierPillPro: {
    backgroundColor: "rgba(6, 182, 212, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(6, 182, 212, 0.3)",
  },
  tierPillUltra: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  tierText: {
    fontSize: 10,
    fontWeight: "700",
  },
  tierTextPro: {
    color: "#06b6d4",
  },
  tierTextUltra: {
    color: "#f59e0b",
  },
  taskIdText: {
    fontSize: 10,
    color: "#64748b",
    fontFamily: "monospace",
  },
  routingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  nodeBox: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
  },
  workerNodeBox: {
    borderColor: "rgba(16, 185, 129, 0.3)",
    backgroundColor: "rgba(6, 78, 59, 0.15)",
  },
  roleLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  workerRoleLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#34d399",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  nodeName: {
    fontSize: 12,
    fontWeight: "600",
    color: "#f8fafc",
    marginBottom: 4,
  },
  modelPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  workerModelPill: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  orchestratorModelText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#93c5fd",
  },
  workerModelText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6ee7b7",
  },
  connector: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    gap: 2,
  },
  connectorText: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: "#818cf8",
  },
  clefBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(99, 102, 241, 0.15)",
    gap: 8,
    flexWrap: "wrap",
  },
  clefLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
  },
  clefTitle: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "#34d399",
  },
  clefModelText: {
    fontSize: 10,
    fontWeight: "500",
    color: "#cbd5e1",
    maxWidth: 200,
  },
  clefRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  clefMetaText: {
    fontSize: 10,
    color: "#94a3b8",
    fontWeight: "500",
  },
  zeroTokenPill: {
    backgroundColor: "rgba(52, 211, 153, 0.15)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "rgba(52, 211, 153, 0.3)",
  },
  zeroTokenText: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: "#34d399",
  },
});
