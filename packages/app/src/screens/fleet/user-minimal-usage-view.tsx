import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { router } from "expo-router";
import {
  ArrowLeft,
  BatteryCharging,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Image,
  Key,
  Layers,
  Lock,
  LogOut,
  Mic,
  Rocket,
  Scale,
  ShieldCheck,
  Sliders,
  Sparkles,
  Video,
  Wand2,
  Zap,
} from "lucide-react-native";

import {
  ZENCODE_MODEL_CATALOG,
  isModelAccessible,
  calculateModelCapacity,
  type ZencodeModelMeta,
} from "./user-model-credits-matrix";

interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  role: string;
  tier?: string;
  canUsePrivateFleet?: boolean;
  keyPrefix: string;
  quotas: {
    llm: {
      dailyTokenBudget: number;
      usedTodayTokens: number;
      tier: string;
      allowedModels?: string[];
      allowClaudeOpus?: boolean;
    };
    modal_gpu: {
      enabled: boolean;
      dailyGpuMinutes: number;
      usedTodayMinutes: number;
    };
    cloudflare_clef: {
      enabled: boolean;
    };
    services?: {
      tts: {
        enabled: boolean;
        dailyMinutes: number;
        usedTodayMinutes: number;
        appName: string;
      };
      t2image: {
        enabled: boolean;
        dailyImages: number;
        usedTodayImages: number;
        model: string;
      };
      img2img: {
        enabled: boolean;
        dailyEdits: number;
        usedTodayEdits: number;
        model: string;
      };
      video: {
        enabled: boolean;
        status: string;
        note: string;
      };
    };
  };
}

interface UserMinimalUsageViewProps {
  onBack: () => void;
}

export function UserMinimalUsageView({ onBack }: UserMinimalUsageViewProps) {
  const { theme } = useUnistyles();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("gemini-2.5-flash");

  useEffect(() => {
    try {
      const token =
        typeof window !== "undefined" ? window.localStorage?.getItem("zencode_access_token") : null;
      if (token) {
        fetch("/api/user/me", {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.user) {
              setProfile(data.user);
            }
          })
          .catch(() => {
            // ignore
          });
      }

      if (typeof window !== "undefined") {
        const saved = window.localStorage?.getItem("zencode_selected_model");
        if (saved) {
          setSelectedModel(saved);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSelectModel = (modelId: string, isAccessible: boolean) => {
    if (!isAccessible) return;
    setSelectedModel(modelId);
    try {
      if (typeof window !== "undefined") {
        window.localStorage?.setItem("zencode_selected_model", modelId);
      }
    } catch {
      // ignore
    }
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem("zencode_access_token");
      window.localStorage?.removeItem("zencode_user_role");
      window.localStorage?.removeItem("zencode_user_name");
      window.localStorage?.removeItem("zencode_selected_model");
    }
    router.replace("/");
  };

  const usedTokens = profile?.quotas?.llm?.usedTodayTokens ?? 0;
  const totalTokens = profile?.quotas?.llm?.dailyTokenBudget ?? 1_000_000;
  const remainingTokens = Math.max(0, totalTokens - usedTokens);
  const percentUsed = Math.min(100, Math.round((usedTokens / totalTokens) * 100));

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topRow}>
        <Pressable onPress={onBack} style={styles.backBtn} testID="user-back-to-workspace-btn">
          <ArrowLeft size={14} color={theme.colors.accent} />
          <Text style={styles.backBtnText}>Quay lại Không gian làm việc</Text>
        </Pressable>
        <Pressable onPress={handleLogout} style={styles.logoutBtn} testID="user-change-passkey-btn">
          <LogOut size={13} color={theme.colors.foregroundMuted} />
          <Text style={styles.logoutText}>Đổi Passkey</Text>
        </Pressable>
      </View>

      {/* Greeting Card */}
      <View style={styles.card}>
        <View style={styles.greetingHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarChar}>
              {profile?.displayName ? profile.displayName[0].toUpperCase() : "U"}
            </Text>
          </View>
          <View style={styles.userTitleCol}>
            <Text style={styles.greetingName}>
              Xin chào, {profile?.displayName || "Lập trình viên"}
            </Text>
            <View style={styles.roleBadgeRow}>
              <View style={styles.rolePill}>
                <Text style={styles.rolePillText}>
                  {profile?.role ? profile.role.toUpperCase() : "DEVELOPER"}
                </Text>
              </View>
              <View style={styles.tierPill}>
                <Sparkles size={11} color={theme.colors.accent} />
                <Text style={styles.tierPillText}>
                  {profile?.tier ? `CODEX ${profile.tier.toUpperCase()}` : "CODEX PRO"}
                </Text>
              </View>
              {profile?.canUsePrivateFleet ? (
                <View style={styles.privateFleetGrantedPill}>
                  <Text style={styles.privateFleetGrantedPillText}>PRIVATE FLEET CẤP PHÉP</Text>
                </View>
              ) : (
                <View style={styles.centralFleetPill}>
                  <Text style={styles.centralFleetPillText}>CENTRAL MANAGED FLEET</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.statusBanner}>
          <CheckCircle2 size={15} color="#10b981" />
          <Text style={styles.statusBannerText}>
            Tài khoản đã sẵn sàng • Mạng lưới Zencode AI đang tối ưu ngầm cho bạn
          </Text>
        </View>
      </View>

      {/* Battery / Work Session Energy Card */}
      {(() => {
        const remainingPercent = Math.max(0, 100 - percentUsed);
        let energyColor = "#10b981"; // Xanh
        let energyBadge = "DỒI DÀO";
        let energyMessage =
          "⚡ Năng lượng dồi dào • Hệ thống Zencode Swarm đang hỗ trợ suy luận tối đa cho bạn.";

        if (remainingPercent <= 0) {
          energyColor = "#ef4444"; // Đỏ
          energyBadge = "ĐANG TỰ HỒI PHỤC";
          energyMessage =
            "🛡️ Đã đạt giới hạn năng lượng an toàn hôm nay. Chế độ lập trình cơ bản đang kích hoạt. Pin sẽ tự động sạc đầy lúc 00:00 UTC.";
        } else if (remainingPercent < 15) {
          energyColor = "#f97316"; // Cam
          energyBadge = "SẮP CẠN";
          energyMessage =
            "💡 Năng lượng phiên làm việc sắp hết. Gợi ý: Bạn có thể chuyển sang Flash Mode để tiếp tục code nhẹ nhàng.";
        } else if (remainingPercent < 35) {
          energyColor = "#eab308"; // Vàng
          energyBadge = "TIẾT KIỆM";
          energyMessage =
            "🌿 Đang bật chế độ tiết kiệm năng lượng thông minh để tối ưu từng dòng code.";
        }

        return (
          <View style={[styles.card, { borderColor: `${energyColor}55` }]}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.headerLeft}>
                <BatteryCharging size={17} color={energyColor} />
                <Text style={styles.cardHeaderTitle}>PIN NĂNG LƯỢNG LÀM VIỆC</Text>
                <View
                  style={{
                    backgroundColor: `${energyColor}22`,
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                    borderRadius: 4,
                  }}
                >
                  <Text style={{ color: energyColor, fontSize: 10, fontWeight: "700" }}>
                    {energyBadge}
                  </Text>
                </View>
              </View>
              <Text style={[styles.percentText, { color: energyColor }]}>
                {remainingPercent}% còn lại
              </Text>
            </View>

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${Math.max(5, percentUsed)}%`, backgroundColor: energyColor },
                ]}
              />
            </View>

            <View style={styles.usageDetailsRow}>
              <Text style={styles.usageSub}>
                Năng lượng tiêu thụ:{" "}
                <Text style={styles.usageHighlight}>{usedTokens.toLocaleString()}</Text> /{" "}
                {totalTokens.toLocaleString()} Credits (tokens)
              </Text>
              <Text style={styles.resetSub}>Tự động sạc đầy lúc 00:00 UTC</Text>
            </View>

            <View style={[styles.energyNoticeBox, { borderColor: `${energyColor}33` }]}>
              <Text style={styles.energyNoticeText}>{energyMessage}</Text>
            </View>
          </View>
        );
      })()}

      {/* Model Selection & Market Conversion Matrix Section */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderLeft}>
            <Sliders size={15} color={theme.colors.accent} />
            <Text style={styles.sectionTitle}>CHỌN MODEL LẬP TRÌNH & BẢNG QUY ĐỔI HẠN MỨC</Text>
          </View>
          <View style={styles.creditsBadge}>
            <Scale size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.creditsBadgeText}>1 Z-Credit = 1 Flash Token</Text>
          </View>
        </View>

        <Text style={styles.sectionSubDesc}>
          Bạn có thể bấm chọn riêng lẻ từng Model dưới đây để làm Model mặc định cho phiên làm việc.
          Tỉ lệ quy đổi Credits dựa trên giá thành thị trường thực tế:
        </Text>

        <View style={styles.modelGrid}>
          {ZENCODE_MODEL_CATALOG.map((model) => {
            const accessible = isModelAccessible(model.minTier, profile?.tier);
            const isSelected = selectedModel === model.id;

            // Calculate estimated capacity with remaining tokens
            let capacityText = "Không giới hạn (0 Credits)";
            if (model.multiplier > 0) {
              const maxTokens = Math.floor(remainingTokens / model.multiplier);
              const estAnswers = Math.floor(maxTokens / 450);
              capacityText = `~${maxTokens.toLocaleString()} tokens (≈${estAnswers.toLocaleString()} câu trả lời)`;
            }

            return (
              <Pressable
                key={model.id}
                onPress={() => handleSelectModel(model.id, accessible)}
                style={[
                  styles.modelCard,
                  isSelected && styles.modelCardSelected,
                  !accessible && styles.modelCardLocked,
                ]}
                testID={`model-select-${model.id}`}
              >
                <View style={styles.modelCardTop}>
                  <View style={styles.modelNameCol}>
                    <View style={styles.modelTitleRow}>
                      <Text
                        style={[styles.modelTitle, isSelected && { color: theme.colors.accent }]}
                      >
                        {model.name}
                      </Text>
                    </View>
                    <Text style={styles.modelProvider}>
                      {model.provider} •{" "}
                      <Text style={{ color: model.accentColor, fontWeight: "600" }}>
                        {model.tag}
                      </Text>
                    </Text>
                  </View>

                  {accessible ? (
                    isSelected ? (
                      <View style={styles.activeSelectionBadge}>
                        <Check size={11} color="#ffffff" />
                        <Text style={styles.activeSelectionBadgeText}>ĐANG CHỌN</Text>
                      </View>
                    ) : (
                      <View style={styles.selectableBadge}>
                        <Text style={styles.selectableBadgeText}>CHỌN MODEL</Text>
                      </View>
                    )
                  ) : (
                    <View style={styles.lockedBadge}>
                      <Lock size={10} color={theme.colors.foregroundMuted} />
                      <Text style={styles.lockedBadgeText}>CẦN {model.minTier.toUpperCase()}</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.modelDesc}>{model.description}</Text>

                <View style={styles.modelCardFooter}>
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Thị trường: </Text>
                    <Text style={styles.priceValue}>{model.marketPrice}</Text>
                  </View>
                  <View style={styles.capacityRow}>
                    <Text style={styles.capacityLabel}>Sức chứa còn lại: </Text>
                    <Text
                      style={[
                        styles.capacityValue,
                        {
                          color: accessible
                            ? theme.colors.foreground
                            : theme.colors.foregroundMuted,
                        },
                      ]}
                    >
                      {accessible ? capacityText : "Khóa theo hạng gói"}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Creative & Multimodal AI Services Section */}
      {(() => {
        const ttsUsed = profile?.quotas?.services?.tts?.usedTodayMinutes ?? 0;
        const ttsDaily = profile?.quotas?.services?.tts?.dailyMinutes ?? 15;
        const isTtsExhausted = ttsDaily > 0 && ttsUsed >= ttsDaily;

        const t2iUsed = profile?.quotas?.services?.t2image?.usedTodayImages ?? 0;
        const t2iDaily = profile?.quotas?.services?.t2image?.dailyImages ?? 20;
        const isT2iExhausted = t2iDaily > 0 && t2iUsed >= t2iDaily;

        const i2iUsed = profile?.quotas?.services?.img2img?.usedTodayEdits ?? 0;
        const i2iDaily = profile?.quotas?.services?.img2img?.dailyEdits ?? 15;
        const isI2iExhausted = i2iDaily > 0 && i2iUsed >= i2iDaily;

        return (
          <View style={styles.servicesSection}>
            <View style={styles.servicesSectionHeader}>
              <Sparkles size={14} color={theme.colors.accent} />
              <Text style={styles.servicesSectionTitle}>DỊCH VỤ SÁNG TẠO & ĐA PHƯƠNG THỨC</Text>
            </View>

            <View style={styles.servicesGrid}>
              {/* Service 1: Text-to-Speech (Omni Voice App) */}
              <View
                style={[
                  styles.serviceCard,
                  isTtsExhausted && { borderColor: "rgba(239, 68, 68, 0.45)" },
                ]}
              >
                <View style={styles.serviceCardTop}>
                  <View style={styles.serviceIconBadgeTts}>
                    <Mic size={16} color="#06b6d4" />
                  </View>
                  {isTtsExhausted ? (
                    <View style={styles.serviceExhaustedPill}>
                      <Text style={styles.serviceExhaustedPillText}>HẾT HẠN MỨC</Text>
                    </View>
                  ) : (
                    <View style={styles.serviceActivePill}>
                      <Text style={styles.serviceActivePillText}>SẴN SÀNG</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.serviceTitle}>TTS (Omni Voice App)</Text>
                <Text style={[styles.serviceMetric, isTtsExhausted && { color: "#ef4444" }]}>
                  {ttsUsed} / {ttsDaily} phút thoại/ngày
                </Text>
                <Text style={styles.serviceDesc}>
                  Tổng hợp giọng nói & Voice Clone tự nhiên không độ trễ. Quy đổi: 1 phút ≈ 2,500
                  Credits.
                </Text>
              </View>

              {/* Service 2: Text-to-Image (Qwen Image 2.1) */}
              <View
                style={[
                  styles.serviceCard,
                  isT2iExhausted && { borderColor: "rgba(239, 68, 68, 0.45)" },
                ]}
              >
                <View style={styles.serviceCardTop}>
                  <View style={styles.serviceIconBadgeImage}>
                    <Image size={16} color="#38bdf8" />
                  </View>
                  {isT2iExhausted ? (
                    <View style={styles.serviceExhaustedPill}>
                      <Text style={styles.serviceExhaustedPillText}>HẾT HẠN MỨC</Text>
                    </View>
                  ) : (
                    <View style={styles.serviceActivePill}>
                      <Text style={styles.serviceActivePillText}>SẴN SÀNG</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.serviceTitle}>t2Image (Qwen 2.1)</Text>
                <Text style={[styles.serviceMetric, isT2iExhausted && { color: "#ef4444" }]}>
                  {t2iUsed} / {t2iDaily} ảnh/ngày
                </Text>
                <Text style={styles.serviceDesc}>
                  Sinh ảnh minh họa độ nét cao từ prompt văn bản (A100 GPU). Quy đổi: 1 ảnh ≈ 10,000
                  Credits.
                </Text>
              </View>

              {/* Service 3: Image-to-Image (Qwen 2.1 Image Edit) */}
              <View
                style={[
                  styles.serviceCard,
                  isI2iExhausted && { borderColor: "rgba(239, 68, 68, 0.45)" },
                ]}
              >
                <View style={styles.serviceCardTop}>
                  <View style={styles.serviceIconBadgeEdit}>
                    <Wand2 size={16} color="#a855f7" />
                  </View>
                  {isI2iExhausted ? (
                    <View style={styles.serviceExhaustedPill}>
                      <Text style={styles.serviceExhaustedPillText}>HẾT HẠN MỨC</Text>
                    </View>
                  ) : (
                    <View style={styles.serviceActivePill}>
                      <Text style={styles.serviceActivePillText}>SẴN SÀNG</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.serviceTitle}>Img2Img (Qwen 2.1 Edit)</Text>
                <Text style={[styles.serviceMetric, isI2iExhausted && { color: "#ef4444" }]}>
                  {i2iUsed} / {i2iDaily} lượt edit/ngày
                </Text>
                <Text style={styles.serviceDesc}>
                  Inpainting và biến đổi ảnh theo câu lệnh giữ nguyên chi tiết. Quy đổi: 1 lượt ≈
                  8,000 Credits.
                </Text>
              </View>

              {/* Service 4: App Video (Wan 2.2 / LTX Video) - UNSUPPORTED */}
              <View style={[styles.serviceCard, styles.serviceCardDisabled]}>
                <View style={styles.serviceCardTop}>
                  <View style={styles.serviceIconBadgeVideo}>
                    <Video size={16} color={theme.colors.foregroundMuted} />
                  </View>
                  <View style={styles.serviceDisabledPill}>
                    <Text style={styles.serviceDisabledPillText}>CHƯA HỖ TRỢ</Text>
                  </View>
                </View>
                <Text style={[styles.serviceTitle, { color: theme.colors.foregroundMuted }]}>
                  App Video (Wan / LTX)
                </Text>
                <Text style={[styles.serviceMetric, { color: "#eab308" }]}>
                  🚫 Chưa hỗ trợ trong phiên bản này
                </Text>
                <Text style={styles.serviceDesc}>
                  Hạ tầng sinh Video đang nghiên cứu, chưa mở trên cụm Swarm.
                </Text>
              </View>
            </View>
          </View>
        );
      })()}

      {/* Capabilities & Resilient Routing Summary */}
      <View style={styles.capabilitiesRow}>
        <View style={styles.capItem}>
          <ShieldCheck size={16} color="#06b6d4" />
          <Text style={styles.capTitle}>Cloudflare Clef</Text>
          <Text style={styles.capSub}>Hybrid Planning & Auto Fallback</Text>
        </View>

        <View style={styles.capItem}>
          <CheckCircle2 size={16} color="#10b981" />
          <Text style={styles.capTitle}>Bảo Mật Sovereign</Text>
          <Text style={styles.capSub}>Zero Outbound Telemetry</Text>
        </View>

        <View style={styles.capItem}>
          <Zap size={16} color={theme.colors.accent} />
          <Text style={styles.capTitle}>Tối Ưu Ngầm Tập Trung</Text>
          <Text style={styles.capSub}>Auto-Routing & Load Balancing</Text>
        </View>
      </View>

      {/* Notice & Big Start Button */}
      <View style={styles.noticeBox}>
        <Text style={styles.noticeText}>
          💡 Toàn bộ việc định tuyến mô hình (Routing), phân tải và quản trị cụm máy chủ do{" "}
          <Text style={styles.noticeBold}>System Admin</Text> vận hành tập trung qua Central Managed
          Fleet.{" "}
          {!profile?.canUsePrivateFleet
            ? "Cụm Fleet Riêng (Private Fleet) đang được quản lý tập trung bởi Admin để tối ưu tài nguyên. Liên hệ Admin trong User Management nếu bạn có nhu cầu cấp hạ tầng riêng biệt."
            : "🎉 Tài khoản của bạn đã được System Admin cấp phép kết nối hạ tầng Private Fleet riêng biệt!"}
        </Text>
      </View>

      <Pressable onPress={onBack} style={styles.startCodingBtn} testID="user-start-coding-btn">
        <Rocket size={16} color="#ffffff" />
        <Text style={styles.startCodingBtnText}>
          Bắt đầu Lập Trình Với{" "}
          {ZENCODE_MODEL_CATALOG.find((m) => m.id === selectedModel)?.name || "Zencode AI"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: 24,
    maxWidth: 780,
    alignSelf: "center",
    width: "100%",
    gap: 18,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  backBtnText: {
    fontSize: 13,
    color: theme.colors.accent,
    fontWeight: "600",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  logoutText: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 20,
    gap: 14,
  },
  greetingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarChar: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.accent,
  },
  userTitleCol: {
    flex: 1,
    gap: 6,
  },
  greetingName: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  roleBadgeRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  rolePill: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
  },
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.25)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tierPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.colors.accent,
  },
  privateFleetGrantedPill: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
  },
  privateFleetGrantedPillText: {
    color: "#10b981",
    fontSize: 10,
    fontWeight: "700",
  },
  centralFleetPill: {
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  centralFleetPillText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
    padding: 10,
    borderRadius: 8,
  },
  statusBannerText: {
    fontSize: 12,
    color: "#10b981",
    fontWeight: "500",
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardHeaderTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
    letterSpacing: 0.5,
  },
  percentText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#10b981",
  },
  progressTrack: {
    height: 8,
    backgroundColor: theme.colors.surface2,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: theme.colors.accent,
    borderRadius: 4,
  },
  usageDetailsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  usageSub: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  usageHighlight: {
    color: theme.colors.foreground,
    fontWeight: "600",
  },
  resetSub: {
    fontSize: 11,
    color: theme.colors.foregroundExtraMuted,
  },
  energyNoticeBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: theme.colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  energyNoticeText: {
    color: theme.colors.foreground,
    fontSize: 12,
    lineHeight: 17,
  },
  sectionContainer: {
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 2,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
    letterSpacing: 0.6,
  },
  sectionSubDesc: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
    paddingHorizontal: 2,
  },
  creditsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  creditsBadgeText: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    fontWeight: "600",
  },
  modelGrid: {
    flexDirection: "column",
    gap: 10,
  },
  modelCard: {
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 8,
  },
  modelCardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  modelCardLocked: {
    opacity: 0.6,
  },
  modelCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  modelNameCol: {
    flex: 1,
    gap: 2,
  },
  modelTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  modelTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  modelProvider: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  activeSelectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeSelectionBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
  },
  selectableBadge: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  selectableBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
  },
  lockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lockedBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
  },
  modelDesc: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    lineHeight: 17,
  },
  modelCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 8,
    marginTop: 2,
    flexWrap: "wrap",
    gap: 8,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  priceLabel: {
    fontSize: 11,
    color: theme.colors.foregroundExtraMuted,
  },
  priceValue: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
  },
  capacityRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  capacityLabel: {
    fontSize: 11,
    color: theme.colors.foregroundExtraMuted,
  },
  capacityValue: {
    fontSize: 11,
    fontWeight: "600",
  },
  servicesSection: {
    gap: 12,
  },
  servicesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
  },
  servicesSectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
    letterSpacing: 0.6,
  },
  servicesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  serviceCard: {
    flex: 1,
    minWidth: 280,
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 8,
  },
  serviceCardDisabled: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    opacity: 0.75,
  },
  serviceCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  serviceIconBadgeTts: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(6, 182, 212, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  serviceIconBadgeImage: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  serviceIconBadgeEdit: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(168, 85, 247, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  serviceIconBadgeVideo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(148, 163, 184, 0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  serviceActivePill: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  serviceActivePillText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#10b981",
  },
  serviceExhaustedPill: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
  },
  serviceExhaustedPillText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#ef4444",
  },
  serviceDisabledPill: {
    backgroundColor: "rgba(234, 179, 8, 0.10)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.25)",
  },
  serviceDisabledPillText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#eab308",
  },
  serviceTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  serviceMetric: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.accent,
  },
  serviceDesc: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
    lineHeight: 16,
  },
  capabilitiesRow: {
    flexDirection: "row",
    gap: 12,
  },
  capItem: {
    flex: 1,
    backgroundColor: theme.colors.surface1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 6,
  },
  capTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  capSub: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  noticeBox: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  noticeText: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  noticeBold: {
    color: theme.colors.foreground,
    fontWeight: "600",
  },
  startCodingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 6,
  },
  startCodingBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
}));
