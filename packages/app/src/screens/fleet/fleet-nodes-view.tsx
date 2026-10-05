import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
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
          <Search size={14} color={styles.iconMuted.color} style={styles.searchIcon} />
          <TextInput
            initialValue={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Filter nodes by ID, email, or model..."
            placeholderTextColor={styles.iconMuted.color}
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
            <Zap
              size={12}
              color={tierFilter === "ultra" ? styles.iconMerged.color : styles.iconMuted.color}
            />
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
            <Cpu
              size={12}
              color={tierFilter === "pro" ? styles.iconAccent.color : styles.iconMuted.color}
            />
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
          <Key size={12} color={styles.iconMuted.color} />
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
          <Cpu size={12} color={styles.iconAccent.color} />
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

const styles = StyleSheet.create((theme) => ({
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
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    height: 36,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.foreground,
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
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  filterPillActive: {
    backgroundColor: theme.colors.statusSuccessTint,
    borderColor: theme.colors.accent,
  },
  filterPillActiveUltra: {
    backgroundColor: theme.colors.statusMerged + "26",
    borderColor: theme.colors.statusMerged,
  },
  filterPillActivePro: {
    backgroundColor: theme.colors.accent + "26",
    borderColor: theme.colors.accent,
  },
  filterPillText: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    fontWeight: "500",
  },
  filterPillTextActive: {
    color: theme.colors.accent,
    fontWeight: "600",
  },
  filterPillTextActiveUltra: {
    color: theme.colors.statusMerged,
    fontWeight: "600",
  },
  filterPillTextActivePro: {
    color: theme.colors.accent,
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
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 14,
  },
  card: {
    flex: 1,
    minWidth: 260,
    maxWidth: 360,
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 10,
  },
  cardUltra: {
    borderColor: theme.colors.statusMerged,
    backgroundColor: theme.colors.surface1,
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
    backgroundColor: theme.colors.statusDotSuccess,
  },
  dotDegraded: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  nodeId: {
    color: theme.colors.foreground,
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
    backgroundColor: theme.colors.statusMerged + "26",
    borderWidth: 1,
    borderColor: theme.colors.statusMerged,
  },
  badgePro: {
    backgroundColor: theme.colors.accent + "26",
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  textUltra: {
    color: theme.colors.statusMerged,
  },
  textPro: {
    color: theme.colors.accent,
  },
  nodeKind: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  accountText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    fontFamily: "monospace",
  },
  quotaSection: {
    gap: 8,
    backgroundColor: theme.colors.surface2,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
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
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  quotaValue: {
    fontSize: 11,
    color: theme.colors.foreground,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  progressBarBg: {
    height: 4,
    backgroundColor: theme.colors.surface3,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  barHealthy: {
    backgroundColor: theme.colors.accent,
  },
  barWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
  barCritical: {
    backgroundColor: theme.colors.statusDanger,
  },
  barPurple: {
    backgroundColor: theme.colors.statusMerged,
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modelName: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: "500",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 8,
  },
  metricItem: {
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 9,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: 12,
    color: theme.colors.foreground,
    fontWeight: "600",
  },
  errorText: {
    color: theme.colors.statusDanger,
  },
  iconMuted: {
    color: theme.colors.foregroundMuted,
  },
  iconAccent: {
    color: theme.colors.accent,
  },
  iconMerged: {
    color: theme.colors.statusMerged,
  },
}));
