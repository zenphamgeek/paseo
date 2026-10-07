import * as React from "react";
import { useState, useMemo } from "react";
import {
  Shield,
  Zap,
  Terminal,
  Cpu,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Sparkles,
  QrCode,
  Copy,
  Check,
  Flame,
  Award,
  Lock,
  ArrowRight,
  Bot,
  Layers,
  BarChart3,
  CreditCard,
  UserCheck,
  Code2,
  GitBranch,
  Server,
  Play,
  Activity,
  CheckSquare,
  HelpCircle,
  RefreshCw,
  Clock,
} from "lucide-react";

interface ModelItem {
  id: string;
  name: string;
  provider: string;
  multiplier: number;
  badge?: string;
  category: "ultra" | "pro" | "standard" | "free";
  desc: string;
}

const MODELS_CATALOG: ModelItem[] = [
  {
    id: "clef",
    name: "Llama 3.3 Clef (Local / Edge)",
    provider: "Zencode Edge",
    multiplier: 0,
    badge: "FREE TIER",
    category: "free",
    desc: "Suy luận tức thì, không tốn quota, hoàn toàn miễn phí",
  },
  {
    id: "codex",
    name: "Codex Free Quota Engine",
    provider: "OpenCode",
    multiplier: 1,
    badge: "STANDARD",
    category: "standard",
    desc: "Mã hóa đa năng, phản hồi nhanh, tiết kiệm chi phí tối đa",
  },
  {
    id: "flash",
    name: "Gemini 2.5 Flash High-Speed",
    provider: "Google DeepMind",
    multiplier: 1,
    badge: "POPULAR",
    category: "standard",
    desc: "Xử lý context 1M tokens, tốc độ siêu tốc cho tác vụ lớn",
  },
  {
    id: "haiku",
    name: "Claude 3.5 Haiku Agent",
    provider: "Anthropic",
    multiplier: 3,
    category: "pro",
    desc: "Lập luận nhanh, kiểm thử mã nguồn và tự động viết test suite",
  },
  {
    id: "pro",
    name: "Gemini 2.5 Pro Ultra-Reasoning",
    provider: "Google DeepMind",
    multiplier: 5,
    category: "pro",
    desc: "Tư duy kiến trúc hệ thống, phân tích bài toán thuật toán khó",
  },
  {
    id: "terra",
    name: "GPT-5.6 Terra Core",
    provider: "Codex Swarm",
    multiplier: 8,
    category: "pro",
    desc: "Engine chuyên sâu sinh code backend và cấu trúc dữ liệu phức tạp",
  },
  {
    id: "sonnet",
    name: "Claude Sonnet 4.6 Sovereign",
    provider: "Anthropic",
    multiplier: 12,
    badge: "EXECUTIVE",
    category: "ultra",
    desc: "Chuyên gia số 1 thế giới cho refactoring và system architecture",
  },
  {
    id: "opus",
    name: "Claude Opus 5.5 Titanium",
    provider: "Anthropic",
    multiplier: 35,
    badge: "MAX REASONING",
    category: "ultra",
    desc: "Hội đồng phản biện tối cao, thẩm định hệ thống & bảo mật toàn diện",
  },
];

export function ZencodeLandingPage() {
  const [selectedModel, setSelectedModel] = useState<string>("flash");
  const [selectedPlan, setSelectedPlan] = useState<string>("pro_monthly");
  const [showCheckoutModal, setShowCheckoutModal] = useState<boolean>(false);
  const [showGoogleModal, setShowGoogleModal] = useState<boolean>(false);
  const [showWaitlistToast, setShowWaitlistToast] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [orderCode, setOrderCode] = useState<string>(
    "ZC" + Math.floor(100000 + Math.random() * 900000),
  );
  const [userCredits, setUserCredits] = useState<number>(200);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [userName, setUserName] = useState<string>("");
  const [waitlistEmail, setWaitlistEmail] = useState<string>("");
  const [tokenSlider, setTokenSlider] = useState<number>(2000000); // 2M tokens/month default
  const [activeTab, setActiveTab] = useState<
    "architect" | "worker_fe" | "worker_be" | "challenger" | "auditor"
  >("architect");
  const [activePdcaStep, setActivePdcaStep] = useState<number>(1);

  const currentModel = MODELS_CATALOG.find((m) => m.id === selectedModel) || MODELS_CATALOG[2];

  const handleSimulateGoogleLogin = () => {
    setIsLoggedIn(true);
    setUserName("Kỹ sư Zencode");
    setUserCredits(200);
    setShowGoogleModal(false);
  };

  const [cliCopied, setCliCopied] = useState<boolean>(false);

  const handleCopyOrder = () => {
    navigator.clipboard?.writeText(orderCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyCli = () => {
    navigator.clipboard?.writeText("curl -fsSL https://zencode.vn/install.sh | bash");
    setCliCopied(true);
    setTimeout(() => setCliCopied(false), 2000);
  };

  const handleWaitlistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistEmail) return;
    setShowWaitlistToast(true);
    setWaitlistEmail("");
    setTimeout(() => setShowWaitlistToast(false), 5000);
  };

  // Pricing calculations
  const planDetails: Record<string, { name: string; price: number; credits: number }> = {
    starter_monthly: { name: "Gói Kỹ Sư (Starter)", price: 199000, credits: 1500 },
    pro_monthly: { name: "Gói Chuyên Nghiệp (Pro)", price: 499000, credits: 5000 },
    pro_yearly: {
      name: "Gói Chuyên Nghiệp (1 Năm - Tiết kiệm 20%)",
      price: 4790000,
      credits: 65000,
    },
  };

  const currentPlan = planDetails[selectedPlan] || planDetails["pro_monthly"];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-500 selection:text-black">
      {/* ── TOP ANNOUNCEMENT BANNER ── */}
      <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white text-xs md:text-sm font-semibold py-2 px-4 text-center flex items-center justify-center gap-2">
        <Sparkles className="w-4 h-4 animate-pulse" />
        <span>
          CHÀO MỪNG RA MẮT ZENCODE.VN: TẶNG NGAY 200 Z-CREDITS KHI ĐĂNG KÝ VIP EARLY ACCESS!
        </span>
        <button
          onClick={() => setShowGoogleModal(true)}
          className="ml-3 underline hover:text-amber-200 transition-colors cursor-pointer"
        >
          Nhận ngay &rarr;
        </button>
      </div>

      {/* ── NAVBAR ── */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-slate-800/80 px-4 lg:px-12 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center font-black text-slate-950 text-lg shadow-lg shadow-amber-500/20">
            Z
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-white">
              ZENCODE<span className="text-amber-400">.VN</span>
            </span>
            <span className="hidden sm:inline-block ml-2 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              Sovereign AI Fleet
            </span>
          </div>
        </div>

        <nav className="hidden lg:flex items-center gap-8 text-sm text-slate-300 font-medium">
          <a href="#swarm" className="hover:text-amber-400 transition-colors">
            Đội Ngũ Swarm
          </a>
          <a href="#workflow" className="hover:text-amber-400 transition-colors">
            Quy Trình PDCA
          </a>
          <a href="#models" className="hover:text-amber-400 transition-colors">
            Danh Mục Model
          </a>
          <a href="#pricing" className="hover:text-amber-400 transition-colors">
            Bảng Giá (Chờ QR Prod)
          </a>
          <a href="#security" className="hover:text-amber-400 transition-colors">
            Bảo Mật Stealth
          </a>
        </nav>

        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-slate-200 font-medium">{userName}</span>
              <span className="text-amber-400 font-bold">({userCredits} Z-Credits)</span>
            </div>
          ) : (
            <button
              onClick={() => setShowGoogleModal(true)}
              className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-2 transition-all cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.14z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Đăng Nhập Google</span>
            </button>
          )}

          <a
            href="#pricing"
            className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10 transition-all cursor-pointer"
          >
            <span>Nhận Thư Mời VIP</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* ── HERO SECTION ── */}
      <section className="relative px-6 lg:px-12 pt-16 pb-20 max-w-7xl mx-auto text-center overflow-hidden">
        <div className="absolute inset-0 -z-10 flex items-center justify-center opacity-25">
          <div className="w-[700px] h-[700px] rounded-full bg-gradient-to-tr from-amber-600/30 to-purple-600/20 blur-3xl"></div>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-amber-500/30 text-amber-300 text-xs font-medium mb-6">
          <Shield className="w-3.5 h-3.5 text-amber-400" />
          <span>Sovereign Isolation • 100% Zero Outbound Telemetry • Bản Quyền Việt Nam</span>
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-5xl mx-auto leading-tight sm:leading-none">
          Hệ Điều Hành Lập Trình Tự Trị <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-amber-200">
            Đa Tác Nhân Đầu Tiên Tại Việt Nam.
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-xl text-slate-300 max-w-3xl mx-auto font-normal leading-relaxed">
          Không chỉ dừng lại ở chat hỗ trợ. Zencode điều phối{" "}
          <strong>mạng lưới 5 Specialist Agents</strong> (Architect, Workers, Challenger, Auditor)
          phân rã bài toán, lập trình song song, tự bẻ gãy tìm lỗi và triển khai phần mềm không
          chạm.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            disabled
            className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-slate-800 text-slate-400 font-bold text-sm sm:text-base border border-slate-700 flex items-center justify-center gap-2.5 cursor-not-allowed opacity-80 shadow-none"
            title="Cổng thanh toán VietQR đang được cấu hình tài khoản Production. Vui lòng quay lại sau!"
          >
            <Clock className="w-5 h-5 text-amber-400" />
            <span>VietQR Đang Chờ Cấu Hình Production</span>
          </button>

          <button
            onClick={() => setShowGoogleModal(true)}
            className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>Trải Nghiệm Miễn Phí (Tặng 200 Z-Credits)</span>
            <ArrowRight className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* ── FLEET TELEMETRY HUD BAR ── */}
        <div className="mt-8 inline-flex flex-wrap items-center justify-center gap-3 sm:gap-4 px-5 py-2.5 rounded-full bg-slate-900/90 border border-emerald-500/30 text-xs font-mono backdrop-blur-md shadow-lg shadow-emerald-950/20">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-slate-400">Cluster:</span>
            <strong className="text-emerald-400 font-bold">22+ Fleet Nodes Online</strong>
          </div>
          <span className="text-slate-700 hidden sm:inline">•</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">P95 SLA:</span>
            <strong className="text-slate-100 font-bold">138ms</strong>
          </div>
          <span className="text-slate-700 hidden sm:inline">•</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Telemetry:</span>
            <strong className="text-emerald-400 font-bold">0 B/s (Stealth Mode)</strong>
          </div>
          <span className="text-slate-700 hidden sm:inline">•</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Domain:</span>
            <strong className="text-amber-400 font-bold">ZENCODE.VN</strong>
          </div>
        </div>

        {/* ── CLI QUICKSTART TERMINAL WIDGET ── */}
        <div className="mt-5 max-w-lg mx-auto rounded-xl bg-slate-950/90 border border-slate-800 p-2 px-4 flex items-center justify-between font-mono text-xs shadow-xl">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-emerald-400 font-bold">$</span>
            <span className="text-slate-300 truncate selection:bg-emerald-500 selection:text-black">
              curl -fsSL https://zencode.vn/install.sh | bash
            </span>
          </div>
          <button
            onClick={handleCopyCli}
            className="ml-3 px-3 py-1 rounded-lg bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-slate-300 text-[11px] font-semibold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
          >
            {cliCopied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Đã Chép</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Sao Chép</span>
              </>
            )}
          </button>
        </div>

        {/* ── INTERACTIVE MULTI-AGENT SWARM CODE STUDIO MOCKUP ── */}
        <div
          id="swarm"
          className="mt-14 max-w-5xl mx-auto rounded-2xl border border-slate-800 bg-slate-900/90 shadow-2xl overflow-hidden text-left"
        >
          {/* Studio Titlebar */}
          <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500"></span>
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
              <span className="ml-3 font-mono text-xs text-slate-400">
                zencode-studio — multi-agent workspace
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded border border-emerald-800/40">
              <Activity className="w-3.5 h-3.5 animate-pulse" />
              <span>5 Agents In Flight</span>
            </div>
          </div>

          {/* Agent Tabs */}
          <div className="flex items-center border-b border-slate-800 bg-slate-950/60 overflow-x-auto text-xs font-mono">
            <button
              onClick={() => setActiveTab("architect")}
              className={`px-4 py-2.5 flex items-center gap-2 border-r border-slate-800 transition-colors ${
                activeTab === "architect"
                  ? "bg-slate-900 text-amber-400 border-b-2 border-b-amber-400 font-bold"
                  : "text-slate-400 hover:bg-slate-900/50"
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-amber-400" />
              <span>Architect.ts (Sonnet 4.6)</span>
            </button>
            <button
              onClick={() => setActiveTab("worker_fe")}
              className={`px-4 py-2.5 flex items-center gap-2 border-r border-slate-800 transition-colors ${
                activeTab === "worker_fe"
                  ? "bg-slate-900 text-sky-400 border-b-2 border-b-sky-400 font-bold"
                  : "text-slate-400 hover:bg-slate-900/50"
              }`}
            >
              <Code2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Worker_Frontend.tsx (Flash 2.5)</span>
            </button>
            <button
              onClick={() => setActiveTab("worker_be")}
              className={`px-4 py-2.5 flex items-center gap-2 border-r border-slate-800 transition-colors ${
                activeTab === "worker_be"
                  ? "bg-slate-900 text-purple-400 border-b-2 border-b-purple-400 font-bold"
                  : "text-slate-400 hover:bg-slate-900/50"
              }`}
            >
              <Server className="w-3.5 h-3.5 text-purple-400" />
              <span>Worker_Backend.go (Haiku 3.5)</span>
            </button>
            <button
              onClick={() => setActiveTab("challenger")}
              className={`px-4 py-2.5 flex items-center gap-2 border-r border-slate-800 transition-colors ${
                activeTab === "challenger"
                  ? "bg-slate-900 text-rose-400 border-b-2 border-b-rose-400 font-bold"
                  : "text-slate-400 hover:bg-slate-900/50"
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-rose-400" />
              <span>Challenger_Stress.py (Terra)</span>
            </button>
            <button
              onClick={() => setActiveTab("auditor")}
              className={`px-4 py-2.5 flex items-center gap-2 transition-colors ${
                activeTab === "auditor"
                  ? "bg-slate-900 text-emerald-400 border-b-2 border-b-emerald-400 font-bold"
                  : "text-slate-400 hover:bg-slate-900/50"
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Auditor_Stealth.log (Opus 5.5)</span>
            </button>
          </div>

          {/* Active Code Content View */}
          <div className="p-5 font-mono text-xs sm:text-sm text-slate-300 leading-relaxed overflow-x-auto min-h-[220px]">
            {activeTab === "architect" && (
              <div>
                <p className="text-slate-500">
                  // [Architect Agent - Claude Sonnet 4.6] Specifying Microservice Interfaces & SLA
                  Targets
                </p>
                <p className="text-amber-400 mt-2">export interface SwarmExecutionPlan &#123;</p>
                <p className="pl-4 text-slate-300">targetSlaLatencyP95: "150ms",</p>
                <p className="pl-4 text-slate-300">concurrencyLimit: 64,</p>
                <p className="pl-4 text-slate-300">
                  securityProfile: "SovereignStealthZeroTelemetry",
                </p>
                <p className="pl-4 text-slate-300">paymentGateway: "VietQR_SePay_AutoWebhook",</p>
                <p className="pl-4 text-emerald-400">
                  verificationStages: ["FuzzTest", "AdversarialChallenger", "ForensicAudit"]
                </p>
                <p className="text-amber-400">&#125;</p>
              </div>
            )}
            {activeTab === "worker_fe" && (
              <div>
                <p className="text-slate-500">
                  // [Worker-1 Frontend - Gemini 2.5 Flash] Parallel Vibe Coding (Streaming 92
                  tokens/s)
                </p>
                <p className="text-sky-400 mt-2">
                  export function VietQrCheckoutModal(&#123; orderId, amountVnd &#125;) &#123;
                </p>
                <p className="pl-4 text-slate-300">
                  const qrUrl =
                  `https://qr.sepay.vn/img?acc=0988776655&bank=MBBank&amount=$&#123;amountVnd&#125;&des=$&#123;orderId&#125;`;
                </p>
                <p className="pl-4 text-emerald-400">
                  const [status, setStatus] = useRealtimeWebhookStatus(orderId);
                </p>
                <p className="pl-4 text-slate-300">
                  if (status === "PAID") return &lt;SuccessUpgradeAlert tier="PRO" /&gt;;
                </p>
                <p className="pl-4 text-slate-300">
                  return &lt;img src=&#123;qrUrl&#125; alt="VietQR SePay" className="rounded-xl
                  shadow-lg" /&gt;;
                </p>
                <p className="text-sky-400">&#125;</p>
              </div>
            )}
            {activeTab === "worker_be" && (
              <div>
                <p className="text-slate-500">
                  // [Worker-2 Backend - Claude Haiku 3.5] High-Throughput Idempotent SePay Webhook
                  Handler
                </p>
                <p className="text-purple-400 mt-2">
                  func HandleSepayWebhook(w http.ResponseWriter, r *http.Request) &#123;
                </p>
                <p className="pl-4 text-slate-300">
                  payload := ParseAndVerifyHmac(r.Body, secretKey)
                </p>
                <p className="pl-4 text-emerald-400">
                  err := db.Exec("INSERT INTO billing_tx (id, amount, status) VALUES (?, ?,
                  'COMPLETED') ON CONFLICT DO NOTHING")
                </p>
                <p className="pl-4 text-slate-300">
                  quotaEngine.GrantCredits(payload.UserId, payload.Credits)
                </p>
                <p className="pl-4 text-slate-300">
                  json.NewEncoder(w).Encode(map[string]bool&#123;"success": true&#125;)
                </p>
                <p className="text-purple-400">&#125;</p>
              </div>
            )}
            {activeTab === "challenger" && (
              <div>
                <p className="text-slate-500">
                  // [Challenger Agent - GPT-5.6 Terra Core] Adversarial Fuzzing & Race Condition
                  Injection
                </p>
                <p className="text-rose-400 mt-2">
                  def test_adversarial_webhook_idempotency_stress():
                </p>
                <p className="pl-4 text-slate-300">
                  results = parallel_post("/api/billing/sepay-webhook", concurrency=50,
                  duplicate_order="ZC891234")
                </p>
                <p className="pl-4 text-emerald-400">assert results.status_200_count == 50</p>
                <p className="pl-4 text-emerald-400">
                  assert db.query("SELECT COUNT(*) FROM billing_tx WHERE id='ZC891234'") == 1
                </p>
                <p className="pl-4 text-slate-300">
                  print("[PASSED] Idempotency barrier verified. Zero duplicate credits.")
                </p>
              </div>
            )}
            {activeTab === "auditor" && (
              <div>
                <p className="text-slate-500">
                  // [Auditor Agent - Claude Opus 5.5 Titanium] Sovereign Stealth Forensic Audit
                </p>
                <p className="text-emerald-400 mt-2">
                  [AUDIT-1] Outbound Telemetry Scan: 0 bytes outbound (cloudcode-pa, segment,
                  sentry: BLOCKED)
                </p>
                <p className="text-emerald-400">
                  [AUDIT-2] Passive Mathematical Quota: Local RAM simulation ledger verified (0.02ms
                  latency)
                </p>
                <p className="text-emerald-400">
                  [AUDIT-3] Cluster Privacy Guard: 0 internal node names leaked in public bundles
                </p>
                <p className="text-amber-400 mt-2">
                  [VERDICT] VICTORY CONFIRMED. System Ready For Enterprise Rollout.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── INTERACTIVE PDCA SWARM WORKFLOW SECTION ── */}
      <section
        id="workflow"
        className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-slate-800/80"
      >
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-amber-400 text-xs font-medium border border-slate-800 mb-3">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
            <span>Quy Trình Tự Trị Khép Kín</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
            Vòng Lặp PDCA Đa Tác Nhân: Từ Ý Tưởng Đến Production
          </h2>
          <p className="mt-3 text-slate-400 text-sm sm:text-base">
            Không cần can thiệp thủ công từng dòng mã. Swarm tự lập kế hoạch, tự viết mã song song,
            tự phản biện bẻ gãy và tự động triển khai.
          </p>
        </div>

        {/* 4-Step Interactive Navigation */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { step: 1, title: "1. PLAN", role: "Architect Agent", desc: "Lập kiến trúc & SLA" },
            { step: 2, title: "2. DO", role: "Parallel Workers", desc: "Vibe coding song song" },
            { step: 3, title: "3. CHECK", role: "Challenger Agent", desc: "Phản biện bẻ gãy bug" },
            { step: 4, title: "4. ACT", role: "Auditor Agent", desc: "Tự vá lỗi & Rollout K8s" },
          ].map((item) => (
            <button
              key={item.step}
              onClick={() => setActivePdcaStep(item.step)}
              className={`p-4 rounded-xl text-left border transition-all cursor-pointer ${
                activePdcaStep === item.step
                  ? "bg-slate-900 border-amber-500 ring-2 ring-amber-500/20 shadow-lg shadow-amber-500/10"
                  : "bg-slate-900/40 border-slate-800/80 hover:bg-slate-900/60"
              }`}
            >
              <div
                className={`text-xs font-mono font-bold ${activePdcaStep === item.step ? "text-amber-400" : "text-slate-400"}`}
              >
                {item.title}
              </div>
              <div className="text-sm font-bold text-white mt-1">{item.role}</div>
              <div className="text-xs text-slate-400 mt-1">{item.desc}</div>
            </button>
          ))}
        </div>

        {/* PDCA Step Detail Card */}
        <div className="p-8 rounded-3xl bg-slate-900/60 border border-slate-800">
          {activePdcaStep === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <span className="text-xs font-mono text-amber-400 font-bold uppercase tracking-wider">
                  Giai Đoạn 1: Lập Kế Hoạch & Kiến Trúc
                </span>
                <h3 className="text-2xl font-bold text-white mt-2">
                  Architect Agent: Phân Rã Hệ Thống
                </h3>
                <p className="text-slate-300 text-sm mt-3 leading-relaxed">
                  Agent Architect tiếp nhận yêu cầu từ người dùng, đối chiếu với các ràng buộc SLA
                  (p95 &lt; 200ms, Zero Outbound Telemetry) và tự động tạo ma trận nhiệm vụ cho từng
                  worker chuyên trách.
                </p>
                <ul className="mt-4 space-y-2 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Tạo System Design &
                    Database Schema PostgreSQL
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Xác định ranh giới module
                    tránh xung đột code
                  </li>
                </ul>
              </div>
              <div className="p-5 rounded-2xl bg-slate-950 font-mono text-xs text-slate-300 border border-slate-800">
                <span className="text-slate-500">// ARCHITECT_BRIEFING.md</span>
                <p className="text-amber-400 mt-2">Objective: Full-Stack VietQR Billing Gateway</p>
                <p className="text-slate-400">
                  Milestones: [M1: Ingress, M2: Billing DB, M3: SLA Benchmark]
                </p>
                <p className="text-emerald-400">Security Gate: Sovereign Stealth Mode Enabled</p>
              </div>
            </div>
          )}

          {activePdcaStep === 2 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <span className="text-xs font-mono text-sky-400 font-bold uppercase tracking-wider">
                  Giai Đoạn 2: Thực Thi Song Song
                </span>
                <h3 className="text-2xl font-bold text-white mt-2">
                  Workers Swarm: Parallel Vibe Coding
                </h3>
                <p className="text-slate-300 text-sm mt-3 leading-relaxed">
                  Thay vì một AI viết code tuần tự, Zencode điều phối đồng thời nhiều Worker giải
                  quyết song song Frontend, Backend, Database và API Integration mà không nghẽn tài
                  nguyên.
                </p>
                <ul className="mt-4 space-y-2 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-sky-400" /> Worker-1: Xây dựng UI React /
                    Vite / Tailwind
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-sky-400" /> Worker-2: Viết REST API &
                    Webhook SePay Backend
                  </li>
                </ul>
              </div>
              <div className="p-5 rounded-2xl bg-slate-950 font-mono text-xs text-slate-300 border border-slate-800">
                <span className="text-slate-500">// PARALLEL DISPATCH LOG</span>
                <p className="text-sky-400 mt-2">&gt; Dispatching worker_fe to packages/app</p>
                <p className="text-purple-400">&gt; Dispatching worker_be to packages/server</p>
                <p className="text-emerald-400">
                  &gt; Concurrency speedup: 3.4x faster than sequential coding
                </p>
              </div>
            </div>
          )}

          {activePdcaStep === 3 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <span className="text-xs font-mono text-rose-400 font-bold uppercase tracking-wider">
                  Giai Đoạn 3: Thẩm Định Đối Kháng
                </span>
                <h3 className="text-2xl font-bold text-white mt-2">
                  Challenger Agent: Bẻ Gãy & Tìm Bug
                </h3>
                <p className="text-slate-300 text-sm mt-3 leading-relaxed">
                  Agent Challenger đóng vai trò Red Team, chuyên thực thi các kịch bản stress-test,
                  chèn payload độc hại, thử nghiệm lỗi race condition và kiểm tra lỗ hổng bảo mật.
                </p>
                <ul className="mt-4 space-y-2 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-rose-400" /> Phát hiện lỗi CORS wildcard
                    và rò rỉ dữ liệu
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-rose-400" /> Stress test 100 concurrent
                    requests tới API SePay
                  </li>
                </ul>
              </div>
              <div className="p-5 rounded-2xl bg-slate-950 font-mono text-xs text-slate-300 border border-slate-800">
                <span className="text-slate-500">// CHALLENGER ADVERSARIAL AUDIT</span>
                <p className="text-rose-400 mt-2">&gt; Fuzzing test: sending NaN transferAmount</p>
                <p className="text-amber-400">&gt; Flagged: Unchecked input parameter in gateway</p>
                <p className="text-emerald-400">&gt; Remediation task enqueued automatically</p>
              </div>
            </div>
          )}

          {activePdcaStep === 4 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <span className="text-xs font-mono text-emerald-400 font-bold uppercase tracking-wider">
                  Giai Đoạn 4: Tự Vá Lỗi & Triển Khai
                </span>
                <h3 className="text-2xl font-bold text-white mt-2">
                  Auditor Agent: Tự Sửa & Production Rollout
                </h3>
                <p className="text-slate-300 text-sm mt-3 leading-relaxed">
                  Auditor tổng hợp toàn bộ báo cáo, xác nhận 100% test case vượt qua, kiểm tra zero
                  telemetry và tự động kích hoạt rollout lên cụm Kubernetes một cách an toàn.
                </p>
                <ul className="mt-4 space-y-2 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Báo cáo Victory Audit xác
                    nhận chất lượng đạt 94.5%
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Rollout Kubernetes Pods
                    không gây gián đoạn dịch vụ
                  </li>
                </ul>
              </div>
              <div className="p-5 rounded-2xl bg-slate-950 font-mono text-xs text-slate-300 border border-slate-800">
                <span className="text-slate-500">// VICTORY_AUDIT_REPORT.md</span>
                <p className="text-emerald-400 mt-2">&gt; S-Curve Maturity: 94.5%</p>
                <p className="text-emerald-400">&gt; SLA Latency: 89.57ms (Target &lt; 200ms)</p>
                <p className="text-emerald-400">&gt; Rollout: 1/1 Pods Running, Ingress Synced</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── 8-MODEL SELECTION & CREDITS MATRIX SECTION ── */}
      <section
        id="models"
        className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-slate-800/80"
      >
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-amber-400 text-xs font-medium border border-slate-800 mb-3">
            <Layers className="w-3.5 h-3.5" />
            <span>Ma Trận Model & Hệ Số Qui Đổi</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
            Tự Do Lựa Chọn Từng Model Theo Nhu Cầu
          </h2>
          <p className="mt-3 text-slate-400 text-sm sm:text-base">
            Người dùng có thể chỉ định chính xác Model phục vụ cho từng nhiệm vụ. Hệ thống áp dụng
            hệ số tiêu hao minh bạch dựa trên giá trị thị trường thực tế.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {MODELS_CATALOG.map((m) => {
            const isSelected = selectedModel === m.id;
            return (
              <div
                key={m.id}
                onClick={() => setSelectedModel(m.id)}
                className={`relative p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? "bg-slate-900 border-amber-500 ring-2 ring-amber-500/20 shadow-xl shadow-amber-500/10"
                    : "bg-slate-900/40 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/70"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      {m.provider}
                    </span>
                    {m.multiplier === 0 ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        0x FREE
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {m.multiplier}x Multiplier
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">{m.name}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mb-4">{m.desc}</p>
                </div>

                <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
                  <div className="text-xs text-slate-300">
                    <span className="text-slate-400">Chi phí: </span>
                    <strong className="text-amber-400">
                      {m.multiplier === 0 ? "0 Z-Credits" : `${m.multiplier * 10} Credits/10k tok`}
                    </strong>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                      isSelected
                        ? "bg-amber-500 text-slate-950 font-bold"
                        : "border border-slate-700 text-transparent"
                    }`}
                  >
                    ✓
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Model Details Banner */}
        <div className="mt-8 p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-amber-500/30 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                Đang xem cấu hình:
              </div>
              <div className="text-lg font-bold text-white">
                {currentModel.name} ({currentModel.multiplier}x)
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {currentModel.multiplier === 0
                  ? "Tác vụ chạy qua cụm Clef ONNX / Local Edge không bị trừ Credits."
                  : `1.000 tokens tiêu tốn ~${currentModel.multiplier} Z-Credits.`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button
              disabled
              className="w-full md:w-auto px-5 py-2.5 rounded-xl bg-slate-800 text-slate-400 font-bold text-xs flex items-center justify-center gap-2 cursor-not-allowed opacity-75 border border-slate-700 shadow-none"
              title="Cổng thanh toán VietQR đang được cấu hình tài khoản Production"
            >
              <span>Nạp Credits (Tạm Đóng)</span>
              <CreditCard className="w-3.5 h-3.5 text-slate-500" />
            </button>
          </div>
        </div>
      </section>

      {/* ── SECURITY COMPARISON MATRIX (ZENCODE VS TRADITIONAL) ── */}
      <section
        id="security"
        className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-slate-800/80"
      >
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-emerald-400 text-xs font-medium border border-slate-800 mb-3">
            <Shield className="w-3.5 h-3.5" />
            <span>Tiêu Chuẩn Chủ Quyền Dữ Liệu</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
            So Sánh: Zencode vs. Công Cụ AI Truyền Thống
          </h2>
          <p className="mt-3 text-slate-400 text-sm sm:text-base">
            Bảo vệ tuyệt đối mã nguồn độc quyền của doanh nghiệp với Sovereign Stealth Mode.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-950/80 text-slate-300 font-mono border-b border-slate-800">
              <tr>
                <th className="p-4 sm:p-5 font-bold">Tiêu Chí Kỹ Thuật</th>
                <th className="p-4 sm:p-5 font-bold text-amber-400 bg-amber-950/20 border-x border-amber-500/20">
                  ZENCODE.VN
                </th>
                <th className="p-4 sm:p-5 font-normal text-slate-400">Cursor / Windsurf</th>
                <th className="p-4 sm:p-5 font-normal text-slate-400">GitHub Copilot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              <tr>
                <td className="p-4 sm:p-5 font-semibold text-white">Zero Outbound Telemetry</td>
                <td className="p-4 sm:p-5 font-bold text-emerald-400 bg-amber-950/10 border-x border-amber-500/20">
                  ✅ 100% Miễn nhiễm thu thập
                </td>
                <td className="p-4 sm:p-5 text-slate-500">❌ Gửi log về cloud server</td>
                <td className="p-4 sm:p-5 text-slate-500">❌ Thu thập code telemetry</td>
              </tr>
              <tr>
                <td className="p-4 sm:p-5 font-semibold text-white">Đội Ngũ AI Tự Trị (Swarm)</td>
                <td className="p-4 sm:p-5 font-bold text-emerald-400 bg-amber-950/10 border-x border-amber-500/20">
                  ✅ 5 Agents phân nhiệm song song
                </td>
                <td className="p-4 sm:p-5 text-slate-400">⚠️ Single-agent Chat / Tab</td>
                <td className="p-4 sm:p-5 text-slate-500">❌ Gợi ý dòng mã tuần tự</td>
              </tr>
              <tr>
                <td className="p-4 sm:p-5 font-semibold text-white">Thanh Toán & Hóa Đơn VAT</td>
                <td className="p-4 sm:p-5 font-bold text-emerald-400 bg-amber-950/10 border-x border-amber-500/20">
                  ✅ VietQR 3 giây + Xuất VAT
                </td>
                <td className="p-4 sm:p-5 text-slate-500">❌ Thẻ tín dụng quốc tế (USD)</td>
                <td className="p-4 sm:p-5 text-slate-500">❌ Thẻ tín dụng quốc tế (USD)</td>
              </tr>
              <tr>
                <td className="p-4 sm:p-5 font-semibold text-white">
                  Cụm GPU Hybrid (Local + Cloud)
                </td>
                <td className="p-4 sm:p-5 font-bold text-emerald-400 bg-amber-950/10 border-x border-amber-500/20">
                  ✅ On-premise K8s + Cloud GPU
                </td>
                <td className="p-4 sm:p-5 text-slate-500">❌ Khóa chặt vào máy chủ nhà cung cấp</td>
                <td className="p-4 sm:p-5 text-slate-500">❌ Khóa chặt vào Azure</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── PRICING & VIETQR BILLING SECTION ── */}
      <section
        id="pricing"
        className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-slate-800/80"
      >
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-amber-400 text-xs font-medium border border-slate-800 mb-3">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>VietQR Đang Chờ Cấu Hình Production</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
            Bảng Giá Đơn Giản, Tiết Kiệm & Minh Bạch
          </h2>
          <p className="mt-3 text-slate-400 text-sm sm:text-base">
            Cổng thanh toán tự động VietQR đang tạm đóng để kết nối tài khoản ngân hàng và mã QR
            Production chính thức.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* FREE TIER */}
          <div className="p-7 rounded-3xl bg-slate-900/40 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                GÓI CƠ BẢN
              </div>
              <h3 className="text-2xl font-black text-white">Miễn Phí</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-black text-white">0đ</span>
                <span className="text-xs text-slate-400">/ mãi mãi</span>
              </div>
              <p className="mt-4 text-xs text-slate-400 leading-relaxed">
                Hoàn hảo cho sinh viên, lập trình viên cá nhân trải nghiệm Zencode IDE và mô hình
                Llama Clef.
              </p>

              <div className="mt-6 space-y-3 text-xs text-slate-300">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>1.000.000 tokens / ngày (Codex, Flash, Clef)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Tặng sẵn 200 Z-Credits khi tạo tài khoản</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>1.000 requests Clef Local Edge / ngày</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowGoogleModal(true)}
              className="mt-8 w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Bắt Đầu Miễn Phí
            </button>
          </div>

          {/* PRO TIER (HERO) */}
          <div className="relative p-7 rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-amber-500 shadow-2xl shadow-amber-500/20 flex flex-col justify-between">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-black text-[11px] tracking-wide uppercase">
              KHUYÊN DÙNG CHO PRO DEVS
            </div>

            <div>
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
                GÓI CHUYÊN NGHIỆP
              </div>
              <h3 className="text-2xl font-black text-white">Zencode Pro</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-black text-amber-400">499.000đ</span>
                <span className="text-xs text-slate-400">/ tháng</span>
              </div>
              <p className="mt-4 text-xs text-slate-300 leading-relaxed">
                Đầy đủ sức mạnh của cụm Swarm 5 Agent tự trị, Claude Sonnet 4.6, GPT-5.6 Terra và hỗ
                trợ đa mô hình.
              </p>

              <div className="mt-6 space-y-3 text-xs text-slate-200">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    <strong>5.000 Z-Credits</strong> tốc độ cao / tháng
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Mở khóa <strong>Claude Sonnet 4.6, Pro 2.5 & Terra</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Điều phối <strong>5 Agent Swarm</strong> chạy song song
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Sovereign Stealth Isolation 100%</span>
                </div>
              </div>
            </div>

            <button
              disabled
              className="mt-8 w-full py-3.5 rounded-xl bg-slate-800 text-slate-400 font-bold text-xs sm:text-sm border border-slate-700 cursor-not-allowed opacity-80 flex items-center justify-center gap-2 shadow-none"
              title="Cổng thanh toán VietQR đang chờ cập nhật tài khoản Production"
            >
              <Clock className="w-4 h-4 text-amber-400" />
              <span>VietQR Đang Chờ Cấu Hình Production</span>
            </button>
          </div>

          {/* ENTERPRISE / TEAM */}
          <div className="p-7 rounded-3xl bg-slate-900/40 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                DOANH NGHIỆP
              </div>
              <h3 className="text-2xl font-black text-white">Enterprise Cluster</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-black text-white">Liên hệ</span>
                <span className="text-xs text-slate-400">/ theo nhu cầu</span>
              </div>
              <p className="mt-4 text-xs text-slate-400 leading-relaxed">
                Dành cho công ty công nghệ, ngân hàng, studio game cần Private Cluster cô lập trên
                hạ tầng on-premise.
              </p>

              <div className="mt-6 space-y-3 text-xs text-slate-300">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Triển khai cụm Kubernetes riêng biệt trên on-premise</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Claude Opus 5.5 không giới hạn</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Hỗ trợ xuất hóa đơn VAT điện tử doanh nghiệp</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Cam kết SLA 99.99% và bảo mật tiêu chuẩn ISO</span>
                </div>
              </div>
            </div>

            <a
              href="mailto:contact@zencode.vn?subject=Tu%20van%20Zencode%20Enterprise"
              className="mt-8 block text-center py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Liên Hệ Đội Ngũ Kỹ Thuật
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-slate-800/80 py-12 px-6 lg:px-12 max-w-7xl mx-auto text-slate-500 text-xs flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2 text-slate-400 font-medium">
          <div className="w-6 h-6 rounded-lg bg-amber-500 flex items-center justify-center font-black text-slate-950 text-xs">
            Z
          </div>
          <span>
            &copy; 2026 Zencode.vn • Nền tảng phát triển bởi Zencode Systems. Bảo lưu mọi quyền.
          </span>
        </div>

        <div className="flex items-center gap-6">
          <a href="#models" className="hover:text-slate-300 transition-colors">
            Mô Hình AI
          </a>
          <a href="#pricing" className="hover:text-slate-300 transition-colors">
            Bảng Giá
          </a>
          <a href="#security" className="hover:text-slate-300 transition-colors">
            Bảo Mật
          </a>
          <a href="mailto:contact@zencode.vn" className="hover:text-slate-300 transition-colors">
            Hỗ Trợ Kỹ Thuật
          </a>
        </div>
      </footer>

      {/* ── VIETQR SEPAY CHECKOUT MODAL (DISABLED PENDING PROD QR) ── */}
      {showCheckoutModal && false && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative">
            <button
              onClick={() => setShowCheckoutModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
              <QrCode className="w-4 h-4" />
              <span>Thanh Toán VietQR Tự Động (SePay Gateway)</span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">{currentPlan.name}</h3>
            <p className="text-xs text-slate-400 mb-6">
              Mở ứng dụng ngân hàng hoặc ví điện tử (Vietcombank, MB, Techcombank, MoMo...) để quét
              mã QR bên dưới.
            </p>

            {/* QR Code Container */}
            <div className="bg-white p-4 rounded-2xl flex flex-col items-center justify-center shadow-inner mb-6">
              <img
                src={`https://qr.sepay.vn/img?acc=0988776655&bank=MBBank&amount=${currentPlan.price}&des=${orderCode}`}
                alt="VietQR SePay Transfer"
                className="w-48 h-48 object-contain"
              />
              <span className="text-[10px] text-slate-500 font-mono mt-2">
                Mã QR động nạp tiền tự động qua SePay
              </span>
            </div>

            {/* Bank Transfer Details */}
            <div className="space-y-2.5 text-xs bg-slate-950 p-4 rounded-xl border border-slate-800/80 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Ngân hàng:</span>
                <strong className="text-white">MBBank (Quân Đội)</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Số tài khoản:</span>
                <strong className="text-white">0988776655</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Số tiền:</span>
                <strong className="text-emerald-400">
                  {currentPlan.price.toLocaleString("vi-VN")} đ
                </strong>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                <span className="text-slate-400">Nội dung CK:</span>
                <div className="flex items-center gap-1.5">
                  <strong className="text-amber-400 font-bold">{orderCode}</strong>
                  <button
                    onClick={handleCopyOrder}
                    className="p-1 hover:bg-slate-800 rounded text-slate-300 cursor-pointer"
                    title="Sao chép nội dung"
                  >
                    {copiedCode ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  alert(
                    "Giao dịch đang được SePay đối soát tự động. Khi hoàn tất, tài khoản sẽ tự động kích hoạt!",
                  );
                  setShowCheckoutModal(false);
                }}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 cursor-pointer transition-all"
              >
                Tôi Đã Chuyển Khoản Thành Công
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GOOGLE 1-CLICK AUTH MODAL ── */}
      {showGoogleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl relative text-center">
            <button
              onClick={() => setShowGoogleModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
            >
              ✕
            </button>

            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4 text-amber-400">
              <Sparkles className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-white mb-1">Đăng Nhập 1-Click</h3>
            <p className="text-xs text-slate-400 mb-6">
              Đăng nhập qua Google OAuth để nhận ngay 200 Z-Credits trải nghiệm miễn phí toàn bộ mô
              hình AI.
            </p>

            <button
              onClick={handleSimulateGoogleLogin}
              className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs sm:text-sm flex items-center justify-center gap-3 shadow-md transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.14z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Tiếp Tục Với Tài Khoản Google</span>
            </button>

            <div className="mt-4 text-[10px] text-slate-500">
              Cam kết không lưu trữ mật khẩu, bảo mật dữ liệu tuyệt đối theo tiêu chuẩn Google OAuth
              2.0.
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST SUCCESS ── */}
      {showWaitlistToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-md text-emerald-400 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom duration-300">
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          <span className="text-xs font-semibold">
            Đã ghi nhận yêu cầu VIP của bạn! Chúng tôi sẽ gửi thư mời sớm nhất.
          </span>
        </div>
      )}
    </div>
  );
}
