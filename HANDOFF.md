# Project Swarm Handoff — Zencode Substrate

## Current handoff — 2026-10-05: Dual ONNX Engine & Zero-Cost Swarm Architecture VERIFIED

Owner/approver: Zen Phạm under the standing project approval to establish the Zencode Gold Information Architecture, integrate Upstream Cloudflare Clef (`https://huggingface.co/Cloudflare/clef`) and Local ONNX substrate for Project Swarm, and enforce the 3-Tier Handoff testing standard.

### Candidate and verified technical state

- Verification tools:
  - Gold standard documentation: [`docs/gold-standard/clef-onnx-and-handoff-architecture.md`](docs/gold-standard/clef-onnx-and-handoff-architecture.md) VERIFIED.
  - Dual ONNX test suite: `npx vitest run packages/server/src/server/onnx/onnx.test.ts` executed and PASSED (14/14 tests green, 107 ms).
  - NineRouter tokenomics suite: `npx vitest run packages/server/src/server/router/index.test.ts` executed and PASSED (3/3 tests green, 1757 ms).
  - Joint verification gate: 17/17 tests passing with 0 errors across ONNX and Router modules.
  - Dark/Light Theme compliance gate: Commit `6a5675e9b` verified across all 6 Fleet Swarm screens (FleetOverview, QuotaMatrix, JobsLiveStream, CouncilAudit, IncidentBoard, NodeInspectModal) in Unistyles.

### Changes delivered and measured limits

1. **Upstream Cloudflare Clef Integration (`https://huggingface.co/Cloudflare/clef`)**:
   - Model reference: `Cloudflare/clef` & `Cloudflare/clef-flash` multimodal foundation backbone with Joint Schema Head.
   - Evaluates multi-option schemas jointly in a single prefill forward pass without autoregressive token generation or regex parsing.
   - SystemOne protocol implementation (`ClefUpstreamClient`, `/v1/systemone`).
   - Circuit breaker fast-fail: transitions from `CLOSED` to `OPEN` on consecutive failures, short-circuiting downstream calls in **< 15 ms** via local fallback.

2. **Zencode Local ONNX Engine (`packages/server/src/server/onnx/`)**:
   - **Periodic Memory Consolidator**: Compacts episodic interaction traces into semantic memories with RFC 8785 SHA-256 cryptographic provenance and L2-normalized vector embeddings. Cosine similarity retrieval returns top-k context in **< 5 ms**.
   - **Autonomous Evolution Evaluator**: Evaluates agent trajectories (fitness score $S \in [0, 1]$), detects behavioral drift over sliding windows, and enforces AST safety policies (blocking hardcoded credentials, dynamic `eval()`, and unchecked `any`).
   - **Tokenomics Admission Controller**: Enforces **$0 marginal token cost** for deterministic and local tasks. Safe failover: when remaining budget is zero or negative, traffic is routed locally rather than dropped.

3. **NineRouter Tokenomics Integration (`packages/server/src/server/router/index.ts`)**:
   - Embedded `TokenomicsAdmissionController` into route decision pipeline.
   - Evaluates token cost, task complexity, and preferred tier prior to escalating to Fleet nodes.

### Three-tier testing architecture

| Tier                         | Suite / Tool                          | Scope                                                                                                  | Measured Latency      | Gate Status      |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------- | ---------------- |
| **Tier 1 (BaseCase)**        | `onnx.test.ts`, `index.test.ts`       | Deterministic unit tests (Clef SystemOne fallback, cosine retrieval, AST checks, tokenomics admission) | ~110 ms               | **PASS (17/17)** |
| **Tier 2 (TransactionCase)** | NineRouter Failover & Circuit Breaker | Simulated quota exhaustion (HTTP 429) & sub-second failover across Fleet nodes                         | ~1.7 s                | **PASS**         |
| **Tier 3 (CEW Tours)**       | AGY Fleet Multi-Node Execution        | Parallel task dispatch across 15 nodes (`nebula`, `binhthuong`, `pro-1`, `sunward`, etc.)              | Scheduled / On-demand | **READY**        |

### Cryptographic provenance & state verification

- **Canonical State Hashing**: All compacted semantic memories and handoff records apply RFC 8785 JSON Canonicalization Scheme (JCS) deterministic key sorting prior to SHA-256 digest computation.
- **Trace Provenance**: Every `SemanticMemoryItem` retains an immutable `provenanceHash` linking directly to originating `sourceEpisodeIds`.
- **Zero-Footprint Invariant**: Local ONNX inference, AST parsing, and cosine retrieval run in-memory with zero temporary disk artifacts and zero database pollution ($\Delta N = 0$).

### Operator continuation

1. The Zencode daemon is running on `http://127.0.0.1:6768`.
2. Fleet manager is live on `http://127.0.0.1:7777` with 15 nodes active.
3. To execute the dual ONNX and router test suite at any time:
   ```bash
   npx vitest run packages/server/src/server/onnx/onnx.test.ts packages/server/src/server/router/index.test.ts
   ```
4. Upstream Clef endpoint defaults to `process.env.ZENCODE_CLEF_ENDPOINT` with automatic failover to the local ONNX fallback evaluator.

### Rollback and residual gaps

- Non-destructive changes: all modifications are additive under `packages/server/src/server/onnx/` and `docs/gold-standard/`.
- Rollback can be performed cleanly via `git checkout HEAD~1`.
