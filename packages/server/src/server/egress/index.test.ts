import { describe, expect, it } from "vitest";
import pino from "pino";
import { EgressManager } from "./index.js";

const logger = pino({ level: "silent" });

describe("EgressManager", () => {
  it("should maintain sticky proxy binding for the same node", () => {
    const manager = new EgressManager({
      logger,
      proxies: [
        { id: "proxy-1", url: "http://proxy1.internal:8080" },
        { id: "proxy-2", url: "http://proxy2.internal:8080" },
      ],
    });

    const binding1 = manager.bindStickyProxy("node-alpha", "account-1");
    const binding2 = manager.bindStickyProxy("node-alpha", "account-1");

    expect(binding1).toBeDefined();
    expect(binding2).toBeDefined();
    expect(binding1?.id).toBe(binding2?.id);

    const env = manager.getNodeEnv("node-alpha");
    expect(env.HTTP_PROXY).toBe(binding1?.url);
    expect(env.HTTPS_PROXY).toBe(binding1?.url);
  });

  it("should rotate proxy on rate-limit reporting", () => {
    const manager = new EgressManager({
      logger,
      proxies: [
        { id: "proxy-1", url: "http://proxy1.internal:8080" },
        { id: "proxy-2", url: "http://proxy2.internal:8080" },
      ],
    });

    const initial = manager.bindStickyProxy("node-beta", "account-2");
    expect(initial).toBeDefined();

    // Report rate limit -> puts initial in cooldown
    manager.reportRateLimit("node-beta", 60_000);

    const next = manager.bindStickyProxy("node-beta", "account-2");
    expect(next).toBeDefined();
    expect(next?.id).not.toBe(initial?.id);
  });
});
