import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Key,
  Plus,
  Search,
  Server,
  Shield,
  Sparkles,
  X,
  Zap,
} from "lucide-react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import type {
  AnalyticsTimeRange,
  FleetNodeSummary,
  NodeAttentionLevel,
  NodeAttentionMeta,
  NodeTierFilter,
} from "./types";

interface FleetNodesViewProps {
  nodes: FleetNodeSummary[];
  retentionPeriod?: AnalyticsTimeRange;
  onRetentionChange?: (range: AnalyticsTimeRange) => void;
  _onRefreshQuotas?: () => void;
  _isRefreshing?: boolean;
}

export function getNodeAttentionMeta(node: FleetNodeSummary): NodeAttentionMeta {
  const isOpenCode = node.kind === "opencode" || node.id.startsWith("oc_");
  const isUltra = node.tier === "ultra" && !isOpenCode;
  const isNebula = node.id === "nebula" || node.kind === "nebula";
  const geminiPercent = node.geminiQuotaPercent ?? (isUltra ? 100 : 75);
  const claudePercent = node.claudeQuotaPercent ?? (isUltra ? 99 : 0);

  // 1. Critical Attention:
  const isZeroQuota = !isOpenCode && !isNebula && geminiPercent <= 0 && claudePercent <= 0;
  const isNebulaExhausted = isNebula && claudePercent <= 0 && geminiPercent <= 0;
  if (
    isZeroQuota ||
    isNebulaExhausted ||
    node.state === "quota_exhausted" ||
    node.state === "dead" ||
    node.ineligible
  ) {
    return {
      level: "critical",
      badgeLabel: node.ineligible ? "INELIGIBLE" : "⚠️ QUOTA EXHAUSTED",
      reason: node.ineligibleReason || "Quota depleted across all simulation windows",
      isAttentionRequired: true,
    };
  }
  if (node.errorCount >= 5) {
    return {
      level: "critical",
      badgeLabel: `🚨 HIGH ERRORS (${node.errorCount})`,
      reason: `${node.errorCount} runtime failures reported`,
      isAttentionRequired: true,
    };
  }

  // 2. Active: Currently serving jobs
  if (node.activeJobs > 0) {
    return {
      level: "active",
      badgeLabel: `⚡ SERVING (${node.activeJobs})`,
      reason: "Active parallel execution ongoing",
      isAttentionRequired: false,
    };
  }

  // 3. Warning: Low quota (<20%) or errors > 0
  const isLowQuota =
    !isOpenCode &&
    ((geminiPercent > 0 && geminiPercent < 20) || (claudePercent > 0 && claudePercent < 20));
  if (
    isLowQuota ||
    node.errorCount > 0 ||
    node.state === "throttled" ||
    node.state === "degraded"
  ) {
    return {
      level: "warning",
      badgeLabel: node.errorCount > 0 ? `⚠️ ${node.errorCount} ERRORS` : "⚠️ LOW QUOTA (<20%)",
      reason:
        node.errorCount > 0
          ? `${node.errorCount} intermittent error(s)`
          : "Simulation window remaining < 20%",
      isAttentionRequired: true,
    };
  }

  // 4. Healthy / Fully Operational
  return {
    level: "healthy",
    badgeLabel: isOpenCode ? "FREE SANDBOX" : "OPERATIONAL",
    reason: "Nominal stealth status",
    isAttentionRequired: false,
  };
}

function formatCountdown(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getBarColorStyle(percent: number) {
  if (percent < 20) return styles.barCritical;
  if (percent < 50) return styles.barWarning;
  return styles.barHealthy;
}

export function FleetNodesView({
  nodes,
  retentionPeriod = "24h",
  onRetentionChange,
  _onRefreshQuotas,
}: FleetNodesViewProps) {
  const [tierFilter, setTierFilter] = useState<NodeTierFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const handleSetAll = useCallback(() => setTierFilter("all"), []);
  const handleSetAttention = useCallback(() => setTierFilter("attention"), []);
  const handleSetActive = useCallback(() => setTierFilter("active"), []);
  const handleSetAgy = useCallback(() => setTierFilter("agy"), []);
  const handleSetOpenCode = useCallback(() => setTierFilter("opencode"), []);
  const handleSetUltra = useCallback(() => setTierFilter("ultra"), []);
  const handleSetPro = useCallback(() => setTierFilter("pro"), []);

  // Attention stats for quick summary
  const attentionStats = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let active = 0;
    let opencode = 0;
    let ultra = 0;
    let pro = 0;

    for (const node of nodes) {
      const meta = getNodeAttentionMeta(node);
      if (meta.level === "critical") critical++;
      if (meta.level === "warning") warning++;
      if (node.activeJobs > 0) active++;
      if (node.kind === "opencode" || node.id.startsWith("oc_")) opencode++;
      else if (node.tier === "ultra") ultra++;
      else if (node.tier === "pro") pro++;
    }

    return {
      critical,
      warning,
      totalAttention: critical + warning,
      active,
      opencode,
      ultra,
      pro,
    };
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      let matchesTier = true;
      if (tierFilter === "attention") {
        const meta = getNodeAttentionMeta(node);
        matchesTier = meta.isAttentionRequired;
      } else if (tierFilter === "active") {
        matchesTier = node.activeJobs > 0;
      } else if (tierFilter === "ultra") {
        matchesTier =
          node.tier === "ultra" && node.kind !== "opencode" && !node.id.startsWith("oc_");
      } else if (tierFilter === "pro") {
        matchesTier = node.tier === "pro" && node.kind !== "opencode" && !node.id.startsWith("oc_");
      } else if (tierFilter === "agy") {
        matchesTier = node.kind === "agy" || node.kind === "nebula";
      } else if (tierFilter === "opencode") {
        matchesTier = node.kind === "opencode" || node.id.startsWith("oc_");
      }

      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        node.id.toLowerCase().includes(query) ||
        (node.displayName && node.displayName.toLowerCase().includes(query)) ||
        (node.accountEmail && node.accountEmail.toLowerCase().includes(query)) ||
        (node.preferredModel && node.preferredModel.toLowerCase().includes(query)) ||
        (node.label && node.label.toLowerCase().includes(query)) ||
        (node.caps && node.caps.some((c) => c.toLowerCase().includes(query))) ||
        (node.domainSpecialization &&
          node.domainSpecialization.some((d) => d.toLowerCase().includes(query)));
      return matchesTier && matchesSearch;
    });
  }, [nodes, tierFilter, searchQuery]);

  return (
    <View style={styles.container}>
      {/* Real-Time Attention Quick Filter Toolbar */}
      <View style={styles.attentionSummaryBar}>
        <View style={styles.attentionSummaryLeft}>
          <Shield size={14} color={styles.iconAccent.color} />
          <Text style={styles.attentionSummaryTitle}>Swarm Attention Radar:</Text>
          {attentionStats.totalAttention > 0 ? (
            <View style={styles.attentionPillCountWrap}>
              <Text style={styles.attentionPillCountText}>
                {attentionStats.critical} Critical • {attentionStats.warning} Warning
              </Text>
            </View>
          ) : (
            <View style={styles.attentionHealthyPill}>
              <CheckCircle2 size={12} color="#10b981" />
              <Text style={styles.attentionHealthyText}>All Nodes Nominal</Text>
            </View>
          )}
        </View>

        <View style={styles.attentionFilterRow}>
          {attentionStats.totalAttention > 0 ? (
            <Pressable
              onPress={handleSetAttention}
              style={[
                styles.attentionQuickBtn,
                tierFilter === "attention" && styles.attentionQuickBtnActive,
              ]}
            >
              <AlertTriangle size={12} color={tierFilter === "attention" ? "#fb7185" : "#f43f5e"} />
              <Text
                style={[
                  styles.attentionQuickBtnText,
                  tierFilter === "attention" && styles.attentionQuickBtnTextActive,
                ]}
              >
                Needs Attention ({attentionStats.totalAttention})
              </Text>
            </Pressable>
          ) : null}

          {attentionStats.active > 0 ? (
            <Pressable
              onPress={handleSetActive}
              style={[
                styles.activeQuickBtn,
                tierFilter === "active" && styles.activeQuickBtnActive,
              ]}
            >
              <Activity size={12} color={tierFilter === "active" ? "#38bdf8" : "#06b6d4"} />
              <Text
                style={[
                  styles.activeQuickBtnText,
                  tierFilter === "active" && styles.activeQuickBtnTextActive,
                ]}
              >
                Active Serving ({attentionStats.active})
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => setIsAddModalOpen(true)}
            style={styles.addNodeQuickBtn}
            testID="btn-open-add-node-modal"
          >
            <Plus size={12} color="#10b981" />
            <Text style={styles.addNodeQuickBtnText}>+ Add Node</Text>
          </Pressable>
        </View>
      </View>

      {/* Controls Bar: Search + Filter Pills */}
      <View style={styles.controlsBar}>
        <View style={styles.searchBox}>
          <Search size={14} color={styles.iconMuted.color} style={styles.searchIcon} />
          <TextInput
            initialValue={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Filter nodes by ID, email, role, or model..."
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
            onPress={handleSetOpenCode}
            style={[
              styles.filterPill,
              tierFilter === "opencode" && styles.filterPillActiveOpencode,
            ]}
          >
            <Sparkles
              size={12}
              color={tierFilter === "opencode" ? "#34d399" : styles.iconMuted.color}
            />
            <Text
              style={[
                styles.filterPillText,
                tierFilter === "opencode" && styles.filterPillTextActiveOpencode,
              ]}
            >
              OpenCode ({attentionStats.opencode})
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
              Ultra ({attentionStats.ultra})
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
              Pro ({attentionStats.pro})
            </Text>
          </Pressable>

          <Pressable
            onPress={handleSetAgy}
            style={[styles.filterPill, tierFilter === "agy" && styles.filterPillActivePro]}
          >
            <Cpu
              size={12}
              color={tierFilter === "agy" ? styles.iconAccent.color : styles.iconMuted.color}
            />
            <Text
              style={[
                styles.filterPillText,
                tierFilter === "agy" && styles.filterPillTextActivePro,
              ]}
            >
              AGY ({nodes.filter((n) => n.kind === "agy" || n.kind === "nebula").length})
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Retention Period Filter Bar */}
      <View style={styles.retentionBar}>
        <View style={styles.retentionLabelWrap}>
          <Clock size={13} color={styles.iconAccent.color} />
          <Text style={styles.retentionLabelTitle}>Retention Window:</Text>
        </View>
        <View style={styles.retentionPills}>
          {(["1h", "24h", "7d", "30d", "all"] as const).map((r) => {
            const label = r === "all" ? "All Time" : r;
            const isActive = (retentionPeriod || "24h") === r;
            return (
              <Pressable
                key={r}
                onPress={() => onRetentionChange?.(r)}
                style={[styles.retentionPill, isActive && styles.retentionPillActive]}
              >
                <Text
                  style={[styles.retentionPillText, isActive && styles.retentionPillTextActive]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.retentionSummary}>
          <Text style={styles.retentionSummaryText}>
            Showing live telemetry served across{" "}
            {retentionPeriod === "all" ? "entire cluster lifetime" : `last ${retentionPeriod}`}
          </Text>
        </View>
      </View>

      {/* Nodes Grid */}
      <View style={styles.grid}>
        {filteredNodes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No fleet nodes matching criteria</Text>
          </View>
        ) : (
          filteredNodes.map((node) => (
            <NodeCard key={node.id} node={node} retentionPeriod={retentionPeriod} />
          ))
        )}
      </View>

      {/* Add Fleet Node Manual Modal */}
      <AddNodeModal
        visible={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onCreated={() => _onRefreshQuotas?.()}
      />
    </View>
  );
}

function NodeCard({
  node,
  retentionPeriod,
}: {
  node: FleetNodeSummary;
  retentionPeriod?: AnalyticsTimeRange;
}) {
  const [copied, setCopied] = useState(false);
  const isOpenCode = node.kind === "opencode" || node.id.startsWith("oc_");
  const isUltra = node.tier === "ultra" && !isOpenCode;
  const isNebula = node.id === "nebula" || node.kind === "nebula";
  const geminiPercent = node.geminiQuotaPercent ?? (isUltra ? 100 : 75);
  const claudePercent = node.claudeQuotaPercent ?? (isUltra ? 99 : 0);
  const isReady = node.state === "ready" || node.state === "busy";
  const hasClaudeSupport =
    !isOpenCode &&
    (isNebula ||
      isUltra ||
      (node.caps?.some((c) => c.includes("claude") || c.includes("opus")) ?? true));

  const attention = useMemo(() => getNodeAttentionMeta(node), [node]);

  // Success rate metric
  const totalReqs = node.requestsServed + node.errorCount;
  const successRate = totalReqs > 0 ? Math.round((node.requestsServed / totalReqs) * 100) : 100;

  const handleCopyId = useCallback(() => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(node.id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // fallback
    }
  }, [node.id]);

  const geminiCountdown = formatCountdown(node.geminiResetCountdownS);
  const claudeCountdown = formatCountdown(node.claudeResetCountdownS);

  return (
    <View
      style={[
        styles.card,
        attention.level === "critical" && styles.cardCritical,
        attention.level === "warning" && styles.cardWarning,
        attention.level === "active" && styles.cardActive,
        isUltra && attention.level === "healthy" && styles.cardUltra,
        isOpenCode && attention.level === "healthy" && styles.cardOpencode,
      ]}
    >
      {/* Attention Banner Badge */}
      <View
        style={[
          styles.attentionBanner,
          attention.level === "critical" && styles.attentionBannerCritical,
          attention.level === "warning" && styles.attentionBannerWarning,
          attention.level === "active" && styles.attentionBannerActive,
          attention.level === "healthy" && styles.attentionBannerHealthy,
        ]}
      >
        <View style={styles.attentionBannerLeft}>
          {attention.level === "critical" ? (
            <AlertTriangle size={12} color="#f43f5e" />
          ) : attention.level === "warning" ? (
            <AlertCircle size={12} color="#f59e0b" />
          ) : attention.level === "active" ? (
            <Activity size={12} color="#06b6d4" />
          ) : (
            <CheckCircle2 size={12} color="#10b981" />
          )}
          <Text
            style={[
              styles.attentionBannerText,
              attention.level === "critical" && styles.attentionTextCritical,
              attention.level === "warning" && styles.attentionTextWarning,
              attention.level === "active" && styles.attentionTextActive,
              attention.level === "healthy" && styles.attentionTextHealthy,
            ]}
          >
            {attention.badgeLabel}
          </Text>
        </View>

        {node.trustScore !== undefined && node.trustScore !== null ? (
          <View style={styles.trustScoreChip}>
            <Text style={styles.trustScoreText}>Trust {Math.round(node.trustScore * 100)}%</Text>
          </View>
        ) : null}
      </View>

      {/* Node Header */}
      <View style={styles.cardHeader}>
        <View style={styles.nodeIdentity}>
          <View
            style={[
              styles.statusDot,
              attention.level === "critical"
                ? styles.dotCritical
                : isReady
                  ? styles.dotReady
                  : styles.dotDegraded,
            ]}
          />
          <Text style={styles.nodeId}>{node.displayName || node.id}</Text>
          {node.displayName && node.displayName !== node.id ? (
            <View style={styles.technicalIdBadge}>
              <Text style={styles.technicalIdText}>{node.id}</Text>
            </View>
          ) : null}
          <View
            style={[
              styles.tierBadge,
              isOpenCode ? styles.badgeOpencode : isUltra ? styles.badgeUltra : styles.badgePro,
            ]}
          >
            <Text
              style={[
                styles.tierBadgeText,
                isOpenCode ? styles.textOpencode : isUltra ? styles.textUltra : styles.textPro,
              ]}
            >
              {isOpenCode ? "OPENCODE FREE" : node.tier.toUpperCase()}
            </Text>
          </View>

          {node.label ? (
            <View style={styles.roleChip}>
              <Text style={styles.roleChipText}>{node.label}</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={handleCopyId}
          style={styles.copyIdBtn}
          accessibilityLabel="Copy Node ID"
        >
          {copied ? (
            <Check size={12} color="#10b981" />
          ) : (
            <Copy size={12} color={styles.iconMuted.color} />
          )}
        </Pressable>
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
        {isOpenCode ? (
          <View style={styles.opencodeFreeSection}>
            <View style={styles.opencodeFreeHeader}>
              <Sparkles size={12} color="#34d399" />
              <Text style={styles.opencodeFreeTitle}>OpenCode Free Quota • 100% Active</Text>
            </View>
            <Text style={styles.opencodeSandboxText} numberOfLines={1}>
              Workspace: nodes/{node.id}/workspace
            </Text>
          </View>
        ) : (
          <>
            {/* Gemini Quota Bar (Google CLI nodes only) */}
            {!isNebula ? (
              <View style={styles.quotaBarContainer}>
                <View style={styles.quotaBarHeader}>
                  <View style={styles.quotaLabelRow}>
                    <Text style={styles.quotaLabel}>Gemini Quota</Text>
                    {geminiCountdown ? (
                      <Text style={styles.countdownText}>⏳ {geminiCountdown}</Text>
                    ) : null}
                  </View>
                  <Text
                    style={[styles.quotaValue, geminiPercent <= 0 && styles.quotaValueCritical]}
                  >
                    {geminiPercent.toFixed(1)}%
                  </Text>
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
            ) : null}

            {/* Claude Quota Bar (for all Dual-Quota capable nodes) */}
            {hasClaudeSupport ? (
              <View style={styles.quotaBarContainer}>
                <View style={styles.quotaBarHeader}>
                  <View style={styles.quotaLabelRow}>
                    <Text style={styles.quotaLabel}>Claude Thinking</Text>
                    {claudeCountdown ? (
                      <Text style={styles.countdownText}>⏳ {claudeCountdown}</Text>
                    ) : null}
                  </View>
                  <Text
                    style={[styles.quotaValue, claudePercent <= 0 && styles.quotaValueCritical]}
                  >
                    {claudePercent.toFixed(1)}%
                  </Text>
                </View>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${Math.min(100, Math.max(0, claudePercent))}%` },
                      claudePercent <= 0 ? styles.barCritical : styles.barPurple,
                    ]}
                  />
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Model & Domain Specializations */}
      <View style={styles.specializationsContainer}>
        {node.preferredModel ? (
          <View style={styles.modelRow}>
            <Cpu size={11} color={styles.iconAccent.color} />
            <Text style={styles.modelName} numberOfLines={1}>
              {node.preferredModel}
            </Text>
          </View>
        ) : null}

        {node.domainSpecialization && node.domainSpecialization.length > 0 ? (
          <View style={styles.domainTagsRow}>
            {node.domainSpecialization.map((spec) => (
              <View key={spec} style={styles.domainTag}>
                <Text style={styles.domainTagText}>{spec.replace(/_/g, " ")}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* 4-Column Operational Telemetry Metrics */}
      <View style={styles.cardFooter}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>
            Served ({retentionPeriod === "all" ? "All" : retentionPeriod || "24h"})
          </Text>
          <Text style={styles.metricValue}>{node.requestsServed}</Text>
        </View>

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Reliability</Text>
          <Text
            style={[
              styles.metricValue,
              successRate < 90
                ? styles.errorText
                : successRate >= 99
                  ? styles.textMint
                  : styles.metricValue,
            ]}
          >
            {successRate}%
          </Text>
        </View>

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Active</Text>
          <Text
            style={[styles.metricValue, node.activeJobs > 0 ? styles.textCyan : styles.metricValue]}
          >
            {node.activeJobs > 0 ? `⚡ ${node.activeJobs}` : "0"}
          </Text>
        </View>

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>Errors</Text>
          <Text style={[styles.metricValue, node.errorCount > 0 && styles.errorText]}>
            {node.errorCount}
          </Text>
        </View>

        {node.tokensConsumed && node.tokensConsumed > 0 ? (
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Tokens</Text>
            <Text style={styles.metricTokensValue}>
              {node.tokensConsumed >= 1_000_000
                ? `${(node.tokensConsumed / 1_000_000).toFixed(1)}M`
                : node.tokensConsumed >= 1_000
                  ? `${Math.round(node.tokensConsumed / 1_000)}k`
                  : node.tokensConsumed}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface AddNodeModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

function AddNodeModal({ visible, onClose, onCreated }: AddNodeModalProps) {
  const [nodeType, setNodeType] = useState<"cli" | "api">("cli");
  const [name, setName] = useState("");
  const [tier, setTier] = useState<"pro" | "ultra">("pro");
  const [model, setModel] = useState("gemini-3.8-flash-high");
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState<"anthropic" | "openai" | "deepseek" | "b.ai">(
    "anthropic",
  );
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  if (!visible) return null;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setResult({ success: false, message: "Node name cannot be empty" });
      return;
    }
    setIsSubmitting(true);
    setResult(null);
    try {
      const url = nodeType === "cli" ? "/api/fleet/nodes/create" : "/api/fleet/nodes/create-api";
      const payload =
        nodeType === "cli"
          ? {
              name: name.trim(),
              tier,
              preferred_model: model,
              account_email: email.trim() || undefined,
            }
          : {
              name: name.trim(),
              tier,
              preferred_model: model,
              provider,
              api_key: apiKey.trim(),
              endpoint: endpoint.trim() || undefined,
            };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setResult({ success: true, message: `Node '${name}' created successfully!` });
        onCreated?.();
        setTimeout(() => {
          onClose();
          setName("");
          setApiKey("");
          setEmail("");
          setResult(null);
        }, 1000);
      } else {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        setResult({ success: false, message: err.error || "Failed to create node" });
      }
    } catch (e: any) {
      setResult({ success: false, message: e.message || "Network error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.modalOverlay}>
      <View style={styles.modalCard}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderTitleWrap}>
            <Cpu size={16} color="#10b981" />
            <Text style={styles.modalTitle}>Add Fleet Node Manual</Text>
          </View>
          <Pressable onPress={onClose} style={styles.modalCloseBtn}>
            <X size={16} color="#94a3b8" />
          </Pressable>
        </View>

        {/* Type Selector Tabs */}
        <View style={styles.modalTypeRow}>
          <Pressable
            onPress={() => {
              setNodeType("cli");
              setModel("gemini-3.8-flash-high");
            }}
            style={[styles.modalTypeBtn, nodeType === "cli" && styles.modalTypeBtnActive]}
          >
            <Cpu size={13} color={nodeType === "cli" ? "#10b981" : "#94a3b8"} />
            <Text
              style={[styles.modalTypeBtnText, nodeType === "cli" && styles.modalTypeBtnTextActive]}
            >
              Google CLI Node
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setNodeType("api");
              setModel("claude-3-7-sonnet");
            }}
            style={[styles.modalTypeBtn, nodeType === "api" && styles.modalTypeBtnActive]}
          >
            <Key size={13} color={nodeType === "api" ? "#a855f7" : "#94a3b8"} />
            <Text
              style={[styles.modalTypeBtnText, nodeType === "api" && styles.modalTypeBtnTextActive]}
            >
              API Key Node (Claude / OpenAI)
            </Text>
          </Pressable>
        </View>

        {/* Form Inputs */}
        <View style={styles.modalForm}>
          <View style={styles.modalField}>
            <Text style={styles.modalFieldLabel}>Node ID / Name *</Text>
            <TextInput
              initialValue={name}
              onChangeText={setName}
              placeholder={nodeType === "cli" ? "e.g. node-custom-7" : "e.g. my-claude-node"}
              placeholderTextColor="#64748b"
              style={styles.modalInput}
            />
          </View>

          {nodeType === "cli" ? (
            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Account Email (Optional)</Text>
              <TextInput
                initialValue={email}
                onChangeText={setEmail}
                placeholder="dev@example.com"
                placeholderTextColor="#64748b"
                style={styles.modalInput}
              />
            </View>
          ) : (
            <>
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>Provider</Text>
                <View style={styles.providerPills}>
                  {(["anthropic", "openai", "deepseek", "b.ai"] as const).map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setProvider(p)}
                      style={[styles.providerPill, provider === p && styles.providerPillActive]}
                    >
                      <Text
                        style={[
                          styles.providerPillText,
                          provider === p && styles.providerPillTextActive,
                        ]}
                      >
                        {p.toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>API Key *</Text>
                <TextInput
                  initialValue={apiKey}
                  onChangeText={setApiKey}
                  placeholder="sk-..."
                  placeholderTextColor="#64748b"
                  style={styles.modalInput}
                />
              </View>
            </>
          )}

          {/* Tier Selection */}
          <View style={styles.modalField}>
            <Text style={styles.modalFieldLabel}>Tier</Text>
            <View style={styles.tierSelectRow}>
              <Pressable
                onPress={() => setTier("pro")}
                style={[styles.tierSelectBtn, tier === "pro" && styles.tierSelectBtnActivePro]}
              >
                <Cpu size={12} color={tier === "pro" ? "#38bdf8" : "#94a3b8"} />
                <Text
                  style={[
                    styles.tierSelectBtnText,
                    tier === "pro" && styles.tierSelectBtnTextActivePro,
                  ]}
                >
                  PRO Tier
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTier("ultra")}
                style={[styles.tierSelectBtn, tier === "ultra" && styles.tierSelectBtnActiveUltra]}
              >
                <Zap size={12} color={tier === "ultra" ? "#fbbf24" : "#94a3b8"} />
                <Text
                  style={[
                    styles.tierSelectBtnText,
                    tier === "ultra" && styles.tierSelectBtnTextActiveUltra,
                  ]}
                >
                  ULTRA Tier
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Preferred Model */}
          <View style={styles.modalField}>
            <Text style={styles.modalFieldLabel}>Preferred Model</Text>
            <TextInput
              initialValue={model}
              onChangeText={setModel}
              placeholder={nodeType === "cli" ? "gemini-3.8-flash-high" : "claude-3-7-sonnet"}
              placeholderTextColor="#64748b"
              style={styles.modalInput}
            />
          </View>

          {/* Result Banner */}
          {result ? (
            <View
              style={[
                styles.resultBanner,
                result.success ? styles.resultBannerSuccess : styles.resultBannerError,
              ]}
            >
              {result.success ? (
                <CheckCircle2 size={14} color="#10b981" />
              ) : (
                <AlertCircle size={14} color="#f43f5e" />
              )}
              <Text
                style={[
                  styles.resultBannerText,
                  result.success ? styles.resultTextSuccess : styles.resultTextError,
                ]}
              >
                {result.message}
              </Text>
            </View>
          ) : null}

          {/* Submit Actions */}
          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={isSubmitting}
              style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
            >
              <Text style={styles.submitBtnText}>
                {isSubmitting ? "Creating..." : "Create Node"}
              </Text>
            </Pressable>
          </View>
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
  attentionSummaryBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: theme.colors.surface1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  attentionSummaryLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  attentionSummaryTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.foreground,
    letterSpacing: 0.2,
  },
  attentionPillCountWrap: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(244, 63, 94, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.4)",
  },
  attentionPillCountText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fb7185",
  },
  attentionHealthyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  attentionHealthyText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#34d399",
  },
  attentionFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  attentionQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(244, 63, 94, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.3)",
  },
  attentionQuickBtnActive: {
    backgroundColor: "rgba(244, 63, 94, 0.25)",
    borderColor: "#f43f5e",
  },
  attentionQuickBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#fb7185",
  },
  attentionQuickBtnTextActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  activeQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(6, 182, 212, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(6, 182, 212, 0.3)",
  },
  activeQuickBtnActive: {
    backgroundColor: "rgba(6, 182, 212, 0.25)",
    borderColor: "#06b6d4",
  },
  activeQuickBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#38bdf8",
  },
  activeQuickBtnTextActive: {
    color: "#ffffff",
    fontWeight: "700",
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
    flexWrap: "wrap",
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
  filterPillActiveOpencode: {
    backgroundColor: "#10b98126",
    borderColor: "#10b981",
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
  filterPillTextActiveOpencode: {
    color: "#34d399",
    fontWeight: "600",
  },
  retentionBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retentionLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginRight: 4,
  },
  retentionLabelTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  retentionPills: {
    flexDirection: "row",
    gap: 4,
  },
  retentionPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  retentionPillActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  retentionPillText: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    fontWeight: "500",
  },
  retentionPillTextActive: {
    color: theme.colors.accentForeground,
    fontWeight: "600",
  },
  retentionSummary: {
    marginLeft: "auto",
  },
  retentionSummaryText: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    fontStyle: "italic",
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
    minWidth: 300,
    maxWidth: 460,
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 10,
  },
  cardCritical: {
    borderColor: "rgba(244, 63, 94, 0.7)",
    backgroundColor: "rgba(244, 63, 94, 0.05)",
  },
  cardWarning: {
    borderColor: "rgba(245, 158, 11, 0.6)",
    backgroundColor: "rgba(245, 158, 11, 0.04)",
  },
  cardActive: {
    borderColor: "rgba(6, 182, 212, 0.7)",
    backgroundColor: "rgba(6, 182, 212, 0.04)",
  },
  cardUltra: {
    borderColor: theme.colors.statusMerged,
    backgroundColor: theme.colors.surface1,
  },
  cardOpencode: {
    borderColor: "#10b98160",
    backgroundColor: theme.colors.surface1,
  },
  attentionBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  attentionBannerCritical: {
    backgroundColor: "rgba(244, 63, 94, 0.12)",
    borderColor: "rgba(244, 63, 94, 0.3)",
  },
  attentionBannerWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  attentionBannerActive: {
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    borderColor: "rgba(6, 182, 212, 0.3)",
  },
  attentionBannerHealthy: {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderColor: "rgba(16, 185, 129, 0.2)",
  },
  attentionBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  attentionBannerText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  attentionTextCritical: {
    color: "#fb7185",
  },
  attentionTextWarning: {
    color: "#f59e0b",
  },
  attentionTextActive: {
    color: "#38bdf8",
  },
  attentionTextHealthy: {
    color: "#34d399",
  },
  trustScoreChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: theme.colors.surface2,
  },
  trustScoreText: {
    fontSize: 9,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
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
    flexWrap: "wrap",
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
  dotCritical: {
    backgroundColor: "#f43f5e",
  },
  nodeId: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  technicalIdBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  technicalIdText: {
    fontSize: 10,
    fontFamily: "monospace",
    color: theme.colors.foregroundMuted,
    fontWeight: "600",
  },
  copyIdBtn: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: theme.colors.surface2,
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
  badgeOpencode: {
    backgroundColor: "#10b98126",
    borderWidth: 1,
    borderColor: "#10b981",
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
  textOpencode: {
    color: "#34d399",
  },
  roleChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  roleChipText: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.accent,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  accountText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    flex: 1,
    fontFamily: "monospace",
  },
  quotaSection: {
    gap: 8,
  },
  quotaBarContainer: {
    gap: 4,
  },
  quotaBarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quotaLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quotaLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  countdownText: {
    fontSize: 10,
    color: theme.colors.accent,
    fontFamily: "monospace",
  },
  quotaValue: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  quotaValueCritical: {
    color: "#f43f5e",
    fontWeight: "700",
  },
  progressBarBg: {
    height: 6,
    backgroundColor: theme.colors.surface2,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  barHealthy: {
    backgroundColor: theme.colors.statusDotSuccess,
  },
  barWarning: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  barCritical: {
    backgroundColor: "#f43f5e",
  },
  barPurple: {
    backgroundColor: theme.colors.statusMerged,
  },
  opencodeFreeSection: {
    backgroundColor: "#10b98115",
    borderWidth: 1,
    borderColor: "#10b98140",
    borderRadius: 8,
    padding: 8,
    gap: 4,
  },
  opencodeFreeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  opencodeFreeTitle: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "600",
  },
  opencodeSandboxText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontFamily: "monospace",
  },
  specializationsContainer: {
    gap: 6,
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  modelName: {
    color: theme.colors.foreground,
    fontSize: 11,
    fontFamily: "monospace",
  },
  domainTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  domainTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  domainTagText: {
    fontSize: 9,
    fontWeight: "500",
    color: theme.colors.foregroundMuted,
    textTransform: "capitalize",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    flexWrap: "wrap",
    gap: 6,
  },
  metricItem: {
    alignItems: "flex-start",
    minWidth: 48,
  },
  metricLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  metricValue: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  metricTokensValue: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  errorText: {
    color: "#f43f5e",
  },
  textMint: {
    color: "#34d399",
  },
  textCyan: {
    color: "#38bdf8",
  },
  addNodeQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
  },
  addNodeQuickBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#34d399",
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 20,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalHeaderTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 6,
  },
  modalTypeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modalTypeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalTypeBtnActive: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderColor: "#10b981",
  },
  modalTypeBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
  },
  modalTypeBtnTextActive: {
    color: "#34d399",
  },
  modalForm: {
    gap: 12,
  },
  modalField: {
    gap: 6,
  },
  modalFieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  modalInput: {
    height: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 10,
    fontSize: 13,
    color: theme.colors.foreground,
  },
  providerPills: {
    flexDirection: "row",
    gap: 6,
  },
  providerPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  providerPillActive: {
    backgroundColor: "rgba(168, 85, 247, 0.2)",
    borderColor: "#a855f7",
  },
  providerPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
  },
  providerPillTextActive: {
    color: "#c084fc",
  },
  tierSelectRow: {
    flexDirection: "row",
    gap: 8,
  },
  tierSelectBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tierSelectBtnActivePro: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderColor: "#38bdf8",
  },
  tierSelectBtnActiveUltra: {
    backgroundColor: "rgba(251, 191, 36, 0.15)",
    borderColor: "#fbbf24",
  },
  tierSelectBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
  },
  tierSelectBtnTextActivePro: {
    color: "#38bdf8",
  },
  tierSelectBtnTextActiveUltra: {
    color: "#fbbf24",
  },
  resultBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  resultBannerSuccess: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  resultBannerError: {
    backgroundColor: "rgba(244, 63, 94, 0.12)",
    borderColor: "rgba(244, 63, 94, 0.3)",
  },
  resultBannerText: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  resultTextSuccess: {
    color: "#34d399",
  },
  resultTextError: {
    color: "#fb7185",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  cancelBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
  },
  submitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#10b981",
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
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
