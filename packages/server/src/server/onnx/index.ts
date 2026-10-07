import { ClefUpstreamClient } from "./clef-upstream-client.js";
import {
  AutonomousEvolutionEvaluator,
  PeriodicMemoryConsolidator,
  TokenomicsAdmissionController,
} from "./local-onnx-engine.js";

export * from "./types.js";
export * from "./clef-upstream-client.js";
export * from "./local-onnx-engine.js";
export * from "./clef-hit-logger.js";
export * from "./cloudflare-free-pool-router.js";

/**
 * Zencode Unified Dual ONNX Engine
 * Bridges Upstream Cloudflare Clef (SystemOne) with Local Zero-Cost Substrate
 */
export class DualOnnxEngine {
  public readonly upstreamClef: ClefUpstreamClient;
  public readonly memoryConsolidator: PeriodicMemoryConsolidator;
  public readonly evolutionEvaluator: AutonomousEvolutionEvaluator;
  public readonly admissionController: TokenomicsAdmissionController;

  constructor(options?: {
    clefEndpoint?: string;
    clefApiToken?: string;
    localConfidenceFloor?: number;
  }) {
    this.upstreamClef = new ClefUpstreamClient({
      endpoint: options?.clefEndpoint,
      apiToken: options?.clefApiToken,
    });
    this.memoryConsolidator = new PeriodicMemoryConsolidator();
    this.evolutionEvaluator = new AutonomousEvolutionEvaluator();
    this.admissionController = new TokenomicsAdmissionController({
      localConfidenceFloor: options?.localConfidenceFloor,
    });
  }
}

let instance: DualOnnxEngine | null = null;

export function getDualOnnxEngine(): DualOnnxEngine {
  if (!instance) {
    instance = new DualOnnxEngine();
  }
  return instance;
}
