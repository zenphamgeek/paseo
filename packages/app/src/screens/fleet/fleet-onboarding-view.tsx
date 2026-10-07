import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { StyleSheet } from "react-native-unistyles";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Globe,
  Key,
  Lock,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react-native";

export interface UserFleetQuotas {
  llm: {
    enabled: boolean;
    tier: string;
    dailyTokenBudget: number;
    usedTodayTokens: number;
    allowedModels: string[];
    allowClaudeOpus: boolean;
  };
  modal_gpu: {
    enabled: boolean;
    dailyGpuMinutes: number;
    usedTodayMinutes: number;
    allowedApps: string[];
  };
  cloudflare_clef: {
    enabled: boolean;
    dailyRequests: number;
    usedTodayRequests: number;
  };
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  keyPrefix: string;
  allowedFleets: string[];
  quotas: UserFleetQuotas;
}

interface FleetOnboardingViewProps {
  onPasskeyAuthenticated?: (user: AuthenticatedUser) => void;
}

export function FleetOnboardingView({ onPasskeyAuthenticated }: FleetOnboardingViewProps) {
  const [passkeyInput, setPasskeyInput] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [activeTab, setActiveTab] = useState<"choice1" | "choice2" | "choice3">("choice1");
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [isPinging, setIsPinging] = useState(false);

  // Check existing session from localStorage
  useEffect(() => {
    try {
      const storedKey =
        typeof window !== "undefined" ? window.localStorage?.getItem("zencode_access_token") : null;
      if (storedKey) {
        verifyKey(storedKey, false);
      }
    } catch {
      // ignore
    }
  }, []);

  const verifyKey = async (keyToVerify: string, updateInput = true) => {
    if (!keyToVerify.trim()) {
      setErrorMsg("Vui lòng nhập Passkey do Admin cấp");
      return;
    }

    setIsVerifying(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/auth/verify-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyToVerify.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.valid) {
        throw new Error(data.error || "Passkey không hợp lệ hoặc đã bị thu hồi");
      }

      const user = data.user as AuthenticatedUser;
      setCurrentUser(user);
      if (typeof window !== "undefined") {
        window.localStorage?.setItem("zencode_access_token", keyToVerify.trim());
        window.localStorage?.setItem("zencode_user_role", user.role);
        window.localStorage?.setItem("zencode_user_name", user.username);
      }
      if (updateInput) {
        setPasskeyInput("");
      }
      onPasskeyAuthenticated?.(user);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDisconnect = () => {
    setCurrentUser(null);
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem("zencode_access_token");
      window.localStorage?.removeItem("zencode_user_role");
      window.localStorage?.removeItem("zencode_user_name");
    }
  };

  const handlePing = async () => {
    setIsPinging(true);
    const start = performance.now();
    try {
      await fetch("/api/fleet/status");
      setPingLatency(Math.round(performance.now() - start));
    } catch {
      setPingLatency(-1);
    } finally {
      setIsPinging(false);
    }
  };

  const handleCopy = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    }
  };

  const isLlmAllowed = currentUser?.allowedFleets.includes("llm") ?? false;
  const isGpuAllowed = currentUser?.allowedFleets.includes("modal_gpu") ?? false;
  const isClefAllowed = currentUser?.allowedFleets.includes("cloudflare_clef") ?? false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Hero Banner */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.iconCircle}>
            <Key size={22} color={styles.accentColor.color} />
          </View>
          <View style={styles.heroTextCol}>
            <Text style={styles.heroTitle}>Zencode Fleet Onboarding & Access Gateway</Text>
            <Text style={styles.heroSubtitle}>
              Xác thực Passkey tức thì • Cấp quyền truy cập 3 Fleets • Hướng dẫn Onboarding chuẩn
              xác
            </Text>
          </View>
        </View>
      </View>

      {/* Section 1: Passkey Login & Session Status */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <ShieldCheck size={18} color={styles.accentColor.color} />
          <Text style={styles.cardTitle}>1. XÁC THỰC ACCESS PASSKEY</Text>
        </View>

        {currentUser ? (
          <View style={styles.activeSessionBox}>
            <View style={styles.activeSessionHeader}>
              <View style={styles.statusPill}>
                <View style={styles.dotGreen} />
                <Text style={styles.statusPillText}>PHIÊN ĐĂNG NHẬP HOẠT ĐỘNG</Text>
              </View>
              <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
                <Text style={styles.disconnectBtnText}>Đổi Passkey</Text>
              </Pressable>
            </View>

            <View style={styles.userInfoRow}>
              <View style={styles.infoCol}>
                <Text style={styles.infoLabel}>Tài khoản</Text>
                <Text style={styles.infoValue}>
                  {currentUser.displayName} (@{currentUser.username})
                </Text>
              </View>
              <View style={styles.infoCol}>
                <Text style={styles.infoLabel}>Vai trò</Text>
                <Text style={styles.infoValueRole}>{currentUser.role.toUpperCase()}</Text>
              </View>
              <View style={styles.infoCol}>
                <Text style={styles.infoLabel}>Passkey</Text>
                <Text style={styles.infoValueMono}>{currentUser.keyPrefix}</Text>
              </View>
            </View>

            <Pressable
              onPress={() => router.replace("/")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: "#0284c7",
                paddingVertical: 12,
                borderRadius: 8,
                marginTop: 14,
              }}
            >
              <Rocket size={15} color="#ffffff" />
              <Text style={{ color: "#ffffff", fontWeight: "700", fontSize: 13 }}>
                🚀 Bắt Đầu Lập Trình Ngay (Vào Không Gian Làm Việc)
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.loginBox}>
            <Text style={styles.instructionText}>
              Nhập mã Access Passkey do Server Admin cấp để mở khóa các cụm Fleet:
            </Text>
            <View style={styles.inputRow}>
              <View style={styles.inputWrapper}>
                <AdaptiveTextInput
                  value={passkeyInput}
                  onChangeText={setPasskeyInput}
                  placeholder="zen_live_dev_..."
                  placeholderTextColor="#64748b"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={false}
                  style={styles.keyInput}
                />
              </View>
              <Pressable
                onPress={() => verifyKey(passkeyInput)}
                disabled={isVerifying}
                style={[styles.verifyBtn, isVerifying && styles.btnDisabled]}
              >
                {isVerifying ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Key size={14} color="#ffffff" />
                    <Text style={styles.verifyBtnText}>Xác thực & Kết nối</Text>
                  </>
                )}
              </Pressable>
            </View>

            {errorMsg && (
              <View style={styles.errorBox}>
                <AlertCircle size={14} color="#ef4444" />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Section 2: 3-Fleet Permission Status Grid */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Cpu size={18} color={styles.accentColor.color} />
          <Text style={styles.cardTitle}>2. TRẠNG THÁI PHÂN QUYỀN 3 FLEETS</Text>
        </View>

        <View style={styles.fleetGrid}>
          {/* Fleet 1: LLM Swarm */}
          <View
            style={[
              styles.fleetCard,
              isLlmAllowed ? styles.fleetCardActive : styles.fleetCardLocked,
            ]}
          >
            <View style={styles.fleetHeader}>
              <View style={styles.fleetTitleRow}>
                <Cpu size={16} color={isLlmAllowed ? "#3b82f6" : "#64748b"} />
                <Text style={styles.fleetName}>LLM Swarm Fleet</Text>
              </View>
              <View style={[styles.badge, isLlmAllowed ? styles.badgeBlue : styles.badgeMuted]}>
                <Text style={[styles.badgeText, isLlmAllowed ? styles.textBlue : styles.textMuted]}>
                  {isLlmAllowed ? "ĐÃ MỞ KHÓA" : "CHƯA CẤP"}
                </Text>
              </View>
            </View>
            <Text style={styles.fleetDesc}>
              Cụm 31+ nodes phân tán: Codex, Gemini 2.5 Pro, Terra 5.6 và Claude.
            </Text>
            {currentUser && isLlmAllowed ? (
              <View style={styles.quotaInfo}>
                <Text style={styles.quotaLabel}>
                  Hạn mức: {currentUser.quotas.llm.dailyTokenBudget.toLocaleString()} tokens/ngày
                </Text>
                <Text style={styles.quotaSub}>
                  Opus: {currentUser.quotas.llm.allowClaudeOpus ? "Cho phép" : "Bị hạn chế"} • Tier:{" "}
                  {currentUser.quotas.llm.tier.toUpperCase()}
                </Text>
              </View>
            ) : (
              <Text style={styles.lockedNote}>Liên hệ Admin để cấp quyền LLM Swarm</Text>
            )}
          </View>

          {/* Fleet 2: Modal GPU Swarm */}
          <View
            style={[
              styles.fleetCard,
              isGpuAllowed ? styles.fleetCardActive : styles.fleetCardLocked,
            ]}
          >
            <View style={styles.fleetHeader}>
              <View style={styles.fleetTitleRow}>
                <Zap size={16} color={isGpuAllowed ? "#a855f7" : "#64748b"} />
                <Text style={styles.fleetName}>Modal GPU Swarm</Text>
              </View>
              <View style={[styles.badge, isGpuAllowed ? styles.badgePurple : styles.badgeMuted]}>
                <Text
                  style={[styles.badgeText, isGpuAllowed ? styles.textPurple : styles.textMuted]}
                >
                  {isGpuAllowed ? "ĐÃ MỞ KHÓA" : "CHƯA CẤP"}
                </Text>
              </View>
            </View>
            <Text style={styles.fleetDesc}>
              Serverless GPU A100/H100/L4: Qwen Draw 2.1, Flux Dev, Whisper v3.
            </Text>
            {currentUser && isGpuAllowed ? (
              <View style={styles.quotaInfo}>
                <Text style={styles.quotaLabel}>
                  Hạn mức: {currentUser.quotas.modal_gpu.dailyGpuMinutes} phút GPU/ngày
                </Text>
                <Text style={styles.quotaSub}>
                  Ứng dụng: {currentUser.quotas.modal_gpu.allowedApps.join(", ")}
                </Text>
              </View>
            ) : (
              <Text style={styles.lockedNote}>Cần quyền VIP/Admin để chạy GPU Swarm</Text>
            )}
          </View>

          {/* Fleet 3: Cloudflare Clef Fleet */}
          <View
            style={[
              styles.fleetCard,
              isClefAllowed ? styles.fleetCardActive : styles.fleetCardLocked,
            ]}
          >
            <View style={styles.fleetHeader}>
              <View style={styles.fleetTitleRow}>
                <Sparkles size={16} color={isClefAllowed ? "#10b981" : "#64748b"} />
                <Text style={styles.fleetName}>Cloudflare Clef Fleet</Text>
              </View>
              <View style={[styles.badge, isClefAllowed ? styles.badgeGreen : styles.badgeMuted]}>
                <Text
                  style={[styles.badgeText, isClefAllowed ? styles.textGreen : styles.textMuted]}
                >
                  {isClefAllowed ? "ĐÃ MỞ KHÓA" : "CHƯA CẤP"}
                </Text>
              </View>
            </View>
            <Text style={styles.fleetDesc}>
              AI Workers miễn phí siêu tốc: Code autocompletion, linter, rapid format.
            </Text>
            {currentUser && isClefAllowed ? (
              <View style={styles.quotaInfo}>
                <Text style={styles.quotaLabel}>
                  Hạn mức: {currentUser.quotas.cloudflare_clef.dailyRequests.toLocaleString()}{" "}
                  reqs/ngày
                </Text>
                <Text style={styles.quotaSub}>Tốc độ phản hồi: &lt;120ms • Zero Quota Penalty</Text>
              </View>
            ) : (
              <Text style={styles.lockedNote}>Liên hệ Admin để cấp quyền Clef</Text>
            )}
          </View>
        </View>
      </View>

      {/* Section 3: Onboarding Guide for New Hosts */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Globe size={18} color={styles.accentColor.color} />
          <Text style={styles.cardTitle}>3. HƯỚNG DẪN ONBOARDING CHO HOST MỚI (3 LỰA CHỌN)</Text>
        </View>

        {/* Tab Selector */}
        <View style={styles.tabBar}>
          <Pressable
            onPress={() => setActiveTab("choice1")}
            style={[styles.tabItem, activeTab === "choice1" && styles.tabItemActive]}
          >
            <Text style={[styles.tabText, activeTab === "choice1" && styles.tabTextActive]}>
              1. Web Zero-Install
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("choice2")}
            style={[styles.tabItem, activeTab === "choice2" && styles.tabItemActive]}
          >
            <Text style={[styles.tabText, activeTab === "choice2" && styles.tabTextActive]}>
              2. Sovereign Router
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("choice3")}
            style={[styles.tabItem, activeTab === "choice3" && styles.tabItemActive]}
          >
            <Text style={[styles.tabText, activeTab === "choice3" && styles.tabTextActive]}>
              3. Hybrid BYOK
            </Text>
          </Pressable>
        </View>

        {/* Tab Content */}
        {activeTab === "choice1" && (
          <View style={styles.guideBox}>
            <Text style={styles.guideHeading}>
              Phương án 1: Dùng Web Không Cài Đặt (Zero-Install)
            </Text>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 1: </Text>Mở trình duyệt truy cập{" "}
              <Text style={styles.codeText}>http://zencode.thapsang.com</Text> từ bất kỳ máy tính
              nào.
            </Text>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 2: </Text>Nhập Passkey do Admin cấp ở mục 1 bên
              trên.
            </Text>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 3: </Text>Bắt đầu lập trình ngay lập tức. Toàn bộ
              quota và routing do máy chủ Zencode trung tâm gánh vác, không cần cài đặt Python hay
              proxy cục bộ.
            </Text>
          </View>
        )}

        {activeTab === "choice2" && (
          <View style={styles.guideBox}>
            <Text style={styles.guideHeading}>
              Phương án 2: Private Sovereign Fleet (Router Nội Bộ Cô Lập)
            </Text>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 1: </Text>Dành cho máy trạm nội bộ cần cách ly mạng
              (Air-Gapped) hoặc kết nối Sovereign Mesh.
            </Text>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 2: </Text>Chạy 1 dòng lệnh duy nhất trong Terminal
              của máy trạm:
            </Text>
            <View style={styles.snippetBox}>
              <Text style={styles.snippetText}>
                curl -sSL http://10.123.214.1:6768/api/onboarding/bootstrap | bash
              </Text>
              <Pressable
                onPress={() =>
                  handleCopy("curl -sSL http://10.123.214.1:6768/api/onboarding/bootstrap | bash")
                }
                style={styles.copyBtn}
              >
                {copiedSnippet ? (
                  <Check size={14} color="#10b981" />
                ) : (
                  <Copy size={14} color="#94a3b8" />
                )}
              </Pressable>
            </View>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 3: </Text>Tiến trình Sovereign Router tự động lắng
              nghe trên <Text style={styles.codeText}>127.0.0.1:7778</Text> và kết nối vào Cluster.
            </Text>
          </View>
        )}

        {activeTab === "choice3" && (
          <View style={styles.guideBox}>
            <Text style={styles.guideHeading}>
              Phương án 3: Hybrid BYOK Fleet (Tự Dùng API Key Riêng)
            </Text>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 1: </Text>Dành cho thành viên có API Key
              Claude/OpenAI riêng muốn sử dụng hạn mức không giới hạn từ tài khoản cá nhân.
            </Text>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 2: </Text>Vào tab{" "}
              <Text style={styles.codeText}>Auth</Text>, chọn Anthropic hoặc OpenAI và dán Key. Key
              được mã hóa AES-256 an toàn tại chỗ.
            </Text>
            <Text style={styles.guideStep}>
              <Text style={styles.stepNum}>Bước 3: </Text>Hệ thống tự động kích hoạt chế độ
              Dual-Route: Tác vụ nặng chạy Key riêng, tác vụ nền chạy miễn phí qua Clef/Codex Swarm.
            </Text>
          </View>
        )}
      </View>

      {/* Section 4: Live Gateway Health Check */}
      <View style={styles.card}>
        <View style={styles.pingRow}>
          <View style={styles.pingLeft}>
            <ActivityIndicator size="small" color="#10b981" style={{ marginRight: 8 }} />
            <Text style={styles.pingTitle}>Zencode Cluster Gateway Status</Text>
          </View>
          <View style={styles.pingRight}>
            {pingLatency !== null && (
              <Text style={styles.latencyText}>
                {pingLatency >= 0 ? `${pingLatency}ms Round-trip` : "Connection Timeout"}
              </Text>
            )}
            <Pressable onPress={handlePing} disabled={isPinging} style={styles.pingBtn}>
              <RefreshCw size={12} color="#94a3b8" />
              <Text style={styles.pingBtnText}>Kiểm tra kết nối</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: "#090d16",
  },
  contentContainer: {
    padding: 20,
    gap: 16,
  },
  accentColor: {
    color: "#38bdf8",
  },
  heroCard: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 18,
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTextCol: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    fontSize: 13,
    color: "#94a3b8",
    marginTop: 4,
    lineHeight: 18,
  },
  card: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 18,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.5,
  },
  instructionText: {
    fontSize: 13,
    color: "#cbd5e1",
    marginBottom: 12,
  },
  loginBox: {},
  inputRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  inputWrapper: {
    flex: 1,
  },
  keyInput: {
    backgroundColor: "#090d16",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: "#f8fafc",
    fontFamily: "monospace",
  },
  verifyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0284c7",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 8,
  },
  verifyBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    color: "#f87171",
  },
  activeSessionBox: {
    backgroundColor: "#090d16",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 14,
  },
  activeSessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  dotGreen: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10b981",
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10b981",
  },
  disconnectBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  disconnectBtnText: {
    fontSize: 12,
    color: "#ef4444",
  },
  userInfoRow: {
    flexDirection: "row",
    gap: 20,
    flexWrap: "wrap",
  },
  infoCol: {
    gap: 4,
  },
  infoLabel: {
    fontSize: 11,
    color: "#64748b",
    textTransform: "uppercase",
  },
  infoValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#f8fafc",
  },
  infoValueRole: {
    fontSize: 12,
    fontWeight: "700",
    color: "#38bdf8",
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  infoValueMono: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "monospace",
  },
  fleetGrid: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  fleetCard: {
    flex: 1,
    minWidth: 260,
    backgroundColor: "#090d16",
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  fleetCardActive: {
    borderColor: "#1e293b",
  },
  fleetCardLocked: {
    borderColor: "#1e293b",
    opacity: 0.65,
  },
  fleetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fleetTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fleetName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#f8fafc",
  },
  fleetDesc: {
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 16,
  },
  quotaInfo: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    padding: 10,
    borderRadius: 6,
    gap: 4,
  },
  quotaLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#e2e8f0",
  },
  quotaSub: {
    fontSize: 11,
    color: "#64748b",
  },
  lockedNote: {
    fontSize: 11,
    color: "#64748b",
    fontStyle: "italic",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeBlue: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
  },
  badgePurple: {
    backgroundColor: "rgba(168, 85, 247, 0.15)",
  },
  badgeGreen: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  badgeMuted: {
    backgroundColor: "rgba(100, 116, 139, 0.15)",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  textBlue: {
    color: "#60a5fa",
  },
  textPurple: {
    color: "#c084fc",
  },
  textGreen: {
    color: "#34d399",
  },
  textMuted: {
    color: "#94a3b8",
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    marginBottom: 14,
  },
  tabItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabItemActive: {
    borderBottomColor: "#38bdf8",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  tabTextActive: {
    color: "#38bdf8",
  },
  guideBox: {
    backgroundColor: "#090d16",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 14,
    gap: 10,
  },
  guideHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#f8fafc",
    marginBottom: 4,
  },
  guideStep: {
    fontSize: 13,
    color: "#cbd5e1",
    lineHeight: 18,
  },
  stepNum: {
    fontWeight: "700",
    color: "#38bdf8",
  },
  codeText: {
    fontFamily: "monospace",
    color: "#38bdf8",
  },
  snippetBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 4,
  },
  snippetText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#a5f3fc",
    flex: 1,
  },
  copyBtn: {
    padding: 6,
  },
  pingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  pingLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  pingTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#f8fafc",
  },
  pingRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  latencyText: {
    fontSize: 12,
    color: "#10b981",
    fontFamily: "monospace",
  },
  pingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  pingBtnText: {
    fontSize: 12,
    color: "#cbd5e1",
  },
}));
