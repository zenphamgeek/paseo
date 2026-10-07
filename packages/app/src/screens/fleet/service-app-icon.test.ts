import { describe, expect, it } from "vitest";
import { getServiceBrandMeta } from "./service-brand-meta";

describe("ServiceAppIcon brand metadata & coverage", () => {
  const REQUIRED_PROVIDERS = [
    "antigravity",
    "opencode",
    "opencode-go",
    "codex",
    "claude",
    "copilot",
    "cursor",
    "grok",
    "kimi",
    "minimax",
    "zai",
    "muse",
    "figma",
    "gdrive",
    "canva",
    "notion",
    "linear",
    "github",
    "telegram",
  ];

  it("provides valid brand metadata for all 19 cluster services", () => {
    for (const provider of REQUIRED_PROVIDERS) {
      const meta = getServiceBrandMeta(provider);
      expect(meta).toBeDefined();
      expect(meta.name).toBeDefined();
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.color).toBeDefined();
      expect(meta.bg).toBeDefined();
      expect(meta.border).toBeDefined();
      expect(meta.name).not.toBe(provider); // should have real human brand name
    }
  });

  it("correctly identifies Figma brand attributes", () => {
    const figma = getServiceBrandMeta("figma");
    expect(figma.name).toBe("Figma");
    expect(figma.color).toBe("#F24E1E");
  });

  it("correctly identifies Google Drive brand attributes", () => {
    const gdrive = getServiceBrandMeta("gdrive");
    expect(gdrive.name).toBe("Google Drive");
    expect(gdrive.color).toBe("#4285F4");
  });

  it("correctly identifies Notion brand attributes", () => {
    const notion = getServiceBrandMeta("notion");
    expect(notion.name).toBe("Notion");
  });

  it("correctly identifies Telegram brand attributes", () => {
    const tg = getServiceBrandMeta("telegram");
    expect(tg.name).toBe("Telegram");
    expect(tg.color).toBe("#229ED9");
  });

  it("correctly identifies Canva brand attributes", () => {
    const canva = getServiceBrandMeta("canva");
    expect(canva.name).toBe("Canva");
    expect(canva.color).toBe("#00C4CC");
  });

  it("falls back gracefully for unknown custom providers", () => {
    const unknown = getServiceBrandMeta("custom-agent-xyz");
    expect(unknown.name).toBe("custom-agent-xyz");
    expect(unknown.color).toBe("#94A3B8");
  });
});
