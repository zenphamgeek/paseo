import { describe, it, expect } from "vitest";
import {
  ZENCODE_MODEL_CATALOG,
  CREATIVE_SERVICES_CONVERSION,
  isModelAccessible,
  calculateModelCapacity,
} from "./user-model-credits-matrix";

describe("Zencode Model Catalog & Credit Conversion Matrix", () => {
  it("contains curated model catalog with accurate market-based multipliers", () => {
    expect(ZENCODE_MODEL_CATALOG.length).toBeGreaterThanOrEqual(8);

    const clef = ZENCODE_MODEL_CATALOG.find((m) => m.id === "cloudflare-clef")!;
    expect(clef).toBeDefined();
    expect(clef.multiplier).toBe(0); // 0 ZC for Free Pool

    const codex = ZENCODE_MODEL_CATALOG.find((m) => m.id === "codex")!;
    expect(codex.multiplier).toBe(1.0);

    const flash = ZENCODE_MODEL_CATALOG.find((m) => m.id === "gemini-2.5-flash")!;
    expect(flash.multiplier).toBe(1.0);

    const pro = ZENCODE_MODEL_CATALOG.find((m) => m.id === "gemini-2.5-pro")!;
    expect(pro.multiplier).toBe(5.0);

    const sonnet = ZENCODE_MODEL_CATALOG.find((m) => m.id === "claude-sonnet-4.6")!;
    expect(sonnet.multiplier).toBe(12.0);

    const opus = ZENCODE_MODEL_CATALOG.find((m) => m.id === "claude-opus-4.8")!;
    expect(opus.multiplier).toBe(35.0);
    expect(opus.minTier).toBe("enterprise");
  });

  it("enforces tier accessibility rules correctly for models", () => {
    // Free tier
    expect(isModelAccessible("free", "free")).toBe(true);
    expect(isModelAccessible("pro", "free")).toBe(false);
    expect(isModelAccessible("team", "free")).toBe(false);
    expect(isModelAccessible("enterprise", "free")).toBe(false);

    // Pro tier
    expect(isModelAccessible("free", "pro")).toBe(true);
    expect(isModelAccessible("pro", "pro")).toBe(true);
    expect(isModelAccessible("team", "pro")).toBe(false);
    expect(isModelAccessible("enterprise", "pro")).toBe(false);

    // Team tier
    expect(isModelAccessible("free", "team")).toBe(true);
    expect(isModelAccessible("pro", "team")).toBe(true);
    expect(isModelAccessible("team", "team")).toBe(true);
    expect(isModelAccessible("enterprise", "team")).toBe(false);

    // Enterprise tier
    expect(isModelAccessible("free", "enterprise")).toBe(true);
    expect(isModelAccessible("pro", "enterprise")).toBe(true);
    expect(isModelAccessible("team", "enterprise")).toBe(true);
    expect(isModelAccessible("enterprise", "enterprise")).toBe(true);
  });

  it("calculates model capacities accurately based on user credits", () => {
    const userCredits = 1_000_000; // Pro tier daily budget

    // Free pool (0x)
    const clefCap = calculateModelCapacity(userCredits, 0);
    expect(clefCap.tokens).toBeNull();
    expect(clefCap.display).toContain("Không giới hạn");

    // Flash @ 1.0x -> 1,000,000 tokens
    const flashCap = calculateModelCapacity(userCredits, 1.0);
    expect(flashCap.tokens).toBe(1_000_000);
    expect(flashCap.approxResponses).toBe(2222);

    // Gemini Pro @ 5.0x -> 200,000 tokens
    const proCap = calculateModelCapacity(userCredits, 5.0);
    expect(proCap.tokens).toBe(200_000);
    expect(proCap.approxResponses).toBe(444);

    // Claude Sonnet @ 12.0x -> 83,333 tokens
    const sonnetCap = calculateModelCapacity(userCredits, 12.0);
    expect(sonnetCap.tokens).toBe(83_333);

    // Claude Opus @ 35.0x -> 28,571 tokens
    const opusCap = calculateModelCapacity(userCredits, 35.0);
    expect(opusCap.tokens).toBe(28_571);
  });

  it("defines fair market creative service exchange rates", () => {
    expect(CREATIVE_SERVICES_CONVERSION.tts.creditCostPerUnit).toBe(2500);
    expect(CREATIVE_SERVICES_CONVERSION.t2image.creditCostPerUnit).toBe(10000);
    expect(CREATIVE_SERVICES_CONVERSION.img2img.creditCostPerUnit).toBe(8000);
    expect(CREATIVE_SERVICES_CONVERSION.video.status).toBe("unsupported");
  });
});
