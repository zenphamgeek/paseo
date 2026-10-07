import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import {
  extractTraceIdentifiers,
  parseW3CTraceParent,
  CircularSpanBuffer,
  LocalSpanRecorder,
  createDistributedTracingMiddleware,
  createTraceSpansRouteHandler,
  createTracingHeaders,
  type TraceSpan,
} from "./distributed-tracing.js";

describe("Distributed Tracing & Zero-Telemetry Span Recorder", () => {
  describe("Header Parsing & Identifier Extraction", () => {
    it("extracts explicit x-trace-id and x-request-id headers", () => {
      const headers = {
        "x-trace-id": "custom-trace-1234",
        "x-request-id": "custom-req-5678",
      };
      const result = extractTraceIdentifiers(headers);
      expect(result.traceId).toBe("custom-trace-1234");
      expect(result.requestId).toBe("custom-req-5678");
    });

    it("extracts underscore trace_id and request_id headers", () => {
      const headers = {
        trace_id: "underscore-trace-999",
        request_id: "underscore-req-888",
      };
      const result = extractTraceIdentifiers(headers);
      expect(result.traceId).toBe("underscore-trace-999");
      expect(result.requestId).toBe("underscore-req-888");
    });

    it("extracts trace-id and request-id alternate headers", () => {
      const headers = {
        "trace-id": "hyphen-trace-111",
        "request-id": "hyphen-req-222",
      };
      const result = extractTraceIdentifiers(headers);
      expect(result.traceId).toBe("hyphen-trace-111");
      expect(result.requestId).toBe("hyphen-req-222");
    });

    it("extracts traceId from W3C traceparent header", () => {
      const traceParent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
      const traceId = parseW3CTraceParent(traceParent);
      expect(traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");

      const extracted = extractTraceIdentifiers({ traceparent: traceParent });
      expect(extracted.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(extracted.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("generates standard UUIDv4 identifiers when headers are missing", () => {
      const extracted = extractTraceIdentifiers({});
      const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(extracted.traceId).toMatch(uuidv4Regex);
      expect(extracted.requestId).toMatch(uuidv4Regex);
    });
  });

  describe("CircularSpanBuffer (In-Memory Ring Buffer)", () => {
    let buffer: CircularSpanBuffer;

    beforeEach(() => {
      buffer = new CircularSpanBuffer(5); // small buffer for testing wrap-around
    });

    it("records spans and tracks size and stats correctly", () => {
      const span: TraceSpan = {
        span_id: "span-1",
        trace_id: "trace-1",
        method: "GET",
        path: "/api/health",
        status_code: 200,
        duration_ms: 1.25,
        timestamp: new Date().toISOString(),
      };
      buffer.record(span);

      const stats = buffer.getStats();
      expect(stats.size).toBe(1);
      expect(stats.capacity).toBe(5);
      expect(stats.totalRecorded).toBe(1);

      const spans = buffer.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].span_id).toBe("span-1");
    });

    it("wraps around and overwrites oldest spans when capacity is exceeded", () => {
      for (let i = 1; i <= 8; i++) {
        buffer.record({
          span_id: `span-${i}`,
          trace_id: `trace-${i}`,
          method: "GET",
          path: `/api/test/${i}`,
          status_code: 200,
          duration_ms: i * 0.5,
          timestamp: new Date().toISOString(),
        });
      }

      const stats = buffer.getStats();
      expect(stats.size).toBe(5);
      expect(stats.capacity).toBe(5);
      expect(stats.totalRecorded).toBe(8);

      const spans = buffer.getSpans();
      expect(spans).toHaveLength(5);
      // Newest first
      expect(spans[0].span_id).toBe("span-8");
      expect(spans[1].span_id).toBe("span-7");
      expect(spans[2].span_id).toBe("span-6");
      expect(spans[3].span_id).toBe("span-5");
      expect(spans[4].span_id).toBe("span-4");
      // spans 1, 2, 3 were overwritten
    });

    it("filters spans by trace_id and limits result count", () => {
      buffer.record({
        span_id: "span-a",
        trace_id: "trace-target",
        method: "GET",
        path: "/api/a",
        status_code: 200,
        duration_ms: 1.0,
        timestamp: new Date().toISOString(),
      });
      buffer.record({
        span_id: "span-b",
        trace_id: "trace-other",
        method: "POST",
        path: "/api/b",
        status_code: 201,
        duration_ms: 2.0,
        timestamp: new Date().toISOString(),
      });
      buffer.record({
        span_id: "span-c",
        trace_id: "trace-target",
        method: "GET",
        path: "/api/c",
        status_code: 200,
        duration_ms: 1.5,
        timestamp: new Date().toISOString(),
      });

      const filtered = buffer.getSpans({ traceId: "trace-target" });
      expect(filtered).toHaveLength(2);
      expect(filtered[0].span_id).toBe("span-c");
      expect(filtered[1].span_id).toBe("span-a");

      const limited = buffer.getSpans({ limit: 1 });
      expect(limited).toHaveLength(1);
      expect(limited[0].span_id).toBe("span-c");
    });

    it("clears the buffer completely", () => {
      buffer.record({
        span_id: "span-1",
        trace_id: "trace-1",
        method: "GET",
        path: "/api/a",
        status_code: 200,
        duration_ms: 1.0,
        timestamp: new Date().toISOString(),
      });
      buffer.clear();
      expect(buffer.getSpans()).toHaveLength(0);
      expect(buffer.getStats().size).toBe(0);
      expect(buffer.getStats().totalRecorded).toBe(0);
    });
  });

  describe("Express Middleware Integration & Header Propagation", () => {
    let recorder: LocalSpanRecorder;
    let app: express.Express;
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      recorder = new LocalSpanRecorder(100);
      recorder.clear();

      app = express();
      app.use(createDistributedTracingMiddleware({ recorder }));

      app.get("/api/test-route", (req, res) => {
        res.json({
          message: "ok",
          traceId: req.traceId,
          requestId: req.requestId,
        });
      });

      app.get("/api/system/traces/spans", createTraceSpansRouteHandler(recorder));

      await new Promise<void>((resolve) => {
        server = app.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          if (addr && typeof addr !== "string") {
            port = addr.port;
          }
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it("attaches trace headers and records a local span upon request completion", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/test-route`, {
        headers: {
          "x-trace-id": "inbound-trace-abc",
          "x-request-id": "inbound-req-xyz",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("x-trace-id")).toBe("inbound-trace-abc");
      expect(res.headers.get("x-request-id")).toBe("inbound-req-xyz");

      const body = (await res.json()) as any;
      expect(body.traceId).toBe("inbound-trace-abc");
      expect(body.requestId).toBe("inbound-req-xyz");

      // Give event loop a tick for res 'finish' callback
      await new Promise((r) => setTimeout(r, 20));

      const spans = recorder.getSpans();
      expect(spans).toHaveLength(1);
      const span = spans[0];
      expect(span.trace_id).toBe("inbound-trace-abc");
      expect(span.request_id).toBe("inbound-req-xyz");
      expect(span.method).toBe("GET");
      expect(span.path).toBe("/api/test-route");
      expect(span.status_code).toBe(200);
      expect(span.duration_ms).toBeGreaterThanOrEqual(0);
      expect(typeof span.span_id).toBe("string");
      expect(typeof span.timestamp).toBe("string");
    });

    it("generates UUIDv4 headers when incoming headers are missing", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/test-route`);
      expect(res.status).toBe(200);

      const resTraceId = res.headers.get("x-trace-id");
      const resRequestId = res.headers.get("x-request-id");
      const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      expect(resTraceId).toMatch(uuidv4Regex);
      expect(resRequestId).toMatch(uuidv4Regex);
    });

    it("exposes GET /api/system/traces/spans with zero telemetry payload", async () => {
      // Execute 2 requests
      await fetch(`http://127.0.0.1:${port}/api/test-route`);
      await fetch(`http://127.0.0.1:${port}/api/test-route`);
      await new Promise((r) => setTimeout(r, 20));

      const spansRes = await fetch(`http://127.0.0.1:${port}/api/system/traces/spans?limit=10`);
      expect(spansRes.status).toBe(200);

      const data = (await spansRes.json()) as any;
      expect(data.zero_telemetry).toBe(true);
      expect(data.capacity).toBe(100);
      expect(Array.isArray(data.spans)).toBe(true);
      expect(data.spans.length).toBeGreaterThanOrEqual(2);
    });

    it("generates outbound tracing headers for downstream propagation", () => {
      const req = { traceId: "my-trace-id", requestId: "my-request-id" } as any;
      const headers = createTracingHeaders(req);
      expect(headers["x-trace-id"]).toBe("my-trace-id");
      expect(headers["x-request-id"]).toBe("my-request-id");

      const emptyHeaders = createTracingHeaders();
      const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(emptyHeaders["x-trace-id"]).toMatch(uuidv4Regex);
      expect(emptyHeaders["x-request-id"]).toMatch(uuidv4Regex);
    });
  });

  describe("Modal Gateway & Hub Webhook Proxy Routing Integration", () => {
    let mockDownstreamServer: http.Server;
    let mockDownstreamPort: number;
    let gatewayServer: http.Server;
    let gatewayPort: number;
    let lastDownstreamHeaders: Record<string, string | string[] | undefined> = {};
    let lastDownstreamBody: any = null;

    beforeEach(async () => {
      // 1. Mock downstream server (simulates router:7777 and hub:3000)
      const mockApp = express();
      mockApp.use(express.json());

      mockApp.get("/api/fleet/modal/resolve", (req, res) => {
        lastDownstreamHeaders = req.headers;
        res.json({
          workload: req.query.app_id || req.query.workload,
          workspace: req.query.preferred_workspace || req.query.workspace || "insimind",
          direct_url: "https://insimind--qwen-image.modal.run",
          gpu_tier: "A100-80GB",
        });
      });

      mockApp.post("/api/fleet/modal/telemetry/report", (req, res) => {
        lastDownstreamHeaders = req.headers;
        lastDownstreamBody = req.body;
        res.json({
          status: "recorded",
          run_id: req.body.run_id,
          cost_usd: 0.05,
        });
      });

      mockApp.get("/api/fleet/modal/resources.json", (req, res) => {
        lastDownstreamHeaders = req.headers;
        res.json({
          catalog_version: "2026.10.1",
          workloads: ["qwen_img_21", "wan_s2v_14b"],
        });
      });

      mockApp.post("/api/integrations/linear/events", (req, res) => {
        lastDownstreamHeaders = req.headers;
        lastDownstreamBody = req.body;
        res.json({ success: true, provider: "linear" });
      });

      mockApp.post("/api/integrations/slack/events", (req, res) => {
        lastDownstreamHeaders = req.headers;
        lastDownstreamBody = req.body;
        res.json({ success: true, provider: "slack" });
      });

      mockApp.post("/api/integrations/github/events", (req, res) => {
        lastDownstreamHeaders = req.headers;
        lastDownstreamBody = req.body;
        res.json({ success: true, provider: "github" });
      });

      await new Promise<void>((resolve) => {
        mockDownstreamServer = mockApp.listen(0, "127.0.0.1", () => {
          const addr = mockDownstreamServer.address();
          if (addr && typeof addr !== "string") {
            mockDownstreamPort = addr.port;
          }
          resolve();
        });
      });

      // 2. Gateway Express Server with proxy routes and tracing
      process.env.ROUTER_BASE_URL = `http://127.0.0.1:${mockDownstreamPort}`;
      process.env.PASEO_HUB_URL = `http://127.0.0.1:${mockDownstreamPort}`;

      const gwApp = express();
      gwApp.use(createDistributedTracingMiddleware());
      gwApp.use(express.json());

      // Wire Modal Proxy Routes
      gwApp.get("/api/fleet/modal/resolve", async (req, res) => {
        const routerBaseUrl = process.env.ROUTER_BASE_URL;
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(req.query)) {
          if (typeof value === "string") params.set(key, value);
        }
        if (req.query.workload && !params.has("app_id"))
          params.set("app_id", String(req.query.workload));
        if (req.query.workspace && !params.has("preferred_workspace"))
          params.set("preferred_workspace", String(req.query.workspace));

        const targetUrl = `${routerBaseUrl}/api/fleet/modal/resolve?${params.toString()}`;
        const headers: Record<string, string> = {
          Accept: "application/json",
          ...createTracingHeaders(req),
        };
        const forwardRes = await fetch(targetUrl, { method: "GET", headers });
        const data = await forwardRes.json();
        res.status(forwardRes.status).json(data);
      });

      gwApp.post("/api/fleet/modal/telemetry", async (req, res) => {
        const routerBaseUrl = process.env.ROUTER_BASE_URL;
        const targetUrl = `${routerBaseUrl}/api/fleet/modal/telemetry/report`;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...createTracingHeaders(req),
        };
        const forwardRes = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(req.body || {}),
        });
        const data = await forwardRes.json();
        res.status(forwardRes.status).json(data);
      });

      gwApp.get("/api/fleet/modal/resources.json", async (req, res) => {
        const routerBaseUrl = process.env.ROUTER_BASE_URL;
        const targetUrl = `${routerBaseUrl}/api/fleet/modal/resources.json`;
        const headers: Record<string, string> = {
          Accept: "application/json",
          ...createTracingHeaders(req),
        };
        const forwardRes = await fetch(targetUrl, { method: "GET", headers });
        const data = await forwardRes.json();
        res.status(forwardRes.status).json(data);
      });

      // Wire Hub Webhook Proxy Routes
      gwApp.post("/api/hub/webhooks/linear", async (req, res) => {
        const signature = req.header("linear-signature");
        if (!signature) {
          res.status(401).json({ error: "Missing required signature header: linear-signature" });
          return;
        }
        const hubBaseUrl = process.env.PASEO_HUB_URL;
        const targetUrl = `${hubBaseUrl}/api/integrations/linear/events`;
        const headers: Record<string, string> = {
          "Content-Type": req.header("content-type") || "application/json",
          "linear-signature": signature,
          ...createTracingHeaders(req),
        };
        const forwardRes = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(req.body || {}),
        });
        const data = await forwardRes.json();
        res.status(forwardRes.status).json(data);
      });

      gwApp.post("/api/hub/webhooks/slack", async (req, res) => {
        const signature = req.header("x-slack-signature");
        const timestamp = req.header("x-slack-request-timestamp");
        if (!signature || !timestamp) {
          res.status(401).json({ error: "Missing required Slack signature headers" });
          return;
        }
        const hubBaseUrl = process.env.PASEO_HUB_URL;
        const targetUrl = `${hubBaseUrl}/api/integrations/slack/events`;
        const headers: Record<string, string> = {
          "Content-Type": req.header("content-type") || "application/json",
          "x-slack-signature": signature,
          "x-slack-request-timestamp": timestamp,
          ...createTracingHeaders(req),
        };
        const forwardRes = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(req.body || {}),
        });
        const data = await forwardRes.json();
        res.status(forwardRes.status).json(data);
      });

      gwApp.post("/api/hub/webhooks/github", async (req, res) => {
        const signature = req.header("x-hub-signature-256");
        if (!signature) {
          res
            .status(401)
            .json({ error: "Missing required GitHub signature header: x-hub-signature-256" });
          return;
        }
        const hubBaseUrl = process.env.PASEO_HUB_URL;
        const targetUrl = `${hubBaseUrl}/api/integrations/github/events`;
        const headers: Record<string, string> = {
          "Content-Type": req.header("content-type") || "application/json",
          "x-hub-signature-256": signature,
          ...createTracingHeaders(req),
        };
        const forwardRes = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(req.body || {}),
        });
        const data = await forwardRes.json();
        res.status(forwardRes.status).json(data);
      });

      await new Promise<void>((resolve) => {
        gatewayServer = gwApp.listen(0, "127.0.0.1", () => {
          const addr = gatewayServer.address();
          if (addr && typeof addr !== "string") {
            gatewayPort = addr.port;
          }
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => mockDownstreamServer.close(() => resolve()));
      await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    });

    it("GET /api/fleet/modal/resolve forwards query parameters and propagates tracing headers", async () => {
      const res = await fetch(
        `http://127.0.0.1:${gatewayPort}/api/fleet/modal/resolve?workload=qwen_img_21&workspace=lovenovel`,
        {
          headers: {
            "x-trace-id": "trace-proxy-test-1",
            "x-request-id": "req-proxy-test-1",
          },
        },
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("x-trace-id")).toBe("trace-proxy-test-1");
      expect(res.headers.get("x-request-id")).toBe("req-proxy-test-1");

      const body = (await res.json()) as any;
      expect(body.workload).toBe("qwen_img_21");
      expect(body.workspace).toBe("lovenovel");

      // Verify headers reached downstream
      expect(lastDownstreamHeaders["x-trace-id"]).toBe("trace-proxy-test-1");
      expect(lastDownstreamHeaders["x-request-id"]).toBe("req-proxy-test-1");
    });

    it("POST /api/fleet/modal/telemetry forwards body and propagates tracing headers", async () => {
      const telemetryPayload = {
        run_id: "modal-run-8888",
        duration_s: 4.25,
        status: "success",
        workspace: "insimind",
      };

      const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/fleet/modal/telemetry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-trace-id": "trace-telem-999",
          "x-request-id": "req-telem-999",
        },
        body: JSON.stringify(telemetryPayload),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("x-trace-id")).toBe("trace-telem-999");
      expect(res.headers.get("x-request-id")).toBe("req-telem-999");

      const body = (await res.json()) as any;
      expect(body.status).toBe("recorded");
      expect(body.run_id).toBe("modal-run-8888");

      expect(lastDownstreamHeaders["x-trace-id"]).toBe("trace-telem-999");
      expect(lastDownstreamBody.run_id).toBe("modal-run-8888");
    });

    it("GET /api/fleet/modal/resources.json proxies catalog and preserves tracing headers", async () => {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/fleet/modal/resources.json`, {
        headers: {
          "x-trace-id": "trace-catalog-123",
          "x-request-id": "req-catalog-123",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("x-trace-id")).toBe("trace-catalog-123");
      expect(res.headers.get("x-request-id")).toBe("req-catalog-123");

      const body = (await res.json()) as any;
      expect(body.catalog_version).toBe("2026.10.1");
      expect(body.workloads).toContain("qwen_img_21");
    });

    it("POST /api/hub/webhooks/linear enforces fail-closed signature check and proxies with tracing", async () => {
      // 1. Missing signature -> 401
      const failRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/hub/webhooks/linear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue.created" }),
      });
      expect(failRes.status).toBe(401);

      // 2. With signature -> forwards to hub
      const successRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/hub/webhooks/linear`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "linear-signature": "sha256-mock-sig-123",
          "x-trace-id": "trace-linear-1",
        },
        body: JSON.stringify({ action: "issue.created", id: "LIN-101" }),
      });
      expect(successRes.status).toBe(200);
      expect(successRes.headers.get("x-trace-id")).toBe("trace-linear-1");

      const data = (await successRes.json()) as any;
      expect(data.success).toBe(true);
      expect(lastDownstreamHeaders["linear-signature"]).toBe("sha256-mock-sig-123");
      expect(lastDownstreamHeaders["x-trace-id"]).toBe("trace-linear-1");
    });

    it("POST /api/hub/webhooks/slack enforces fail-closed signature and timestamp check", async () => {
      // Missing timestamp or signature -> 401
      const failRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/hub/webhooks/slack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-slack-signature": "v0=dummy",
        },
        body: JSON.stringify({ event: "message" }),
      });
      expect(failRes.status).toBe(401);

      // Valid -> 200 forwarded
      const okRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/hub/webhooks/slack`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-slack-signature": "v0=abc123mock",
          "x-slack-request-timestamp": "1728290000",
        },
        body: JSON.stringify({ event: "message" }),
      });
      expect(okRes.status).toBe(200);
      expect(lastDownstreamHeaders["x-slack-signature"]).toBe("v0=abc123mock");
    });

    it("POST /api/hub/webhooks/github enforces fail-closed signature check", async () => {
      // Missing signature -> 401
      const failRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/hub/webhooks/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "push" }),
      });
      expect(failRes.status).toBe(401);

      // Valid -> 200 forwarded
      const okRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/hub/webhooks/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=abcdef123456",
        },
        body: JSON.stringify({ action: "push", ref: "refs/heads/main" }),
      });
      expect(okRes.status).toBe(200);
      expect(lastDownstreamHeaders["x-hub-signature-256"]).toBe("sha256=abcdef123456");
    });
  });

  describe("OpenAPI 3.1 Specification Integrity (internal-api.openapi.yaml)", () => {
    it("validates that internal-api.openapi.yaml exists and complies with OpenAPI 3.1.0 standard", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");

      const possiblePaths = [
        path.resolve(process.cwd(), "internal-api.openapi.yaml"),
        "/home/zen/zencode-ent/zencode/internal-api.openapi.yaml",
        "/home/zen/zencode/paseo/internal-api.openapi.yaml",
      ];

      let openApiContent = "";
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          openApiContent = fs.readFileSync(p, "utf-8");
          break;
        }
      }

      expect(openApiContent.length).toBeGreaterThan(1000);
      expect(openApiContent).toContain("openapi: 3.1.0");

      // Core system & distributed tracing routes
      expect(openApiContent).toContain("/api/health:");
      expect(openApiContent).toContain("/api/status:");
      expect(openApiContent).toContain("/api/system/traces/spans:");

      // Modal gateway proxy routes
      expect(openApiContent).toContain("/api/fleet/modal/resolve:");
      expect(openApiContent).toContain("/api/fleet/modal/telemetry:");
      expect(openApiContent).toContain("/api/fleet/modal/resources.json:");

      // Hub webhook proxy routes
      expect(openApiContent).toContain("/api/hub/webhooks/linear:");
      expect(openApiContent).toContain("/api/hub/webhooks/slack:");
      expect(openApiContent).toContain("/api/hub/webhooks/github:");

      // Auth & Security Schemes
      expect(openApiContent).toContain("BearerAuth:");
      expect(openApiContent).toContain("CookieAuth:");
      expect(openApiContent).toContain("zen_token");

      // Tracing headers & parameters
      expect(openApiContent).toContain("x-trace-id");
      expect(openApiContent).toContain("x-request-id");
      expect(openApiContent).toContain("traceparent");

      // Key schemas
      expect(openApiContent).toContain("TraceSpan:");
      expect(openApiContent).toContain("TraceSpansResponse:");
      expect(openApiContent).toContain("zero_telemetry:");
      expect(openApiContent).toContain("ModalResolveResponse:");
      expect(openApiContent).toContain("ModalTelemetryRequest:");
    });
  });
});
