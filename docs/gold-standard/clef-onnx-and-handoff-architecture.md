# Zencode Gold Information — Dual ONNX & Swarm Handoff Architecture

**Version**: 1.0.0-gold  
**Classification**: Zencode Enterprise Gold Standard  
**Upstream Reference**: [https://huggingface.co/Cloudflare/clef](https://huggingface.co/Cloudflare/clef)  
**Handoff Blueprint**: RFC 8785 JCS & 3-Tier Testing (adapted from VerticalRisk)  
**Last Updated**: 2026-10-05

---

## 1. Executive Summary & Core Mission

Zencode Swarm requires an ultra-efficient, cost-controlled, and self-evolving AI runtime architecture. To prevent token cost explosion and eliminate unpredictable prompt hallucinations, Zencode employs a **Dual ONNX Engine Strategy**:

1. **Upstream Clef ONNX Tier**: Cloudflare's cutting-edge structured judgment model ([Cloudflare/clef on Hugging Face](https://huggingface.co/Cloudflare/clef)), accessed via the SystemOne protocol (`/v1/systemone`). Clef acts as a high-stakes decision council that scores candidate choices jointly in a single forward pass without autoregressive token generation.
2. **Local Zencode ONNX Tier**: In-process ONNX Runtime substrate executing at **$0 marginal token cost** across all swarm nodes. It powers three vital capabilities:
   - **Periodic Memory Consolidation**: Compacting episodic interaction logs into semantic memory embeddings with cosine similarity retrieval.
   - **Autonomous Evolution**: Local agent trajectory scoring, behavioral drift detection, and AST policy gatekeeping.
   - **Tokenomics Optimization**: Deterministic admission control, preventing unnecessary cloud LLM calls and keeping local inference free.
3. **Rigorous Handoff Discipline**: Adopting the proven VerticalRisk Gold Standard methodology (`HANDOFF.md`), enforcing RFC 8785 JSON Canonicalization Scheme (JCS), 3-tier testing (Tier 1 BaseCase, Tier 2 TransactionCase, Tier 3 CEW), and cryptographic state verification.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ZENCODE SWARM REQUEST                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
       ┌──────────────────────────────────────────────────────────┐
       │     Tokenomics Admission Controller (Local ONNX, $0)     │
       │    Evaluates complexity, intent, and remaining quota     │
       └──────────────┬────────────────────────────┬──────────────┘
                      │                            │
             (Score < Threshold)          (High-Stakes Decision)
                      │                            │
                      ▼                            ▼
       ┌──────────────────────────────┐ ┌─────────────────────────┐
       │   Local Task Handler ($0)    │ │   Upstream Clef ONNX    │
       │   Code modification, git ops │ │ (Cloudflare/clef API)   │
       │   ast validation, test exec  │ │ /v1/systemone joint head│
       └──────────────┬───────────────┘ └───────────┬─────────────┘
                      │                             │
                      │  ┌──────────────────────────┘
                      ▼  ▼
       ┌──────────────────────────────────────────────────────────┐
       │                Episodic Interaction Log                  │
       └────────────────────────────┬─────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
       ┌─────────────────────────┐    ┌──────────────────────────┐
       │ Periodic Memory Engine  │    │  Autonomous Evolution    │
       │ (Compaction & Semantic  │    │  (Trajectory Scoring,    │
       │  Vector Embeddings)     │    │   Drift, AST Policy)     │
       └─────────────────────────┘    └──────────────────────────┘
```

---

## 2. Upstream Clef ONNX: Cloudflare Clef Specifications

### 2.1 Model Identity & Hugging Face Upstream

- **Official Model Repository**: [`https://huggingface.co/Cloudflare/clef`](https://huggingface.co/Cloudflare/clef)
- **Model Name**: `Cloudflare/clef` & `Cloudflare/clef-flash`
- **Backbone Architecture**: Multimodal vision-language foundation (Qwen backbone) augmented with an auxiliary **Joint Schema Head**.
- **Execution Mechanism**:
  - Accepts state context (text, conversation history, AST snippet, or image/video frames) and a typed question schema (`choices`, `scores`, or `boolean`).
  - Evaluates all candidate outcomes **jointly in a single prefill forward pass**.
  - Bypasses autoregressive text generation completely. Output is produced directly from classification logits.
  - Zero prompt drift, zero markdown parsing failures, and zero JSON schema violations.

### 2.2 SystemOne API Protocol (`/v1/systemone`)

Clef endpoints serve requests over the SystemOne specification:

```http
POST /v1/systemone HTTP/1.1
Host: api.cloudflare.com
Authorization: Bearer <ZENCODE_CLEF_API_TOKEN>
Content-Type: application/json

{
  "task_id": "zencode-task-9481",
  "context": {
    "prompt": "Evaluate whether refactoring `router/index.ts` requires escalating to Claude Opus 4.8 or can be safely resolved locally.",
    "code_diff": "...",
    "risk_level": "medium"
  },
  "schema": {
    "question": "Select the optimal execution target",
    "type": "choice",
    "options": [
      { "id": "execute_local", "label": "Execute locally with Local ONNX Engine ($0 token cost)" },
      { "id": "escalate_fleet_pro", "label": "Escalate to Fleet Pro Node (Gemini 3.8 Flash High)" },
      { "id": "escalate_fleet_ultra", "label": "Escalate to Fleet Ultra Node (Claude Opus 4.8 / 5.5)" }
    ]
  }
}
```

**Expected Response**:

```json
{
  "decision_id": "dec-a7f1e94b-20261005",
  "schema_version": "clef.systemone.v1",
  "scores": {
    "execute_local": 0.88,
    "escalate_fleet_pro": 0.09,
    "escalate_fleet_ultra": 0.03
  },
  "selected_option": "execute_local",
  "confidence": 0.88,
  "latency_ms": 42.5,
  "cost_tokens": 0
}
```

### 2.3 Failover & Circuit Breaker Semantics

Upstream Clef is wrapped with a non-blocking circuit breaker:

- **Timeout**: 1500 ms hard limit.
- **Failover Target**: Zencode Local ONNX Engine fallback.
- **State Attribution**: Every decision logs `source: "upstream_clef" | "local_onnx" | "local_fallback"` to guarantee transparent telemetry.

---

## 3. Zencode Local ONNX Engine — Project Swarm Substrate

The Local ONNX Engine is embedded directly into Zencode server processes (`packages/server/src/server/onnx/`). It requires zero external network calls and runs locally on CPU or local GPU/NPU.

### 3.1 Periodic Memory Consolidation

Long-running agent sessions generate hundreds of raw episodic events (tool calls, terminal outputs, error messages). Unchecked context growth leads to token exhaustion and latency degradation.

The **Periodic Memory Consolidator**:

1. **Episodic Windowing**: Records interaction events into an append-only ring buffer.
2. **Compaction Cycle**: Triggers every $N$ turns or during node idle cycles.
3. **Semantic Embedding**: Embeds key insights and architectural decisions into vector space using an ONNX-quantized embedding model.
4. **Vector Retrieval**: Computes cosine similarity across stored semantic memories to rehydrate agent context with high relevance ($k$-NN) and zero prompt bloat.
5. **Audit Provenance**: Retains cryptographic hashes linking each consolidated semantic record back to its originating raw episodes.

### 3.2 Autonomous Evolution & Trajectory Scoring

To allow the swarm to continuously improve without human micro-management:

1. **Trajectory Scorer**: Computes a multi-dimensional fitness score $S \in [0, 1]$ for completed tasks:
   $$S = w_1 \cdot \text{Success} + w_2 \cdot (1 - \text{ToolErrorRate}) + w_3 \cdot \text{StepEfficiency} - w_4 \cdot \text{TokenCost}$$
2. **Behavioral Drift Detector**: Maintains a rolling EWMA of execution metrics. Triggers alerts if retry rates, latency spikes, or regression frequencies deviate by $> 2.5\sigma$.
3. **AST Policy Gatekeeper**: Analyzes syntax trees prior to committing code:
   - Detects banned API patterns (e.g., hardcoded credentials, unauthenticated endpoints).
   - Verifies compliance with Zencode design standards (strict typing, zero `any`, proper error handling).

### 3.3 Tokenomics Admission Controller

To achieve optimal tokenomics:

- All task requests pass through the Local Admission Controller before any cloud LLM is contacted.
- **Decision Matrix**:
  - Deterministic tasks (formatting, linting, unit test execution, simple refactors): Handled locally ($0 token cost).
  - Ambiguous tasks: Evaluated via local score. If confidence $\ge 0.80$, handled locally.
  - High-complexity architectural tasks: Escalated to Fleet Pro/Ultra nodes with prioritized routing.
  - When quotas are constrained: System automatically degrades to local best-effort execution, preserving continuity.

---

## 4. Handoff Methodology Standard (VerticalRisk Gold Standard)

Adapted directly from `VerticalRisk/k8s/verticalrisk/HANDOFF.md`, Zencode mandates a standardized handoff protocol for all releases and major migrations.

### 4.1 Document Structure

Every project or package `HANDOFF.md` must strictly provide:

1. **Title & Approver Header**: Date, release identifier, approver, and mandate.
2. **Candidate vs. Verified Technical State**: Explicit verification tools and pass/fail states with `[verified]` vs `[candidate]` tagging.
3. **Changes Delivered and Measured Limits**: Exact file-level modifications, architectural improvements, and measured performance numbers (latency, memory, success rates).
4. **Three-Tier Testing Architecture**:
   - **Tier 1 (BaseCase)**: Zero-DB deterministic unit tests with sub-second execution.
   - **Tier 2 (TransactionCase)**: Transactional integration runner with automatic rollback and $\Delta N = 0$ database pollution.
   - **Tier 3 (Continuous Evidence Watcher - CEW)**: Scheduled end-to-end tours producing dated, signed evidence bundles.
5. **Cryptographic Provenance Engine**: RFC 8785 JSON Canonicalization Scheme (JCS) deterministic hashing, digital signatures (Ed25519/HMAC-SHA256), and content integrity verification.
6. **Operator Continuation & Rollback Plan**: Explicit step-by-step guidance for next-shift operators.

---

## 5. Verification & Telemetry Standards

| Metric                           | Target               | Measurement Method                                       |
| -------------------------------- | -------------------- | -------------------------------------------------------- |
| Local Admission Decision Latency | $\le 5\text{ ms}$    | High-resolution timer in `TokenomicsAdmissionController` |
| Upstream Clef Decision Latency   | $\le 1500\text{ ms}$ | Circuit breaker timeout in `ClefUpstreamClient`          |
| Local Memory Consolidation Ratio | $\ge 5:1$            | Episode bytes compressed into semantic vector embeddings |
| Tier 1 Unit Test Gate            | 100% Pass            | `vitest run packages/server/src/server/onnx/`            |
| TypeScript & Lint Gate           | 0 Errors             | `tsgo --noEmit` & `oxlint`                               |

---

## 6. Official Citations & Links

- **Hugging Face Model Card**: [https://huggingface.co/Cloudflare/clef](https://huggingface.co/Cloudflare/clef)
- **RFC 8785 JSON Canonicalization Scheme**: [https://www.rfc-editor.org/rfc/rfc8785](https://www.rfc-editor.org/rfc/rfc8785)
- **VerticalRisk Gold Standard Handoff Reference**: `file:///home/zen/VerticalRisk/k8s/verticalrisk/HANDOFF.md`
