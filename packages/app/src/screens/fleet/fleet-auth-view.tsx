import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { StyleSheet } from "react-native-unistyles";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Cpu,
  FolderSync,
  Key,
  Lock,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react-native";
import { ServiceAppIcon } from "./service-app-icon";
import type { EcosystemType, FleetAuthMatrix, PluginOAuthStatus } from "./types";

interface FleetAuthViewProps {
  authStatus: FleetAuthMatrix | null;
  isLoading: boolean;
  onRefresh: () => void;
  onAutoConfig: () => Promise<unknown>;
  onSaveManualAuth: (
    provider: string,
    token: string,
    authType?: string,
    account?: string,
  ) => Promise<boolean>;
}

const ECOSYSTEM_LABELS: Record<
  EcosystemType,
  { title: string; desc: string; icon: React.ComponentType<{ size: number; color: string }> }
> = {
  agy: {
    title: "Google Antigravity (AGY)",
    desc: "Autonomous agent CLI, Multi-Node Swarm & Gemini Pro/Flash tokens",
    icon: Cpu,
  },
  opencode: {
    title: "OpenCode & 9Router",
    desc: "OpenCode Engine, 9Router high-concurrency gateway & Go usage",
    icon: Zap,
  },
  codex: {
    title: "OpenAI Codex & Claude",
    desc: "Pi / OMP agent stores, Codex CLI & Anthropic Claude reasoning engines",
    icon: Bot,
  },
  paseo: {
    title: "Paseo Core Plugins",
    desc: "Copilot, Cursor, Grok, Kimi, MiniMax, ZAI & Muse engines",
    icon: Sparkles,
  },
  infra: {
    title: "VCS & Alert Infrastructure",
    desc: "GitHub CLI OAuth sessions and Telegram incident broadcast gateway",
    icon: Terminal,
  },
  workspace: {
    title: "Workspace & Design Integrations (Codex Engine)",
    desc: "Figma (Design-to-Code), Google Drive (PRDs/Sheets), Canva (Visuals), Notion & Linear",
    icon: FolderSync,
  },
};

function StatusBadge({
  status,
  authType,
}: {
  status: PluginOAuthStatus["status"];
  authType: PluginOAuthStatus["authType"];
}) {
  if (status === "authenticated") {
    let label = "AUTHENTICATED";
    if (authType === "cli_session") label = "CLI ACTIVE";
    else if (authType === "oauth") label = "OAUTH OK";
    else if (authType === "api_key") label = "API KEY OK";

    return (
      <View style={[styles.badge, styles.badgeGreen]}>
        <CheckCircle2 size={11} color={styles.textGreen.color} />
        <Text style={[styles.badgeText, styles.textGreen]}>{label}</Text>
      </View>
    );
  }

  if (status === "discovered") {
    return (
      <View style={[styles.badge, styles.badgeAmber]}>
        <FolderSync size={11} color={styles.textAmber.color} />
        <Text style={[styles.badgeText, styles.textAmber]}>DISCOVERED</Text>
      </View>
    );
  }

  return (
    <View style={[styles.badge, styles.badgeMuted]}>
      <AlertCircle size={11} color={styles.textMuted.color} />
      <Text style={[styles.badgeText, styles.textMuted]}>NOT CONFIGURED</Text>
    </View>
  );
}

interface ProviderCardProps {
  item: PluginOAuthStatus;
  onOpenConfig: (item: PluginOAuthStatus) => void;
}

function ProviderCard({ item, onOpenConfig }: ProviderCardProps) {
  const isAuth = item.status === "authenticated";
  const handlePress = useCallback(() => {
    onOpenConfig(item);
  }, [item, onOpenConfig]);

  return (
    <View
      style={[styles.providerCard, isAuth && styles.providerCardActive]}
      testID={`auth-card-${item.provider}`}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.cardHeaderLeftGroup}>
          <ServiceAppIcon provider={item.provider} size={22} badgeSize={38} showBadge />
          <View style={styles.cardHeaderInfo}>
            <Text style={styles.providerName}>{item.label}</Text>
            <Text style={styles.providerKeyId}>{item.provider}</Text>
          </View>
        </View>
        <StatusBadge status={item.status} authType={item.authType} />
      </View>

      <View style={styles.detailsBlock}>
        {item.account ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Account / Session:</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {item.account}
            </Text>
          </View>
        ) : null}

        {item.maskedToken ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Credential Vault:</Text>
            <View style={styles.tokenPill}>
              <Lock size={10} color={styles.accentText.color} />
              <Text style={styles.tokenText}>{item.maskedToken}</Text>
            </View>
          </View>
        ) : null}

        {item.source ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Discovery Source:</Text>
            <Text style={styles.sourceText} numberOfLines={1}>
              {item.source}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <Pressable
          style={styles.cardActionBtn}
          onPress={handlePress}
          testID={`config-btn-${item.provider}`}
        >
          <Key size={12} color={styles.accentText.color} />
          <Text style={styles.cardActionBtnText}>
            {isAuth ? "Update Key / Re-auth" : "1-Click Setup"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function FleetAuthView({
  authStatus,
  isLoading,
  onRefresh,
  onAutoConfig,
  onSaveManualAuth,
}: FleetAuthViewProps) {
  const [isAutoConfiguring, setIsAutoConfiguring] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<PluginOAuthStatus | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [manualAccount, setManualAccount] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const handleRunAutoConfig = useCallback(async () => {
    setIsAutoConfiguring(true);
    try {
      await onAutoConfig();
      setActionSuccessMsg(
        "Zero-config credential auto-discovery finished! Synchronized with stores.",
      );
      setTimeout(() => setActionSuccessMsg(null), 4000);
    } catch {
      // Ignore
    } finally {
      setIsAutoConfiguring(false);
    }
  }, [onAutoConfig]);

  const handleOpenModal = useCallback((item: PluginOAuthStatus) => {
    setSelectedProvider(item);
    setManualToken("");
    setManualAccount(item.account || "");
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedProvider(null);
    setManualToken("");
    setManualAccount("");
  }, []);

  const handleSaveManual = useCallback(async () => {
    if (!selectedProvider || !manualToken.trim()) return;
    setIsSaving(true);
    try {
      const ok = await onSaveManualAuth(
        selectedProvider.provider,
        manualToken.trim(),
        "api_key",
        manualAccount.trim() || undefined,
      );
      if (ok) {
        setActionSuccessMsg(`Credentials for ${selectedProvider.label} saved and synchronized!`);
        setTimeout(() => setActionSuccessMsg(null), 4000);
        handleCloseModal();
      }
    } finally {
      setIsSaving(false);
    }
  }, [selectedProvider, manualToken, manualAccount, onSaveManualAuth, handleCloseModal]);

  const grouped = useMemo(() => {
    const groups: Record<EcosystemType, PluginOAuthStatus[]> = {
      agy: [],
      opencode: [],
      codex: [],
      workspace: [],
      paseo: [],
      infra: [],
    };

    if (!authStatus) return groups;

    const q = searchQuery.toLowerCase().trim();

    for (const item of Object.values(authStatus)) {
      if (
        q &&
        !item.provider.toLowerCase().includes(q) &&
        !item.label.toLowerCase().includes(q) &&
        !(item.ecosystem && item.ecosystem.toLowerCase().includes(q)) &&
        !(item.account && item.account.toLowerCase().includes(q))
      ) {
        continue;
      }

      const eco: EcosystemType = item.ecosystem || "paseo";
      if (groups[eco]) {
        groups[eco].push(item);
      } else {
        groups.paseo.push(item);
      }
    }

    return groups;
  }, [authStatus, searchQuery]);

  const stats = useMemo(() => {
    if (!authStatus) return { total: 0, authCount: 0, percent: 0 };
    const items = Object.values(authStatus);
    const authCount = items.filter((i) => i.status === "authenticated").length;
    const total = items.length;
    const percent = total > 0 ? Math.round((authCount / total) * 100) : 0;
    return { total, authCount, percent };
  }, [authStatus]);

  if (isLoading && !authStatus) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={styles.accentText.color} />
        <Text style={styles.loadingText}>Loading Universal OAuth & Plugin Matrix...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Top Banner & Control Deck */}
      <View style={styles.topBanner}>
        <View style={styles.bannerInfo}>
          <View style={styles.titleRow}>
            <ShieldCheck size={22} color={styles.accentText.color} />
            <Text style={styles.bannerTitle}>Universal OAuth & Plugin Ecosystem</Text>
          </View>
          <Text style={styles.bannerDesc}>
            Zero-config credential auto-discovery & bidirectional sync across Paseo, Codex, AGY, and
            OpenCode.
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Configured Plugins:</Text>
              <Text style={styles.statVal}>
                {stats.authCount} / {stats.total} ({stats.percent}%)
              </Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Sync Target:</Text>
              <Text style={[styles.statVal, styles.textGreen]}>
                ~/.pi/agent & ~/.local/share & ENV
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.bannerActions}>
          <Pressable
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={handleRunAutoConfig}
            disabled={isAutoConfiguring}
            testID="btn-autoconfig-all"
          >
            {isAutoConfiguring ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <FolderSync size={14} color="#fff" />
            )}
            <Text style={styles.primaryBtnText}>
              {isAutoConfiguring ? "Scanning..." : "1-Click Auto-Discover"}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.actionBtn, styles.secondaryBtn]}
            onPress={onRefresh}
            testID="btn-refresh-auth"
          >
            <RefreshCw size={13} color={styles.accentText.color} />
            <Text style={styles.secondaryBtnText}>Refresh</Text>
          </Pressable>
        </View>
      </View>

      {/* Success Notification Bar */}
      {actionSuccessMsg ? (
        <View style={styles.notificationBar}>
          <CheckCircle2 size={16} color={styles.textGreen.color} />
          <Text style={styles.notificationText}>{actionSuccessMsg}</Text>
        </View>
      ) : null}

      {/* Search & Filter Bar */}
      <View style={styles.searchBar}>
        <Search size={14} color={styles.textMuted.color} />
        <AdaptiveTextInput
          style={styles.searchInput}
          placeholder="Filter services & plugins (e.g. Figma, Drive, Notion, Telegram, Claude, Codex, Copilot)..."
          placeholderTextColor={styles.textMuted.color}
          initialValue={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.trim() ? (
          <Pressable onPress={() => setSearchQuery("")} style={styles.searchClearBtn}>
            <Text style={styles.searchClearText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Ecosystem Groups */}
      {(["agy", "opencode", "codex", "workspace", "paseo", "infra"] as EcosystemType[]).map(
        (ecoKey) => {
          const ecoMeta = ECOSYSTEM_LABELS[ecoKey];
          const plugins = grouped[ecoKey];
          const IconComponent = ecoMeta.icon;

          if (!plugins || plugins.length === 0) return null;

          return (
            <View key={ecoKey} style={styles.ecosystemSection}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <IconComponent size={18} color={styles.accentText.color} />
                  <View>
                    <Text style={styles.sectionTitle}>{ecoMeta.title}</Text>
                    <Text style={styles.sectionDesc}>{ecoMeta.desc}</Text>
                  </View>
                </View>
                <View style={styles.sectionCountPill}>
                  <Text style={styles.sectionCountText}>
                    {plugins.filter((p) => p.status === "authenticated").length}/{plugins.length}{" "}
                    ACTIVE
                  </Text>
                </View>
              </View>

              <View style={styles.cardsGrid}>
                {plugins.map((plugin) => (
                  <ProviderCard
                    key={plugin.provider}
                    item={plugin}
                    onOpenConfig={handleOpenModal}
                  />
                ))}
              </View>
            </View>
          );
        },
      )}

      {/* Manual Configuration Modal */}
      {selectedProvider ? (
        <Modal
          visible={!!selectedProvider}
          transparent
          animationType="fade"
          onRequestClose={handleCloseModal}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalDialog}>
              <View style={styles.modalHeader}>
                <ServiceAppIcon
                  provider={selectedProvider.provider}
                  size={24}
                  badgeSize={42}
                  showBadge
                />
                <View style={styles.modalTitleWrap}>
                  <Text style={styles.modalTitle}>Configure {selectedProvider.label}</Text>
                  <Text style={styles.modalSubtitleId}>{selectedProvider.provider}</Text>
                </View>
              </View>
              <Text style={styles.modalSubtitle}>
                Enter your API Key, OAuth token, or session secret. It will be stored in your
                encrypted local vault and synced into the plugin runtime.
              </Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Token / API Key *</Text>
                <AdaptiveTextInput
                  style={styles.textInput}
                  placeholder="e.g. sk-..., bearer token, or session key"
                  placeholderTextColor={styles.textMuted.color}
                  initialValue={manualToken}
                  onChangeText={setManualToken}
                  secureTextEntry
                  autoCapitalize="none"
                  testID="input-manual-token"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Account Name or Alias (Optional)</Text>
                <AdaptiveTextInput
                  style={styles.textInput}
                  placeholder="e.g. primary-production or user alias"
                  placeholderTextColor={styles.textMuted.color}
                  initialValue={manualAccount}
                  onChangeText={setManualAccount}
                  autoCapitalize="none"
                  testID="input-manual-account"
                />
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  style={[styles.modalBtn, styles.modalCancelBtn]}
                  onPress={handleCloseModal}
                  disabled={isSaving}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </Pressable>

                <Pressable
                  style={[styles.modalBtn, styles.modalSubmitBtn]}
                  onPress={handleSaveManual}
                  disabled={isSaving || !manualToken.trim()}
                  testID="btn-submit-manual-auth"
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <PlusCircle size={14} color="#fff" />
                  )}
                  <Text style={styles.modalSubmitBtnText}>
                    {isSaving ? "Saving..." : "Save & Sync"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    padding: 16,
    gap: 20,
    paddingBottom: 40,
  },
  centerContainer: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
  },
  topBanner: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
  },
  bannerInfo: {
    flex: 1,
    minWidth: 280,
    gap: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bannerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  bannerDesc: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
    flexWrap: "wrap",
  },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statLabel: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  statVal: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  bannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  primaryBtn: {
    backgroundColor: theme.colors.accent,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  secondaryBtn: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryBtnText: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "500",
  },
  notificationBar: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.statusDotSuccess,
    borderRadius: 8,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  notificationText: {
    fontSize: 13,
    color: theme.colors.foreground,
    fontWeight: "500",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 13,
    padding: 0,
  },
  searchClearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
  },
  searchClearText: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    fontWeight: "600",
  },
  ecosystemSection: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: 8,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  sectionDesc: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  sectionCountPill: {
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionCountText: {
    fontSize: 10,
    fontWeight: "700",
    color: theme.colors.accent,
    letterSpacing: 0.5,
  },
  cardsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  providerCard: {
    flex: 1,
    minWidth: 280,
    maxWidth: 520,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  providerCardActive: {
    borderColor: theme.colors.border,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardHeaderLeftGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardHeaderInfo: {
    flex: 1,
    gap: 2,
  },
  providerName: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  providerKeyId: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    fontFamily: "monospace",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  badgeGreen: {
    backgroundColor: "rgba(34, 197, 94, 0.12)",
  },
  badgeAmber: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
  },
  badgeMuted: {
    backgroundColor: theme.colors.surface2,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  detailsBlock: {
    gap: 6,
    backgroundColor: theme.colors.surface2,
    borderRadius: 6,
    padding: 8,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  detailLabel: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  detailValue: {
    fontSize: 11,
    color: theme.colors.foreground,
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },
  tokenPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tokenText: {
    fontSize: 10,
    fontFamily: "monospace",
    color: theme.colors.accent,
  },
  sourceText: {
    fontSize: 10,
    fontFamily: "monospace",
    color: theme.colors.foregroundMuted,
    flex: 1,
    textAlign: "right",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  cardActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardActionBtnText: {
    fontSize: 11,
    color: theme.colors.foreground,
    fontWeight: "600",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalDialog: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: theme.colors.surface1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 20,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  modalTitleWrap: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  modalSubtitleId: {
    fontSize: 11,
    fontFamily: "monospace",
    color: theme.colors.foregroundMuted,
  },
  modalSubtitle: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  textInput: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: theme.colors.foreground,
    fontFamily: "monospace",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modalCancelBtn: {
    backgroundColor: theme.colors.surface2,
  },
  modalCancelBtnText: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  modalSubmitBtn: {
    backgroundColor: theme.colors.accent,
  },
  modalSubmitBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  // Helpers
  accentText: {
    color: theme.colors.accent,
  },
  textGreen: {
    color: theme.colors.statusDotSuccess,
  },
  textAmber: {
    color: "#f59e0b",
  },
  textMuted: {
    color: theme.colors.foregroundMuted,
  },
}));
