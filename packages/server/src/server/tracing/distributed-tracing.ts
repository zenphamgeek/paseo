import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Request, Response, NextFunction, RequestHandler } from "express";

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      requestId?: string;
      spanId?: string;
    }
  }
}

/**
 * Representation of a zero-telemetry local trace span.
 * Stored exclusively in local memory (circular buffer) without any external network egress.
 */
export interface TraceSpan {
  span_id: string;
  trace_id: string;
  request_id?: string;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  timestamp: string;
}

/**
 * In-memory FIFO circular buffer with fixed capacity (default 1,000 spans).
 * Completely local, zero-telemetry, thread-safe in Node single-event loop.
 */
export class CircularSpanBuffer {
  private readonly capacity: number;
  private readonly buffer: TraceSpan[];
  private head: number = 0;
  private size: number = 0;
  private totalRecorded: number = 0;

  constructor(capacity: number = 1000) {
    this.capacity = capacity;
    this.buffer = new Array<TraceSpan>(capacity);
  }

  /**
   * Append a span to the circular buffer. Overwrites the oldest item when full.
   */
  public record(span: TraceSpan): void {
    this.buffer[this.head] = span;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
    this.totalRecorded++;
  }

  /**
   * Retrieve recorded spans ordered from newest to oldest.
   */
  public getSpans(options?: { traceId?: string; limit?: number; path?: string }): TraceSpan[] {
    const result: TraceSpan[] = [];
    const limit = Math.min(options?.limit ?? this.capacity, this.capacity);
    const traceId = options?.traceId;
    const pathFilter = options?.path;

    for (let i = 0; i < this.size; i++) {
      const index = (this.head - 1 - i + this.capacity) % this.capacity;
      const span = this.buffer[index];
      if (!span) continue;

      if (traceId && span.trace_id !== traceId) {
        continue;
      }
      if (pathFilter && !span.path.includes(pathFilter)) {
        continue;
      }

      result.push(span);
      if (result.length >= limit) {
        break;
      }
    }

    return result;
  }

  /**
   * Get buffer capacity and occupancy stats.
   */
  public getStats(): { size: number; capacity: number; totalRecorded: number } {
    return {
      size: this.size,
      capacity: this.capacity,
      totalRecorded: this.totalRecorded,
    };
  }

  /**
   * Clear the buffer (primarily for test resets).
   */
  public clear(): void {
    this.head = 0;
    this.size = 0;
    this.totalRecorded = 0;
    this.buffer.fill(undefined as unknown as TraceSpan);
  }
}

/**
 * Singleton local trace span recorder.
 */
export class LocalSpanRecorder {
  private static instance: LocalSpanRecorder | null = null;
  private readonly buffer: CircularSpanBuffer;

  constructor(capacity: number = 1000) {
    this.buffer = new CircularSpanBuffer(capacity);
  }

  public static getInstance(capacity: number = 1000): LocalSpanRecorder {
    if (!LocalSpanRecorder.instance) {
      LocalSpanRecorder.instance = new LocalSpanRecorder(capacity);
    }
    return LocalSpanRecorder.instance;
  }

  public recordSpan(span: TraceSpan): void {
    this.buffer.record(span);
  }

  public getSpans(options?: { traceId?: string; limit?: number; path?: string }): TraceSpan[] {
    return this.buffer.getSpans(options);
  }

  public getStats(): { size: number; capacity: number; totalRecorded: number } {
    return this.buffer.getStats();
  }

  public clear(): void {
    this.buffer.clear();
  }
}

export function getLocalSpanRecorder(): LocalSpanRecorder {
  return LocalSpanRecorder.getInstance();
}

/**
 * Parse W3C traceparent header: 00-{traceId}-{parentId}-{traceFlags}
 */
export function parseW3CTraceParent(headerValue?: string | string[]): string | null {
  if (!headerValue) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw !== "string") return null;

  const parts = raw.trim().split("-");
  if (parts.length >= 4 && parts[1] && parts[1].length === 32) {
    return parts[1].toLowerCase();
  }
  return null;
}

/**
 * Extract incoming trace_id and request_id from various header formats:
 * - x-trace-id / trace_id / trace-id / traceparent
 * - x-request-id / request_id / request-id
 * Generates standard UUIDv4 if missing.
 */
export function extractTraceIdentifiers(headers: Record<string, string | string[] | undefined>): {
  traceId: string;
  requestId: string;
} {
  const getHeader = (...names: string[]): string | null => {
    for (const name of names) {
      const val = headers[name.toLowerCase()];
      if (val) {
        const str = Array.isArray(val) ? val[0] : val;
        if (typeof str === "string" && str.trim().length > 0) {
          return str.trim();
        }
      }
    }
    return null;
  };

  // 1. Trace ID extraction
  let traceId =
    getHeader("x-trace-id", "trace_id", "trace-id") ||
    parseW3CTraceParent(headers["traceparent"]) ||
    randomUUID();

  // 2. Request ID extraction
  let requestId = getHeader("x-request-id", "request_id", "request-id") || randomUUID();

  return { traceId, requestId };
}

export interface DistributedTracingOptions {
  recorder?: LocalSpanRecorder;
  headerPropagation?: boolean;
}

/**
 * Express middleware for Distributed Tracing:
 * 1. Extracts or generates trace_id and request_id.
 * 2. Attaches req.traceId, req.requestId, req.spanId.
 * 3. Sets response headers x-trace-id and x-request-id.
 * 4. Records zero-telemetry local trace spans in an in-memory circular buffer (1000 spans)
 *    upon response finish/close without any outbound network calls.
 */
export function createDistributedTracingMiddleware(
  options: DistributedTracingOptions = {},
): RequestHandler {
  const recorder = options.recorder ?? getLocalSpanRecorder();

  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = performance.now();
    const spanId = randomUUID();

    const { traceId, requestId } = extractTraceIdentifiers(
      req.headers as Record<string, string | string[] | undefined>,
    );

    req.traceId = traceId;
    req.requestId = requestId;
    req.spanId = spanId;

    res.setHeader("x-trace-id", traceId);
    res.setHeader("x-request-id", requestId);

    let recorded = false;
    const finalizeSpan = (): void => {
      if (recorded) return;
      recorded = true;

      const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
      const span: TraceSpan = {
        span_id: spanId,
        trace_id: traceId,
        request_id: requestId,
        method: req.method,
        path: req.originalUrl || req.url || req.path,
        status_code: res.statusCode || 200,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
      };

      recorder.recordSpan(span);
    };

    res.on("finish", finalizeSpan);
    res.on("close", finalizeSpan);

    next();
  };
}

export const distributedTracingMiddleware = createDistributedTracingMiddleware();

/**
 * Create headers for propagating distributed trace context to downstream services.
 */
export function createTracingHeaders(
  req?: Request | { traceId?: string; requestId?: string },
): Record<string, string> {
  const traceId = (req as Request)?.traceId || (req as any)?.traceId || randomUUID();
  const requestId = (req as Request)?.requestId || (req as any)?.requestId || randomUUID();

  return {
    "x-trace-id": traceId,
    "x-request-id": requestId,
  };
}

/**
 * Express route handler for GET /api/system/traces/spans.
 * Returns recent local zero-telemetry trace spans for introspection.
 */
export function createTraceSpansRouteHandler(
  recorder: LocalSpanRecorder = getLocalSpanRecorder(),
): RequestHandler {
  return (req: Request, res: Response): void => {
    const limitQuery = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 100;
    const limit = Number.isFinite(limitQuery) && limitQuery > 0 ? Math.min(limitQuery, 1000) : 100;
    const traceId = typeof req.query.trace_id === "string" ? req.query.trace_id : undefined;
    const pathFilter = typeof req.query.path === "string" ? req.query.path : undefined;

    const spans = recorder.getSpans({ traceId, limit, path: pathFilter });
    const stats = recorder.getStats();

    res.json({
      spans,
      total: stats.totalRecorded,
      size: stats.size,
      capacity: stats.capacity,
      zero_telemetry: true,
      timestamp: new Date().toISOString(),
    });
  };
}
