export interface ServiceBrandMeta {
  bg: string;
  border: string;
  color: string;
  name: string;
}

export function getServiceBrandMeta(provider: string): ServiceBrandMeta {
  const p = provider.toLowerCase();
  switch (p) {
    case "antigravity":
    case "agy":
    case "gemini":
      return {
        bg: "rgba(66, 133, 244, 0.14)",
        border: "rgba(66, 133, 244, 0.35)",
        color: "#4285F4",
        name: "Google Antigravity",
      };
    case "opencode":
    case "9router":
      return {
        bg: "rgba(16, 185, 129, 0.14)",
        border: "rgba(16, 185, 129, 0.35)",
        color: "#10B981",
        name: "OpenCode Engine",
      };
    case "opencode-go":
      return {
        bg: "rgba(0, 173, 216, 0.14)",
        border: "rgba(0, 173, 216, 0.35)",
        color: "#00ADD8",
        name: "OpenCode Go",
      };
    case "codex":
    case "openai":
      return {
        bg: "rgba(16, 163, 127, 0.14)",
        border: "rgba(16, 163, 127, 0.35)",
        color: "#10A37F",
        name: "OpenAI Codex",
      };
    case "claude":
    case "anthropic":
      return {
        bg: "rgba(217, 119, 6, 0.14)",
        border: "rgba(217, 119, 6, 0.35)",
        color: "#D97706",
        name: "Anthropic Claude",
      };
    case "copilot":
      return {
        bg: "rgba(56, 189, 248, 0.14)",
        border: "rgba(56, 189, 248, 0.35)",
        color: "#38BDF8",
        name: "GitHub Copilot",
      };
    case "cursor":
      return {
        bg: "rgba(129, 140, 248, 0.14)",
        border: "rgba(129, 140, 248, 0.35)",
        color: "#818CF8",
        name: "Cursor",
      };
    case "grok":
    case "xai":
      return {
        bg: "rgba(255, 255, 255, 0.08)",
        border: "rgba(255, 255, 255, 0.25)",
        color: "#FFFFFF",
        name: "xAI Grok",
      };
    case "kimi":
    case "moonshot":
      return {
        bg: "rgba(56, 189, 248, 0.14)",
        border: "rgba(56, 189, 248, 0.35)",
        color: "#38BDF8",
        name: "Moonshot Kimi",
      };
    case "minimax":
      return {
        bg: "rgba(249, 115, 22, 0.14)",
        border: "rgba(249, 115, 22, 0.35)",
        color: "#F97316",
        name: "MiniMax",
      };
    case "zai":
      return {
        bg: "rgba(99, 102, 241, 0.14)",
        border: "rgba(99, 102, 241, 0.35)",
        color: "#6366F1",
        name: "ZAI Engine",
      };
    case "muse":
      return {
        bg: "rgba(168, 85, 247, 0.14)",
        border: "rgba(168, 85, 247, 0.35)",
        color: "#A855F7",
        name: "Muse Protocol",
      };
    case "figma":
      return {
        bg: "rgba(242, 78, 30, 0.14)",
        border: "rgba(242, 78, 30, 0.35)",
        color: "#F24E1E",
        name: "Figma",
      };
    case "gdrive":
    case "google_drive":
      return {
        bg: "rgba(66, 133, 244, 0.14)",
        border: "rgba(66, 133, 244, 0.35)",
        color: "#4285F4",
        name: "Google Drive",
      };
    case "canva":
      return {
        bg: "rgba(0, 196, 204, 0.14)",
        border: "rgba(0, 196, 204, 0.35)",
        color: "#00C4CC",
        name: "Canva",
      };
    case "notion":
      return {
        bg: "rgba(255, 255, 255, 0.08)",
        border: "rgba(255, 255, 255, 0.25)",
        color: "#FFFFFF",
        name: "Notion",
      };
    case "linear":
      return {
        bg: "rgba(94, 106, 210, 0.14)",
        border: "rgba(94, 106, 210, 0.35)",
        color: "#5E6AD2",
        name: "Linear",
      };
    case "github":
      return {
        bg: "rgba(240, 246, 252, 0.10)",
        border: "rgba(240, 246, 252, 0.22)",
        color: "#F0F6FC",
        name: "GitHub",
      };
    case "telegram":
      return {
        bg: "rgba(34, 158, 217, 0.14)",
        border: "rgba(34, 158, 217, 0.35)",
        color: "#229ED9",
        name: "Telegram",
      };
    case "cloudflare":
    case "cf":
    case "workers-ai":
      return {
        bg: "rgba(243, 128, 32, 0.14)",
        border: "rgba(243, 128, 32, 0.35)",
        color: "#F38020",
        name: "Cloudflare Workers AI",
      };
    default:
      return {
        bg: "rgba(148, 163, 184, 0.10)",
        border: "rgba(148, 163, 184, 0.20)",
        color: "#94A3B8",
        name: provider,
      };
  }
}
