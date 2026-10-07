#!/usr/bin/env node
/**
 * Verification script for Zencode Feature Test Matrix and Release Notes.
 *
 * Validates that every feature in the release has an active, passing unit test suite,
 * and formats the test matrix markdown for Release Notes.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

export const FEATURE_TEST_MATRIX = [
  {
    featureGroup: "Browser Automation & RPA",
    featureName: "Stealth Anti-Bot & Fingerprint Cloak",
    package: "@getpaseo/desktop",
    testFile: "packages/desktop/src/features/browser-webviews/stealth-antibot.test.ts",
    testCommand:
      "npm --prefix packages/desktop run test src/features/browser-webviews/stealth-antibot.test.ts",
    description:
      "Cloaks navigator.webdriver, sanitizes User-Agent/Sec-Ch-Ua, mocks window.chrome, plugins, and CDP markers.",
  },
  {
    featureGroup: "Browser Automation & RPA",
    featureName: "Humanized Precision Input & Timing",
    package: "@getpaseo/desktop",
    testFile: "packages/desktop/src/features/browser-automation/trusted-input.test.ts",
    testCommand:
      "npm --prefix packages/desktop run test src/features/browser-automation/trusted-input.test.ts",
    description:
      "Natural click hold delay (35-70ms) and double-click interval (60-100ms) to avoid bot detection heuristics.",
  },
  {
    featureGroup: "Browser Automation & RPA",
    featureName: "Side Panel Browser Webview & Tab Placement",
    package: "@getpaseo/app",
    testFile: "packages/app/src/desktop/browser/automation/handler.test.ts",
    testCommand:
      "npm --prefix packages/app run test src/desktop/browser/automation/handler.test.ts",
    description:
      "Opens browser tabs in right-hand Side Panel (ensureSidePane) and handles browser_reveal_tab.",
  },
  {
    featureGroup: "Browser Automation & RPA",
    featureName: "Browser Server Tools Broker & Commands",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/browser-tools/tools.test.ts",
    testCommand: "npx --prefix packages/server vitest run src/server/browser-tools/tools.test.ts",
    description:
      "Validates browser_new_tab (sidePanel arg), browser_reveal_tab, and tab-scoped RPC routing.",
  },
  {
    featureGroup: "Fleet & Autonomous Swarm",
    featureName: "OpenCode Fleet Manager & Quota Balancing",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/fleet/opencode-fleet-manager.test.ts",
    testCommand:
      "npx --prefix packages/server vitest run src/server/fleet/opencode-fleet-manager.test.ts",
    description:
      "Multi-node fleet discovery, unified naming, stealth proxy egress, and load balancing across nodes.",
  },
  {
    featureGroup: "Fleet & Autonomous Swarm",
    featureName: "Modal Serverless GPU Swarm",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/fleet/modal-gpu-swarm.test.ts",
    testCommand: "npx --prefix packages/server vitest run src/server/fleet/modal-gpu-swarm.test.ts",
    description: "Modal GPU pool orchestration, dynamic worker provisioning, and health metrics.",
  },
  {
    featureGroup: "Fleet & Autonomous Swarm",
    featureName: "Fleet Analytics Time-Series DB",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/fleet/fleet-analytics-db.test.ts",
    testCommand:
      "npx --prefix packages/server vitest run src/server/fleet/fleet-analytics-db.test.ts",
    description:
      "SQLite time-series telemetry persistence, token throughput, and node utilization tracking.",
  },
  {
    featureGroup: "Self-Healing & Reliability",
    featureName: "Self-Healing Supervisor & Automerge / Revert",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/self-healing/self-healing.test.ts",
    testCommand:
      "npx --prefix packages/server vitest run src/server/self-healing/self-healing.test.ts",
    description:
      "Circuit breaker deadlock prevention, automated test verification, automerge on pass, auto-revert on fail.",
  },
  {
    featureGroup: "Telemetry & Human-in-the-Loop",
    featureName: "Telegram Alerter & Cooldown Monitoring",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/telemetry/telemetry.test.ts",
    testCommand: "npx --prefix packages/server vitest run src/server/telemetry/telemetry.test.ts",
    description: "Multi-subsystem telemetry snapshots, incident alerts, and cooldown suppression.",
  },
  {
    featureGroup: "Telemetry & Human-in-the-Loop",
    featureName: "Per-Conversation Telegram Alert Toggle",
    package: "@getpaseo/app",
    testFile: "packages/app/src/stores/conversation-telegram-store.test.ts",
    testCommand:
      "npm --prefix packages/app run test src/stores/conversation-telegram-store.test.ts",
    description:
      "Persistent per-conversation opt-in toggle (default OFF) for Telegram notifications.",
  },
  {
    featureGroup: "UI/UX & Vibe Coding",
    featureName: "Vibe Audio Notification System",
    package: "@getpaseo/app",
    testFile: "packages/app/src/utils/vibe-audio.test.ts",
    testCommand: "npm --prefix packages/app run test src/utils/vibe-audio.test.ts",
    description:
      "Audio notification synthesis for task completion, human attention required, and errors.",
  },
  {
    featureGroup: "UI/UX & Vibe Coding",
    featureName: "Zencode Branding & Node Service Badges",
    package: "@getpaseo/app",
    testFile: "packages/app/src/screens/fleet/service-app-icon.test.ts",
    testCommand: "npm --prefix packages/app run test src/screens/fleet/service-app-icon.test.ts",
    description:
      "Replaced Paseo icon with Zencode brand, dynamic provider indicators, and node status colors.",
  },
  {
    featureGroup: "UI/UX & Vibe Coding",
    featureName: "Modal GPU Swarm Real-Time UI",
    package: "@getpaseo/app",
    testFile: "packages/app/src/screens/fleet/modal-gpu-swarm-ui.test.ts",
    testCommand: "npm --prefix packages/app run test src/screens/fleet/modal-gpu-swarm-ui.test.ts",
    description: "Real-time card visualization of GPU nodes, vLLM status, and cluster health.",
  },
  {
    featureGroup: "Fleet & Autonomous Swarm",
    featureName: "Fleet Mode Conversation Label Dispatcher",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/fleet/fleet-conversation-dispatcher.test.ts",
    testCommand:
      "npx --prefix packages/server vitest run src/server/fleet/fleet-conversation-dispatcher.test.ts",
    description:
      "Intercepts /fleet commands and fleet mode sessions to log Orchestrator and Worker labels.",
  },
  {
    featureGroup: "UI/UX & Vibe Coding",
    featureName: "Fleet Mode Conversation Badge & Metadata Parsing",
    package: "@getpaseo/app",
    testFile: "packages/app/src/components/fleet-execution-label.test.ts",
    testCommand: "npx vitest run packages/app/src/components/fleet-execution-label.test.ts",
    description:
      "Parses Fleet Mode labels and renders high-tech Orchestrator ➔ Worker execution badges in conversation.",
  },
  {
    featureGroup: "Clef & Dual ONNX Substrate",
    featureName: "Clef Gatekeeper & Hit Telemetry Logger",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/onnx/clef-hit-logger.test.ts",
    testCommand: "npx --prefix packages/server vitest run src/server/onnx/clef-hit-logger.test.ts",
    description:
      "Evaluates pre-flight prompt complexity, gates zero-token admissions, logs hits without over-tools.",
  },
  {
    featureGroup: "Clef & Dual ONNX Substrate",
    featureName: "Cloudflare Free Multi-Account Pool Router & 9B Fallback",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/onnx/cloudflare-free-pool-router.test.ts",
    testCommand:
      "npx --prefix packages/server vitest run src/server/onnx/cloudflare-free-pool-router.test.ts",
    description:
      "Multi-account 10,000 neurons/day quota balancing, stealth jitter, and seamless fallback to Local 9B.",
  },
  {
    featureGroup: "UI/UX & Vibe Coding",
    featureName: "Fleet UI/UX Navigation & Visual Design Consolidation",
    package: "@getpaseo/app",
    testFile: "packages/app/src/screens/fleet/fleet-screen-navigation.test.ts",
    testCommand:
      "npm --prefix packages/app run test src/screens/fleet/fleet-screen-navigation.test.ts",
    description:
      "Quick back to workspace button, Esc key listener, breadcrumbs, stealth pill, and desktop PageLayout back.",
  },
  {
    featureGroup: "Fleet & Autonomous Swarm",
    featureName: "Periodic Quota Audit & Surplus-First Dynamic Dispatcher",
    package: "@getpaseo/server",
    testFile: "packages/server/src/server/fleet/periodic-quota-reviewer.test.ts",
    testCommand:
      "npx --prefix packages/server vitest run src/server/fleet/periodic-quota-reviewer.test.ts",
    description:
      "Periodically audits cluster quotas, eliminates starvation, and dynamically prioritizes high-surplus nodes (binhthuong, sunward, justaskgao).",
  },
];

export function runMatrixVerification(options = {}) {
  const isSilent = options.silent ?? false;
  const results = [];
  let totalPassed = 0;
  let totalFailed = 0;

  console.log("===============================================================================");
  console.log("⚡ ZENCODE FEATURE TEST MATRIX VERIFICATION RUNNER");
  console.log("===============================================================================\n");

  for (const item of FEATURE_TEST_MATRIX) {
    const startTime = Date.now();
    try {
      if (!isSilent) {
        process.stdout.write(`⏳ Testing [${item.featureGroup}] ${item.featureName}... `);
      }
      execSync(item.testCommand, {
        cwd: ROOT_DIR,
        stdio: "pipe",
        env: { ...process.env, NODE_ENV: "test" },
      });
      const durationMs = Date.now() - startTime;
      if (!isSilent) {
        console.log(`\x1b[32mPASSED\x1b[0m (${durationMs}ms)`);
      }
      results.push({ ...item, status: "PASSED", durationMs });
      totalPassed += 1;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      if (!isSilent) {
        console.log(`\x1b[31mFAILED\x1b[0m (${durationMs}ms)`);
        console.error(error.stderr?.toString() || error.message);
      }
      results.push({ ...item, status: "FAILED", durationMs, error: error.message });
      totalFailed += 1;
    }
  }

  console.log("\n-------------------------------------------------------------------------------");
  console.log(
    `Summary: ${totalPassed} Passed | ${totalFailed} Failed out of ${FEATURE_TEST_MATRIX.length} suites.`,
  );
  console.log("-------------------------------------------------------------------------------\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMatrixVerification();
}
