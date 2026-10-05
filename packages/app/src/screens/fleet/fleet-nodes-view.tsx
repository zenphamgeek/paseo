import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Cpu, Key, Search, Zap } from "lucide-react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import type { FleetNodeSummary, NodeTierFilter } from "./types";

interface FleetNodesViewProps {
  nodes: FleetNodeSummary[];
  _onRefreshQuotas?: () => void;
  _isRefreshing?: boolean;
}

function getBarColorStyle(percent: number) {
  if (percent < 20) return styles.barCritical;
  if (percent < 50) return styles.barWarning;
  return styles.barHealthy;
}

export function FleetNodesView({ nodes }: FleetNodesViewProps) {
  const [tierFilter, setTierFilter] = useState<NodeTierFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSetAll = useCallback(() => setTierFilter("all"), []);
  const handleSetUltra = useCallback(() => setTierFilter("ultra"), []);
  const handleSetPro = useCallback(() => setTierFilter("pro"), []);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const matchesTier = tierFilter === "all" || node.tier === tierFilter;
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        node.id.toLowerCase().includes(query) ||
        (node.accountEmail && node.accountEmail.toLowerCase().includes(query)) ||
        (node.preferredModel && node.preferredModel.toLowerCase().includes(query)) ||
        (node.caps && node.caps.some((c) => c.toLowerCase().includes(query)));
      return matchesTier && matchesSearch;
    });
  }, [nodes, tierFilter, searchQuery]);

  return (
    <View style={styles.container}>
      {/* Controls Bar: Search + Filter Pills */}
      <View style={styles.controlsBar}>
        <View style={styles.searchBox}>
          <Search size={14} color="#64748b" style={styles.searchIcon} />
          <TextInput
            initialValue={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Filter nodes by ID, email, or model..."
            placeholderTextColor="#64748b"
            style={styles.searchInput}
          />
        </View>

        <View style={styles.filterPills}>
          <Pressable
            onPress={handleSetAll}
            style={[styles.filterPill, tierFilter === "all" && styles.filterPillActive]}
          >
            <Text
              style={[styles.filterPillText, tierFilter === "all" && styles.filterPillTextActive]}
            >
              All ({nodes.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={handleSetUltra}
            style={[styles.filterPill, tierFilter === "ultra" && styles.filterPillActiveUltra]}
          >
            <Zap size={12} color={tierFilter === "ultra" ? "#c084fc" : "#a855f7"} />
            <Text
              style={[
                styles.filterPillText,
                tierFilter === "ultra" && styles.filterPillTextActiveUltra,
              ]}
            >
              Ultra ({nodes.filter((n) => n.tier === "ultra").length})
            </Text>
          </Pressable>

          <Pressable
            onPress={handleSetPro}
            style={[styles.filterPill, tierFilter === "pro" && styles.filterPillActivePro]}
          >
            <Cpu size={12} color={tierFilter === "pro" ? "#38bdf8" : "#0284c7"} />
            <Text
              style={[
                styles.filterPillText,
                tierFilter === "pro" && styles.filterPillTextActivePro,
              ]}
            >
              Pro ({nodes.filter((n) => n.tier === "pro").length})
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Nodes Grid */}
      <View style={styles.grid}>
        {filteredNodes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No fleet nodes matching criteria</Text>
          </View>
        ) : (
          filteredNodes.map((node) => <NodeCard key={node.id} node={node} />)
        )}
      </View>
    </View>
  );
}

function NodeCard({ node }: { node: FleetNodeSummary }) {
  const isUltra = node.tier === "ultra";
  const geminiPercent = node.geminiQuotaPercent ?? (isUltra ? 100 : 75);
  const claudePercent = node.claudeQuotaPercent ?? (isUltra ? 99 : 0);
  const isReady = node.state === "ready" || node.state === "busy";

  return (
    <View style={[styles.card, isUltra && styles.cardUltra]}>
      {/* Node Header */}
      <View style={styles.cardHeader}>
        <View style={styles.nodeIdentity}>
          <View style={[styles.statusDot, isReady ? styles.dotReady : styles.dotDegraded]} />
          <Text style={styles.nodeId}>{node.id}</Text>
          <View style={[styles.tierBadge, isUltra ? styles.badgeUltra : styles.badgePro]}>
            <Text style={[styles.tierBadgeText, isUltra ? styles.textUltra : styles.textPro]}>
              {node.tier.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.nodeKind}>{node.kind}</Text>
      </View>

      {/* Account Tag */}
      {node.accountEmail ? (
        <View style={styles.accountRow}>
          <Key size={12} color="#64748b" />
          <Text style={styles.accountText} numberOfLines={1}>
            {node.accountEmail}
          </Text>
        </View>
      ) : null}

      {/* Quotas Section */}
      <View style={styles.quotaSection}>
        {/* Gemini Quota Bar */}
        <View style={styles.quotaBarContainer}>
          <View style={styles.quotaBarHeader}>
            <Text style={styles.quotaLabel}>Gemini Quota</Text>
            <Text style={styles.quotaValue}>{geminiPercent.toFixed(1)}%</Text>
          </View>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.min(100, Math.max(0, geminiPercent))}%` },
                getBarColorStyle(geminiPercent),
              ]}
            />
          </View>
        </View>

        {/* Claude Quota Bar (for Ultra nodes or nodes with Claude caps) */}
        {claudePercent > 0 || isUltra ? (
          <View style={styles.quotaBarContainer}>
            <View style={styles.quotaBarHeader}>
              <Text style={styles.quotaLabel}>Claude Thinking</Text>
              <Text style={styles.quotaValue}>{claudePercent.toFixed(1)}%</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.min(100, Math.max(0, claudePercent))}%` },
                  styles.barPurple,
                ]}
              />
            </View>
          </View>
        ) : null}
      </View>

      {/* Caps / Model Pills */}
      {node.preferredModel ? (
        <View style={styles.modelRow}>
          <Cpu size={12} color="#20E9C3" />
          <Text style={styles.modelName} numberOfLines={1}>
            {node.preferredModel}
          </Text>
        </View>
      ) : null}

      {/* Metrics Footer */}
      <View style={styles.cardFooter}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Served</Text>
          <Text style={styles.metricValue}>{node.requestsServed}</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Active</Text>
          <Text style={styles.metricValue}>{node.activeJobs}</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Errors</Text>
          <Text style={[styles.metricValue, node.errorCount > 0 && styles.errorText]}>
            {node.errorCount}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    gap: 16,
  },
  controlsBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  searchBox: {
    flex: 1,
    minWidth: 240,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0d1b30",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 10,
    height: 36,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: "#f8fafc",
    fontSize: 13,
    padding: 0,
  },
  filterPills: {
    flexDirection: "row",
    gap: 6,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9999,
    backgroundColor: "#0d1b30",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  filterPillActive: {
    backgroundColor: "rgba(32, 233, 195, 0.15)",
    borderColor: "#20E9C3",
  },
  filterPillActiveUltra: {
    backgroundColor: "rgba(168, 85, 247, 0.15)",
    borderColor: "#a855f7",
  },
  filterPillActivePro: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: "#38bdf8",
  },
  filterPillText: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "500",
  },
  filterPillTextActive: {
    color: "#20E9C3",
    fontWeight: "600",
  },
  filterPillTextActiveUltra: {
    color: "#c084fc",
    fontWeight: "600",
  },
  filterPillTextActivePro: {
    color: "#38bdf8",
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  emptyCard: {
    width: "100%",
    padding: 32,
    borderRadius: 12,
    backgroundColor: "#0d1b30",
    alignItems: "center",
  },
  emptyText: {
    color: "#64748b",
    fontSize: 14,
  },
  card: {
    flex: 1,
    minWidth: 260,
    maxWidth: 360,
    backgroundColor: "#0c182c",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 14,
    gap: 10,
  },
  cardUltra: {
    borderColor: "rgba(168, 85, 247, 0.35)",
    backgroundColor: "#0d162d",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  nodeIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotReady: {
    backgroundColor: "#10b981",
    boxShadow: "0 0 6px #10b981",
  },
  dotDegraded: {
    backgroundColor: "#f59e0b",
  },
  nodeId: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  tierBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeUltra: {
    backgroundColor: "rgba(168, 85, 247, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.5)",
  },
  badgePro: {
    backgroundColor: "rgba(56, 189, 248, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.5)",
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  textUltra: {
    color: "#c084fc",
  },
  textPro: {
    color: "#38bdf8",
  },
  nodeKind: {
    fontSize: 11,
    color: "#64748b",
    textTransform: "uppercase",
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  accountText: {
    color: "#94a3b8",
    fontSize: 11,
    fontFamily: "monospace",
  },
  quotaSection: {
    gap: 8,
    backgroundColor: "#071225",
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  quotaBarContainer: {
    gap: 4,
  },
  quotaBarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quotaLabel: {
    fontSize: 10,
    color: "#64748b",
    textTransform: "uppercase",
  },
  quotaValue: {
    fontSize: 11,
    color: "#cbd5e1",
    fontWeight: "600",
    fontFamily: "monospace",
  },
  progressBarBg: {
    height: 4,
    backgroundColor: "#1e293b",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  barHealthy: {
    backgroundColor: "#20E9C3",
  },
  barWarning: {
    backgroundColor: "#f59e0b",
  },
  barCritical: {
    backgroundColor: "#ef4444",
  },
  barPurple: {
    backgroundColor: "#a855f7",
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modelName: {
    color: "#20E9C3",
    fontSize: 11,
    fontWeight: "500",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingTop: 8,
  },
  metricItem: {
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 9,
    color: "#64748b",
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 12,
    color: "#e2e8f0",
    fontWeight: "600",
  },
  errorText: {
    color: "#ef4444",
  },
});
