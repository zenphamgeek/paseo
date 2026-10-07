export interface ZencodeModelMeta {
  id: string;
  name: string;
  provider: string;
  multiplier: number; // Multiplier vs 1 Z-Credit (Flash/Base token)
  marketPrice: string; // Current 2025/2026 market price
  minTier: "free" | "pro" | "team" | "enterprise";
  tag: string;
  description: string;
  accentColor: string;
}

export const ZENCODE_MODEL_CATALOG: ZencodeModelMeta[] = [
  {
    id: "cloudflare-clef",
    name: "Llama 3.3 70B (Clef Free Pool)",
    provider: "Cloudflare Workers AI",
    multiplier: 0,
    marketPrice: "$0.00 (Free Pool)",
    minTier: "free",
    tag: "Miễn Phí 0đ",
    description: "Routing dự phòng tức thì, planning clef và kiểm tra cú pháp không tốn credits.",
    accentColor: "#06b6d4",
  },
  {
    id: "codex",
    name: "Codex (Qwen 2.5 Coder / DeepSeek V3)",
    provider: "Zencode Swarm",
    multiplier: 1.0,
    marketPrice: "$0.20/1M",
    minTier: "free",
    tag: "1.0x Tiết Kiệm",
    description: "Mô hình lập trình chuyên biệt, tối ưu phản xạ sinh mã, unit test và refactor.",
    accentColor: "#10b981",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google Deepmind",
    multiplier: 1.0,
    marketPrice: "$0.15/1M",
    minTier: "free",
    tag: "1.0x Siêu Tốc",
    description: "Độ trễ cực thấp, context 1M tokens, tối ưu trao đổi và tra cứu tài liệu nhanh.",
    accentColor: "#38bdf8",
  },
  {
    id: "claude-3.5-haiku",
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    multiplier: 3.0,
    marketPrice: "$1.00/1M",
    minTier: "pro",
    tag: "3.0x Nhanh Nhạy",
    description: "Chính xác cao trong trích xuất dữ liệu JSON, chỉ dẫn tool và phân tích code.",
    accentColor: "#f59e0b",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google Deepmind",
    multiplier: 5.0,
    marketPrice: "$2.50/1M",
    minTier: "pro",
    tag: "5.0x Chuyên Sâu",
    description: "Suy luận logic đa bước sâu sắc, đọc hiểu toàn bộ codebase và cấu trúc phức tạp.",
    accentColor: "#6366f1",
  },
  {
    id: "cx/gpt-5.6-terra",
    name: "GPT-5.6 Terra (Reasoning Engine)",
    provider: "OpenAI Core",
    multiplier: 8.0,
    marketPrice: "$4.50/1M",
    minTier: "pro",
    tag: "8.0x Lập Luận",
    description: "Tư duy phân tích chiến lược, hoạch định system specs và giải quyết bài toán khó.",
    accentColor: "#ec4899",
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude 3.7 Sonnet (Agentic Master)",
    provider: "Anthropic",
    multiplier: 12.0,
    marketPrice: "$6.00/1M",
    minTier: "team",
    tag: "12.0x Flagship",
    description:
      "Tiêu chuẩn vàng cho coding agentic tự chủ: tự sửa lỗi, tự viết test và tái thiết kế.",
    accentColor: "#8b5cf6",
  },
  {
    id: "claude-opus-4.8",
    name: "Claude Opus 4.8 (Supreme Council)",
    provider: "Anthropic Enterprise",
    multiplier: 35.0,
    marketPrice: "$30.00/1M",
    minTier: "enterprise",
    tag: "35.0x Tối Cao",
    description:
      "Mô hình thẩm định kiến trúc tối thượng dành riêng cho Enterprise và System Admin.",
    accentColor: "#f43f5e",
  },
];

export const CREATIVE_SERVICES_CONVERSION = {
  tts: {
    unit: "phút thoại",
    creditCostPerUnit: 2500,
    marketBenchmark: "$0.005 / phút",
  },
  t2image: {
    unit: "ảnh HD (A100)",
    creditCostPerUnit: 10000,
    marketBenchmark: "$0.015 / ảnh",
  },
  img2img: {
    unit: "lượt inpaint",
    creditCostPerUnit: 8000,
    marketBenchmark: "$0.012 / lượt",
  },
  video: {
    unit: "video 5s",
    creditCostPerUnit: 50000,
    status: "unsupported",
    marketBenchmark: "$0.08 / video (Đang khóa)",
  },
} as const;

const TIER_ORDER: Record<string, number> = {
  free: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

export function isModelAccessible(modelMinTier: string, userTier?: string): boolean {
  const currentTier = userTier?.toLowerCase() || "pro";
  const userRank = TIER_ORDER[currentTier] ?? 2;
  const modelRank = TIER_ORDER[modelMinTier] ?? 1;
  return userRank >= modelRank;
}

export function calculateModelCapacity(
  remainingCredits: number,
  multiplier: number,
): {
  tokens: number | null;
  approxResponses: number | null;
  display: string;
} {
  if (multiplier <= 0) {
    return {
      tokens: null,
      approxResponses: null,
      display: "Không giới hạn (0 Credits)",
    };
  }

  const tokens = Math.floor(remainingCredits / multiplier);
  const approxResponses = Math.floor(tokens / 450);
  return {
    tokens,
    approxResponses,
    display: `~${tokens.toLocaleString()} tokens (≈${approxResponses.toLocaleString()} câu trả lời)`,
  };
}
