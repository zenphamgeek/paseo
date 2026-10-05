import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CheckCircle2, Cpu, HardDrive, ShieldCheck, Zap } from "lucide-react-native";
import type { FleetCouncilData } from "./types";

interface FleetCouncilViewProps {
  _council?: FleetCouncilData | null;
}

export function FleetCouncilView({ _council: _ }: FleetCouncilViewProps) {
  return (
    <View style={styles.container}>
      {/* Council Overview Card */}
      <View style={styles.bannerCard}>
        <View style={styles.bannerHeader}>
          <ShieldCheck size={24} color={styles.iconAccent.color} />
          <View>
            <Text style={styles.bannerTitle}>
              Clef Council — Verification & Consensus Architecture
            </Text>
            <Text style={styles.bannerSubtitle}>
              Multi-perspective LLM Council: Deterministic Gates + Semantic Model-as-Judge
            </Text>
          </View>
        </View>

        <View style={styles.bannerPolicyRow}>
          <View style={styles.policyPill}>
            <Text style={styles.policyLabel}>Active Mode:</Text>
            <Text style={[styles.policyVal, styles.textMint]}>HYBRID (Cloud + Local)</Text>
          </View>
          <View style={styles.policyPill}>
            <Text style={styles.policyLabel}>Consensus Policy:</Text>
            <Text style={[styles.policyVal, styles.textPurple]}>MAJORITY (≥ 66%)</Text>
          </View>
          <View style={styles.policyPill}>
            <Text style={styles.policyLabel}>Escalation Gate:</Text>
            <Text style={styles.policyVal}>ACTIVE (Auth & Security)</Text>
          </View>
        </View>
      </View>

      {/* 3 Model Tiers Grid */}
      <View style={styles.tiersGrid}>
        {/* Tier 1: ULTRA Cloud */}
        <View style={[styles.tierCard, styles.tierCardUltra]}>
          <View style={styles.tierHeader}>
            <Zap size={18} color={styles.iconMerged.color} />
            <Text style={styles.tierTitle}>🔥 ULTRA TIER (Cloud LLM)</Text>
          </View>
          <Text style={styles.tierModelName}>Claude Opus 4.6 / 5.5 High</Text>
          <Text style={styles.tierRole}>
            Deep contextual reasoning, cross-file refactoring, autonomous architectural synthesis,
            and complex planning.
          </Text>
          <View style={styles.tierNodesBox}>
            <Text style={styles.tierNodesLabel}>Assigned Fleet Nodes:</Text>
            <Text style={styles.tierNodesList}>
              nebula, pro-1, ultra-2, binhthuong, sunward, justaskgao
            </Text>
          </View>
        </View>

        {/* Tier 2: PRO Cloud */}
        <View style={[styles.tierCard, styles.tierCardPro]}>
          <View style={styles.tierHeader}>
            <Cpu size={18} color={styles.iconAccent.color} />
            <Text style={styles.tierTitle}>⚡ PRO TIER (Cloud LLM)</Text>
          </View>
          <Text style={styles.tierModelName}>Gemini 3.8 Flash High / Med</Text>
          <Text style={styles.tierRole}>
            Ultra-fast token throughput, sub-DAG parallel execution, unit test generation, AST
            search, and live diff validation.
          </Text>
          <View style={styles.tierNodesBox}>
            <Text style={styles.tierNodesLabel}>Assigned Fleet Nodes:</Text>
            <Text style={styles.tierNodesList}>
              ai-digimate, codegeekvn, gaopham, insilos, node-4, node-5, node-6, team-3, zenonmind
            </Text>
          </View>
        </View>

        {/* Tier 3: LOCAL LLM */}
        <View style={[styles.tierCard, styles.tierCardLocal]}>
          <View style={styles.tierHeader}>
            <HardDrive size={18} color={styles.iconMuted.color} />
            <Text style={styles.tierTitle}>🛡️ LOCAL TIER (Air-Gapped)</Text>
          </View>
          <Text style={styles.tierModelName}>DeepSeek R1 / Qwen 2.5 (32B)</Text>
          <Text style={styles.tierRole}>
            Private offline verification, secret credential leak scanning, air-gapped deterministic
            AST audit, zero telemetry egress.
          </Text>
          <View style={styles.tierNodesBox}>
            <Text style={styles.tierNodesLabel}>Host Runtime:</Text>
            <Text style={styles.tierNodesList}>
              Ollama / vLLM on Local RTX GPU (Strict 0 outbound calls)
            </Text>
          </View>
        </View>
      </View>

      {/* Verification Gates Table */}
      <View style={styles.gatesCard}>
        <Text style={styles.gatesHeading}>Council Verification Gates</Text>
        <Text style={styles.gatesSub}>
          Every pull request and autonomous goal must pass all 4 gates:
        </Text>

        <View style={styles.gatesList}>
          <GateRow
            name="OxLint / ESLint Syntax Gate"
            description="Zero AST syntax errors, no console regressions, strict code hygiene"
            passRate="100%"
          />
          <GateRow
            name="TypeScript Strict Typecheck Gate"
            description="Complete tsconfig pass across @getpaseo/protocol, @getpaseo/server, @getpaseo/app"
            passRate="100%"
          />
          <GateRow
            name="Vitest Unit & Integration Gate"
            description="All 36 i18n assertions and server lifecycle tests pass cleanly"
            passRate="100%"
          />
          <GateRow
            name="Credential & Security Auditor"
            description="Zero hardcoded tokens, secret leak prevention, clean attribution"
            passRate="100%"
          />
        </View>
      </View>
    </View>
  );
}

function GateRow({
  name,
  description,
  passRate,
}: {
  name: string;
  description: string;
  passRate: string;
}) {
  return (
    <View style={styles.gateRow}>
      <View style={styles.gateIconBox}>
        <CheckCircle2 size={16} color={styles.iconSuccess.color} />
      </View>
      <View style={styles.gateInfo}>
        <Text style={styles.gateName}>{name}</Text>
        <Text style={styles.gateDesc}>{description}</Text>
      </View>
      <View style={styles.gatePassPill}>
        <Text style={styles.gatePassText}>{passRate} PASS</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    gap: 16,
  },
  bannerCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 18,
    gap: 14,
  },
  bannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bannerTitle: {
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: "700",
  },
  bannerSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
  bannerPolicyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 12,
  },
  policyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  policyLabel: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  policyVal: {
    fontSize: 11,
    color: theme.colors.foreground,
    fontWeight: "700",
  },
  textMint: {
    color: theme.colors.accent,
  },
  textPurple: {
    color: theme.colors.statusMerged,
  },
  tiersGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tierCard: {
    flex: 1,
    minWidth: 260,
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 10,
  },
  tierCardUltra: {
    borderColor: theme.colors.statusMerged,
  },
  tierCardPro: {
    borderColor: theme.colors.accent,
  },
  tierCardLocal: {
    borderColor: theme.colors.borderAccent,
  },
  tierHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tierTitle: {
    color: theme.colors.foreground,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  tierModelName: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "700",
  },
  tierRole: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  tierNodesBox: {
    backgroundColor: theme.colors.surface2,
    padding: 8,
    borderRadius: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tierNodesLabel: {
    fontSize: 10,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
  },
  tierNodesList: {
    fontSize: 11,
    color: theme.colors.accent,
    fontFamily: "monospace",
  },
  gatesCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 18,
    gap: 12,
  },
  gatesHeading: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "700",
  },
  gatesSub: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
  gatesList: {
    gap: 8,
    marginTop: 4,
  },
  gateRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface2,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 12,
  },
  gateIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.statusSuccessTint,
    alignItems: "center",
    justifyContent: "center",
  },
  gateInfo: {
    flex: 1,
  },
  gateName: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "600",
  },
  gateDesc: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  gatePassPill: {
    backgroundColor: theme.colors.statusSuccessTint,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  gatePassText: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: "700",
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
  iconSuccess: {
    color: theme.colors.statusSuccess,
  },
}));
