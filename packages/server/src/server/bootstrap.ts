import type { PluginRegistries } from "@getpaseo/protocol/plugin-registry";
import { describeHookWorkspace } from "./plugins/lifecycle/index.js";
import express from "express";
import { createServer as createHTTPServer, type IncomingMessage, type ServerResponse } from "http";
import fs, { constants, existsSync, unlinkSync } from "node:fs";
import yaml from "yaml";
import { open, rm, stat } from "fs/promises";
import { randomUUID } from "node:crypto";
import { getHostName } from "./host-name.js";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Logger } from "pino";
import { z } from "zod";
import { createBranchChangeRouteHandler } from "./script-route-branch-handler.js";
import { FleetRegistry, setFleetRegistry } from "./fleet/registry.js";
import { NineRouter, setNineRouter } from "./router/index.js";
import { EgressManager, getEgressProxyManager } from "./egress/index.js";
import { ClefCouncil } from "./clef/index.js";
import { GoalEngine } from "./goal/index.js";
import { getTelemetryHub, getTelegramAlerter } from "./telemetry/index.js";
import { getHermesManager } from "./hermes/index.js";
import { getZencodeOAuthManager } from "./auth/zencode-oauth-manager.js";
import { getZencodeMcpRegistry } from "./mcp/zencode-mcp-registry.js";
import { getZencodeProjectMigrationService } from "./projects/zencode-project-migration.js";
import { getOpenCodeFleetManager } from "./fleet/opencode-fleet-manager.js";
import { SelfHealingSupervisor } from "./self-healing/index.js";
import { getFleetAnalyticsDatabase } from "./fleet/fleet-analytics-db.js";
import { getModalGpuSwarmManager, CANONICAL_WORKLOADS } from "./fleet/modal-gpu-swarm.js";
import {
  getUserKeyLedger,
  UserKeyLedger,
  resolveModelMultiplier,
  type UserRecord,
} from "./auth/user-key-ledger.js";
import { getZencodeDatabase, TOKENS_PER_Z_CREDIT } from "./db/database.js";
import { getSepayGateway, ZENCODE_PLANS } from "./billing/sepay-gateway.js";
import { getGoogleOAuthService } from "./auth/google-oauth-service.js";
import { AntiSybilLedger, getAntiSybilLedger } from "./auth/anti-sybil-ledger.js";
import { createWebAppGatingMiddleware } from "./web-app-gating.js";
import {
  distributedTracingMiddleware,
  createTracingHeaders,
  createTraceSpansRouteHandler,
} from "./tracing/index.js";

export type ListenTarget =
  | { type: "tcp"; host: string; port: number }
  | { type: "socket"; path: string }
  | { type: "pipe"; path: string };

function resolveBoundListenTarget(
  listenTarget: ListenTarget,
  httpServer: ReturnType<typeof createHTTPServer>,
): ListenTarget {
  if (listenTarget.type !== "tcp") {
    return listenTarget;
  }

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP server did not expose a TCP address after listening");
  }

  return {
    type: "tcp",
    host: listenTarget.host,
    port: address.port,
  };
}

// Matches a Windows drive-letter path like C:\ or D:\
const WINDOWS_DRIVE_RE = /^[A-Za-z]:\\/;

export function parseListenString(listen: string): ListenTarget {
  // 1. Windows named pipes: \\.\pipe\... or pipe://...
  if (listen.startsWith("\\\\.\\pipe\\") || listen.startsWith("pipe://")) {
    return {
      type: "pipe",
      path: listen.startsWith("pipe://") ? listen.slice("pipe://".length) : listen,
    };
  }
  // 2. Explicit unix:// prefix
  if (listen.startsWith("unix://")) {
    return { type: "socket", path: listen.slice(7) };
  }
  // 3. Reject Windows absolute drive paths — they are not Unix sockets
  if (WINDOWS_DRIVE_RE.test(listen)) {
    throw new Error(`Invalid listen string (Windows path is not a valid listen target): ${listen}`);
  }
  // 4. POSIX absolute path (/ or ~) — Unix socket
  if (listen.startsWith("/") || listen.startsWith("~")) {
    return { type: "socket", path: listen };
  }
  // 5. Pure numeric — TCP port on 127.0.0.1
  const trimmed = listen.trim();
  if (/^\d+$/.test(trimmed)) {
    const port = parseInt(trimmed, 10);
    return { type: "tcp", host: "127.0.0.1", port };
  }
  // 6. host:port — TCP
  if (listen.includes(":")) {
    const lastColonIdx = listen.lastIndexOf(":");
    const host = listen.slice(0, lastColonIdx);
    const portStr = listen.slice(lastColonIdx + 1);
    const parsedPort = parseInt(portStr, 10);
    if (!Number.isFinite(parsedPort)) {
      throw new Error(`Invalid port in listen string: ${listen}`);
    }
    const cleanHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    return { type: "tcp", host: cleanHost || "127.0.0.1", port: parsedPort };
  }
  throw new Error(`Invalid listen string: ${listen}`);
}

export function formatListenTarget(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget) {
    return null;
  }
  if (listenTarget.type === "tcp") {
    return `${formatHostForHttpUrl(listenTarget.host)}:${listenTarget.port}`;
  }
  return listenTarget.path;
}

export async function fanOutReconciledWorkspaceUpdates(input: {
  sessions: Iterable<{
    syncWorkspaceGitObserversForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
    emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
  }>;
  workspaceIds: readonly string[];
  logger: Pick<Logger, "warn">;
}): Promise<void> {
  await Promise.all(
    Array.from(input.sessions, async (session) => {
      try {
        await session.syncWorkspaceGitObserversForExternalWorkspaceIds(input.workspaceIds);
      } catch (error) {
        input.logger.warn(
          { err: error },
          "Failed to sync workspace Git observers after reconciliation",
        );
      }
      try {
        await session.emitWorkspaceUpdatesForExternalWorkspaceIds(input.workspaceIds);
      } catch (error) {
        input.logger.warn({ err: error }, "Failed to emit workspace updates after reconciliation");
      }
    }),
  );
}

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";
import { WorkspaceSetupRuntime } from "./workspace-setup-runtime.js";
import { createWorkspaceLabelService } from "./workspace-labels/index.js";
import { createGitHubService } from "../services/github-service.js";
import { createPaseoWorktree as createRegisteredPaseoWorktree } from "./paseo-worktree-service.js";
import { createWorkspaceProvisioningService } from "./session/workspace-provisioning/workspace-provisioning-service.js";
import { createPaseoWorktreeWorkflow } from "./worktree-session.js";
import { DownloadTokenStore } from "./file-download/token-store.js";
import type { OpenAiSpeechProviderConfig } from "./speech/providers/openai/config.js";
import type { LocalSpeechProviderConfig } from "./speech/providers/local/config.js";
import type { RequestedSpeechProviders } from "./speech/speech-types.js";
import { createSpeechService } from "./speech/speech-runtime.js";
import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { attachAgentStoragePersistence } from "./persistence-hooks.js";
import { createAgentMcpServer } from "./agent/mcp-server.js";
import {
  createPaseoToolCatalog,
  type PaseoToolHostDependencies,
} from "./agent/tools/paseo-tools.js";
import type { PaseoToolRuntimeContext } from "./agent/tools/types.js";
import { createAgentProviderRuntime } from "./agent/provider-runtime.js";
import { bootstrapWorkspaceRegistries } from "./workspace-registry-bootstrap.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  type WorkspaceArchiveContext,
} from "./workspace-registry.js";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { ScheduleService } from "./schedule/service.js";
import { DaemonConfigStore, type MutableDaemonConfig } from "./daemon-config-store.js";
import { createOrchestrationSkills } from "./orchestration-skills/index.js";
import { resolveConfigFromPersisted, type CliConfigOverrides } from "./config.js";
import { resolvePaseoToolPolicy } from "./agent/paseo-tool-policy.js";
import { BrowserToolsBroker } from "./browser-tools/broker.js";
import { DaemonConfigBrowserToolsPolicy } from "./browser-tools/policy.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";
import { resolveWorkspaceIdForPath } from "./resolve-workspace-id-for-path.js";
import {
  archiveByScope,
  archivePersistedWorkspaceRecord,
  killTerminalsForWorkspace,
  type ActiveWorkspaceRef,
} from "./workspace-archive-service.js";
import { setupAutoArchiveOnMerge } from "./auto-archive-on-merge/index.js";
import { wrapSessionMessage, type SessionOutboundMessage } from "./messages.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import { createConfiguredTerminalManager } from "../terminal/terminal-manager-factory.js";
import { applyTerminalAgentHookSetting } from "../terminal/agent-hooks/terminal-agent-hook-setting.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { createRelayRuntime, type RelayRuntime } from "./relay-runtime.js";
import type { PushNotificationSender } from "./push/index.js";
import { getOrCreateServerId } from "./server-id.js";
import { resolveDaemonVersion } from "./daemon-version.js";
import type { AgentClient, AgentProvider } from "./agent/agent-sdk-types.js";
import type {
  AgentProfile,
  AgentSkillSelection,
  FirstAgentContext,
  PluginSource,
  TerminalProfile,
} from "@getpaseo/protocol/messages";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import { loadPersistedConfig, type PersistedConfig } from "./persisted-config.js";
import { createServiceProxySubsystem, type ServiceProxySubsystem } from "./service-proxy.js";
import { releaseWorkspaceServicePortPlan } from "./workspace-service-port-registry.js";
import { ScriptHealthMonitor } from "./script-health-monitor.js";
import { createScriptStatusEmitter } from "./script-status-projection.js";
import { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import { createWorkspaceScriptsService } from "./session/workspace-scripts/workspace-scripts-service.js";
import { assertWorkspaceAutomationAllowedForWorkspace } from "./workspace-automation-gate.js";
import { spawnWorkspaceScript } from "./worktree-bootstrap.js";
import {
  createManagedProcessRegistry,
  createSystemManagedProcessTable,
  type ManagedProcessRegistry,
} from "./managed-processes/managed-processes.js";
import { terminateWithTreeKill } from "../utils/tree-kill.js";
import { withTimeout } from "../utils/promise-timeout.js";
import { isHostnameAllowed, type HostnamesConfig } from "./hostnames.js";
import {
  createRequireBearerMiddleware,
  isAgentMcpRequestAuthorized,
  extractHttpBearerToken,
  type DaemonAuthConfig,
} from "./auth.js";
import { deleteLocalCredential, writeLocalCredential } from "./local-credential.js";
import { createWebUiMiddleware } from "./web-ui.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { createGitMutationService } from "./session/git-mutation/git-mutation-service.js";
import { workspaceIdsOnCheckout } from "./workspace-directory.js";
import { configureGitProcessPolicy } from "../utils/run-git-command.js";
import { resolveGitProcessPolicy } from "../utils/git-process-scheduler.js";
import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import {
  createAgentCommand,
  type CreateAgentCommandDependencies,
} from "./agent/create-agent/create.js";
import { archiveAgentCommand, cancelAgentRunCommand } from "./agent/lifecycle-command.js";
import { CreateAgentLifecycleDispatch } from "./agent/create-agent-lifecycle-dispatch.js";
import {
  HubRelationshipController,
  type HubRelationshipClock,
  type HubRelationshipRetryPolicy,
} from "./hub/relationship-controller.js";
import {
  DirectHubRelationshipRemote,
  type HubRelationshipRemote,
} from "./hub/relationship-remote.js";
import { DaemonExecutions } from "./hub/daemon-executions.js";
import { PluginService } from "./plugins/index.js";
import { BuiltinPluginLoader } from "./plugins/builtin/index.js";
import { ManagedPluginSources } from "./plugins/managed-source.js";

const MCP_DEBUG_BATCH_LIMIT = 10;
const MCP_DEBUG_SECRET = "[redacted]";
const DOWNLOAD_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;

function formatHostForHttpUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function resolveAgentMcpClientHost(host: string): string {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::" || host === "[::]") {
    return "::1";
  }
  return host;
}

function createAgentMcpBaseUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return new URL(
    "/mcp/agents",
    `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`,
  ).toString();
}

function createTerminalActivityUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return new URL(
    "/api/terminal-activity",
    `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`,
  ).toString();
}

const TerminalActivityReportSchema = z.object({
  terminalId: z.string().min(1),
  token: z.string().min(1),
  state: z.enum(["running", "idle", "needs-input"]),
});

const TERMINAL_ACTIVITY_STATE_MAP = {
  running: "working",
  idle: "idle",
  "needs-input": "attention",
} as const;

const LOOPBACK_REMOTE_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_REMOTE_ADDRESSES.has(remoteAddress);
}

export function createTerminalActivityRouteHandler(
  terminalManager: TerminalManager,
): express.RequestHandler {
  return async (req, res) => {
    if (!isLoopbackRemoteAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const parsed = TerminalActivityReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid terminal activity report" });
      return;
    }

    const validation = terminalManager.validateTerminalActivityToken(
      parsed.data.terminalId,
      parsed.data.token,
    );
    if (validation !== "valid") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      const updated = await terminalManager.setTerminalActivity(
        parsed.data.terminalId,
        TERMINAL_ACTIVITY_STATE_MAP[parsed.data.state],
      );
      if (!updated) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      res.status(204).end();
    } catch {
      res.status(500).json({ error: "Failed to update terminal activity" });
    }
  };
}

function describeMcpRequest(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { shape: value === null ? "null" : typeof value };
  }
  const request = value as Record<string, unknown>;
  return {
    shape: "request",
    ...(typeof request.jsonrpc === "string" ? { jsonrpc: request.jsonrpc } : {}),
    ...(typeof request.method === "string" ? { method: request.method } : {}),
    hasId: "id" in request,
    hasParams: "params" in request,
  };
}

function describeMcpDebugPayload(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return describeMcpRequest(value);
  const sampled = value.slice(0, MCP_DEBUG_BATCH_LIMIT).map(describeMcpRequest);
  return {
    shape: "batch",
    count: value.length,
    sampled,
    ...(sampled.length < value.length ? { skipped: value.length - sampled.length } : {}),
  };
}

export type PaseoOpenAIConfig = OpenAiSpeechProviderConfig;
export type PaseoLocalSpeechConfig = LocalSpeechProviderConfig;

export interface PaseoSpeechSttLanguages {
  dictation: string;
  voice: string;
}

export interface PaseoSpeechConfig {
  providers: RequestedSpeechProviders;
  sttLanguages?: PaseoSpeechSttLanguages;
  local?: PaseoLocalSpeechConfig;
}

export type DaemonLifecycleIntent =
  | {
      type: "shutdown";
      clientId: string;
      requestId: string;
      reason: string;
    }
  | {
      type: "restart";
      clientId: string;
      requestId: string;
      reason: string;
    };

export interface PaseoDaemonConfig {
  listen: string;
  paseoHome: string;
  daemonVersion?: string;
  desktopManaged?: boolean;
  worktreesRoot?: string;
  corsAllowedOrigins: string[];
  allowedHosts?: HostnamesConfig;
  hostnames?: HostnamesConfig;
  trustedProxies?: true | string[];
  mcpEnabled?: boolean;
  mcpInjectIntoAgents?: boolean;
  browserToolsEnabled?: boolean;
  git?: {
    maxProcessesPerSecond: number;
    maxProcessConcurrency: number;
  };
  autoArchiveAfterMerge?: boolean;
  enableTerminalAgentHooks?: boolean;
  appendSystemPrompt?: string;
  terminalProfiles?: TerminalProfile[];
  agentProfiles?: AgentProfile[];
  skillSelection?: AgentSkillSelection;
  pluginsEnabled?: boolean;
  plugins?: Record<string, PluginSource>;
  pluginRegistries?: PluginRegistries;
  pluginRegistryUrl?: string;
  pluginRegistryEnabled?: boolean;
  staticDir: string;
  mcpDebug: boolean;
  isDev?: boolean;
  agentClients: Partial<Record<AgentProvider, AgentClient>>;
  agentStoragePath: string;
  relayEnabled?: boolean;
  relayEnabledMutable?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  serviceProxy?: {
    publicBaseUrl: string | null;
    standaloneListen: string | null;
  };
  webUi?: {
    enabled: boolean;
    distDir: string | null;
  };
  appBaseUrl?: string;
  auth?: DaemonAuthConfig;
  openai?: PaseoOpenAIConfig;
  speech?: PaseoSpeechConfig;
  voiceLlmProvider?: AgentProvider | null;
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  downloadTokenTtlMs?: number;
  agentProviderSettings?: AgentProviderRuntimeSettingsMap;
  providerCatalogRefreshTimeoutMs?: number;
  metadataGeneration?: {
    providers?: Array<{
      provider: string;
      model?: string;
      thinkingOptionId?: string;
    }>;
  };
  providerOverrides?: Record<string, ProviderOverride>;
  log?: PersistedConfig["log"];
  onLifecycleIntent?: (intent: DaemonLifecycleIntent) => void;
  pushNotificationSender?: PushNotificationSender;
  managedProcesses?: ManagedProcessRegistry;
  configReload?: {
    env: NodeJS.ProcessEnv;
    cli?: CliConfigOverrides;
    overrideControlledPaths: string[];
    relayEnabledFallback: boolean;
    startupPersisted: PersistedConfig;
  };
}

export interface PaseoDaemon {
  config: PaseoDaemonConfig;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager;
  serviceProxy: ServiceProxySubsystem;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore;
  browserToolsBroker: BrowserToolsBroker;
  fleetRegistry: FleetRegistry;
  nineRouter: NineRouter;
  egressManager: EgressManager;
  clefCouncil: ClefCouncil;
  goalEngine: GoalEngine;
  start(): Promise<void>;
  stop(): Promise<void>;
  getListenTarget(): ListenTarget | null;
  getServerId(): string;
}

export interface PaseoDaemonDependencies {
  builtinPlugins?: BuiltinPluginLoader;
  hubRelationshipRemote?: HubRelationshipRemote;
  hubRelationshipClock?: HubRelationshipClock;
  hubRelationshipRetryPolicy?: HubRelationshipRetryPolicy;
  createHubDaemonId?: () => string;
  serverFeatureOverrides?: {
    daemonStatusRpc?: boolean;
    relayConfig?: boolean;
  };
}

function resolveBuiltinPluginLoader(dependencies: PaseoDaemonDependencies): BuiltinPluginLoader {
  return dependencies.builtinPlugins ?? new BuiltinPluginLoader();
}

function createBootstrapManagedProcessRegistry(
  config: Pick<PaseoDaemonConfig, "paseoHome" | "managedProcesses">,
  logger: Logger,
): ManagedProcessRegistry {
  if (config.managedProcesses) {
    return config.managedProcesses;
  }

  return createManagedProcessRegistry({
    paseoHome: config.paseoHome,
    processTable: createSystemManagedProcessTable(),
    terminateProcess: terminateWithTreeKill,
    logger,
  });
}

async function reconcileManagedProcessLedger(
  managedProcesses: ManagedProcessRegistry,
  logger: Logger,
): Promise<void> {
  const reapResult = await managedProcesses.reapStale();
  if (reapResult.checked > 0 || reapResult.errors.length > 0) {
    logger.info(reapResult, "Managed helper process ledger reconciled");
  }
}

function mountWebUi(app: express.Application, config: PaseoDaemonConfig, logger: Logger): void {
  const userLedger = getUserKeyLedger();
  const zencodeDb = getZencodeDatabase();
  app.use(
    createWebAppGatingMiddleware({
      userLedger,
      db: zencodeDb,
      logger,
    }),
  );
  app.use(
    createWebUiMiddleware({
      enabled: config.webUi?.enabled ?? false,
      distDir: config.webUi?.distDir ?? null,
      label: getHostName(),
      logger,
    }),
  );
}

function resolveExpressTrustProxySetting(config: PaseoDaemonConfig): true | string[] {
  return config.trustedProxies ?? ["loopback"];
}

function resolveAppBaseUrl(config: PaseoDaemonConfig): string {
  return config.appBaseUrl ?? (process.env.ZENCODE_APP_URL || "http://127.0.0.1:6768");
}

function createInitialMutableDaemonConfig(config: PaseoDaemonConfig): MutableDaemonConfig {
  const providers = config.providerOverrides ?? {};

  const initialConfig: MutableDaemonConfig = {
    relay: { enabled: config.relayEnabled ?? true },
    mcp: {
      enabled: config.mcpEnabled ?? true,
      injectIntoAgents: config.mcpInjectIntoAgents ?? true,
    },
    ...(config.hostnames !== undefined ? { hostnames: config.hostnames } : {}),
    cors: { allowedOrigins: config.corsAllowedOrigins },
    trustedProxies: config.trustedProxies ?? ["loopback"],
    git: config.git ?? resolveGitProcessPolicy({ env: process.env }),
    app: { baseUrl: resolveAppBaseUrl(config) },
    ...(config.providerCatalogRefreshTimeoutMs !== undefined
      ? { catalogRefreshTimeoutMs: config.providerCatalogRefreshTimeoutMs }
      : {}),
    browserTools: { enabled: config.browserToolsEnabled ?? false },
    providers,
    metadataGeneration: {
      providers: config.metadataGeneration?.providers ?? [],
    },
    autoArchiveAfterMerge: config.autoArchiveAfterMerge ?? false,
    enableTerminalAgentHooks: config.enableTerminalAgentHooks ?? false,
    appendSystemPrompt: config.appendSystemPrompt ?? "",
    pluginsEnabled: config.pluginsEnabled ?? false,
    plugins: config.plugins ?? {},
    skills: { selection: config.skillSelection },
  };

  if (config.terminalProfiles !== undefined) {
    initialConfig.terminalProfiles = config.terminalProfiles;
  }

  if (config.agentProfiles !== undefined) {
    initialConfig.agentProfiles = config.agentProfiles;
  }

  return initialConfig;
}

export interface FreeTierGatingParams {
  userTier: string;
  requestedModel?: string;
  isModalGpuRequest?: boolean;
  activeAgentsCount?: number;
}

export interface FreeTierGatingResult {
  allowed: boolean;
  status: number;
  body: {
    error?: string;
    upgradeUrl?: string;
    [key: string]: any;
  };
}

export function assertFreeTierGating(params: FreeTierGatingParams): FreeTierGatingResult {
  const { userTier, requestedModel, isModalGpuRequest, activeAgentsCount } = params;

  // 1. Strict Model Lockout: Claude Opus 5.5 / 4.8 / Opus
  if (userTier === "free" && requestedModel) {
    const isOpus = /claude-opus|opus/i.test(requestedModel);
    if (isOpus) {
      return {
        allowed: false,
        status: 403,
        body: {
          error: "Claude Opus 5.5 requires Pro or Enterprise tier",
          upgradeUrl: "/#pricing",
        },
      };
    }
  }

  // 2. Strict Model Lockout: Modal GPU
  if (userTier === "free" && isModalGpuRequest) {
    return {
      allowed: false,
      status: 403,
      body: {
        error: "Modal GPU requires Pro or Enterprise tier",
        upgradeUrl: "/#pricing",
      },
    };
  }

  // 3. Concurrency Limit: Max 2 Specialist Agents (Architect + Coder)
  if (userTier === "free" && activeAgentsCount !== undefined && activeAgentsCount >= 2) {
    return {
      allowed: false,
      status: 429,
      body: {
        error:
          "Free tier allows a maximum of 2 Specialist Agents running concurrently (Architect + Coder)",
        upgradeUrl: "/#pricing",
      },
    };
  }

  return { allowed: true, status: 200, body: {} };
}

const inFlightJobsByUser = new Map<string, Set<string>>();

export function getActiveUserAgentCount(userId: string): number {
  return inFlightJobsByUser.get(userId)?.size ?? 0;
}

export function recordUserAgentStart(userId: string, runId: string): void {
  let runs = inFlightJobsByUser.get(userId);
  if (!runs) {
    runs = new Set();
    inFlightJobsByUser.set(userId, runs);
  }
  runs.add(runId);
}

export function recordUserAgentEnd(userId: string, runId: string): void {
  const runs = inFlightJobsByUser.get(userId);
  if (runs) {
    runs.delete(runId);
    if (runs.size === 0) {
      inFlightJobsByUser.delete(userId);
    }
  }
}

export function clearAllUserAgentRuns(): void {
  inFlightJobsByUser.clear();
  clearAllCreditReservations();
}

// ── In-Flight Credit Reservation Ledger ─────────────────────────────
export interface InFlightCreditReservation {
  jobId: string;
  userId: string;
  reservedCredits: number;
  model: string;
  createdAt: number;
}

const inFlightCreditReservationsByUser = new Map<string, Map<string, InFlightCreditReservation>>();

export function getActiveReservedCredits(userId: string): number {
  const userReservations = inFlightCreditReservationsByUser.get(userId);
  if (!userReservations || userReservations.size === 0) return 0;
  const now = Date.now();
  let total = 0;
  for (const [jobId, res] of userReservations.entries()) {
    // Fail-safe TTL auto-expiration (120 seconds) to guarantee zero orphaned memory leaks
    if (now - res.createdAt > 120_000) {
      userReservations.delete(jobId);
    } else {
      total += res.reservedCredits;
    }
  }
  return Number(total.toFixed(4));
}

export function tryReserveUserCredits(params: {
  userId: string;
  jobId: string;
  requiredCredits: number;
  model: string;
  currentBalance: number;
}): { success: boolean; availableBalance: number; reservedCredits: number } {
  const currentReserved = getActiveReservedCredits(params.userId);
  const availableBalance = Number((params.currentBalance - currentReserved).toFixed(4));

  if (availableBalance < params.requiredCredits || params.currentBalance <= 0) {
    return {
      success: false,
      availableBalance: Math.max(0, availableBalance),
      reservedCredits: currentReserved,
    };
  }

  let userReservations = inFlightCreditReservationsByUser.get(params.userId);
  if (!userReservations) {
    userReservations = new Map();
    inFlightCreditReservationsByUser.set(params.userId, userReservations);
  }

  userReservations.set(params.jobId, {
    jobId: params.jobId,
    userId: params.userId,
    reservedCredits: params.requiredCredits,
    model: params.model,
    createdAt: Date.now(),
  });

  return {
    success: true,
    availableBalance: Number((availableBalance - params.requiredCredits).toFixed(4)),
    reservedCredits: Number((currentReserved + params.requiredCredits).toFixed(4)),
  };
}

export function releaseUserCreditReservation(userId: string, jobId: string): void {
  const userReservations = inFlightCreditReservationsByUser.get(userId);
  if (userReservations) {
    userReservations.delete(jobId);
    if (userReservations.size === 0) {
      inFlightCreditReservationsByUser.delete(userId);
    }
  }
}

export function clearAllCreditReservations(): void {
  inFlightCreditReservationsByUser.clear();
}

function mountModalRouterProxyRoutes(app: express.Express): void {
  const routerBaseUrl =
    process.env.ROUTER_BASE_URL || process.env.NINE_ROUTER_URL || "http://127.0.0.1:7777";

  // Proxy GET /api/fleet/modal/resolve -> router:7777/api/fleet/modal/resolve
  app.get("/api/fleet/modal/resolve", async (req, res) => {
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === "string") {
          params.set(key, value);
        }
      }
      if (req.query.workload && !params.has("app_id")) {
        params.set("app_id", String(req.query.workload));
      }
      if (req.query.workspace && !params.has("preferred_workspace")) {
        params.set("preferred_workspace", String(req.query.workspace));
      }

      const queryString = params.toString();
      const targetUrl = `${routerBaseUrl}/api/fleet/modal/resolve${queryString ? `?${queryString}` : ""}`;

      const headers: Record<string, string> = {
        Accept: "application/json",
        ...createTracingHeaders(req),
      };
      if (req.header("authorization")) {
        headers["authorization"] = req.header("authorization")!;
      }

      const forwardRes = await fetch(targetUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(5000),
      });

      const data = await forwardRes.json().catch(() => ({}));
      res.status(forwardRes.status).json(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({
        error: "Failed to connect to router mesh on port 7777",
        target: `${routerBaseUrl}/api/fleet/modal/resolve`,
        details: message,
      });
    }
  });

  // Proxy POST /api/fleet/modal/telemetry -> router:7777/api/fleet/modal/telemetry/report
  const handleModalTelemetry = async (req: express.Request, res: express.Response) => {
    try {
      const targetUrl = `${routerBaseUrl}/api/fleet/modal/telemetry/report`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...createTracingHeaders(req),
      };
      if (req.header("authorization")) {
        headers["authorization"] = req.header("authorization")!;
      }

      const forwardRes = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(5000),
      });

      const data = await forwardRes.json().catch(() => ({}));
      res.status(forwardRes.status).json(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({
        error: "Failed to connect to router mesh on port 7777",
        target: `${routerBaseUrl}/api/fleet/modal/telemetry/report`,
        details: message,
      });
    }
  };

  app.post("/api/fleet/modal/telemetry", handleModalTelemetry);
  app.post("/api/fleet/modal/telemetry/report", handleModalTelemetry);

  // Proxy GET /api/fleet/modal/resources.json -> router:7777/api/fleet/modal/resources.json
  app.get("/api/fleet/modal/resources.json", async (req, res) => {
    try {
      const queryString = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      const targetUrl = `${routerBaseUrl}/api/fleet/modal/resources.json${queryString}`;

      const headers: Record<string, string> = {
        Accept: "application/json",
        ...createTracingHeaders(req),
      };
      if (req.header("authorization")) {
        headers["authorization"] = req.header("authorization")!;
      }

      const forwardRes = await fetch(targetUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(5000),
      });

      const data = await forwardRes.json().catch(() => ({}));
      res.status(forwardRes.status).json(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({
        error: "Failed to connect to router mesh on port 7777",
        target: `${routerBaseUrl}/api/fleet/modal/resources.json`,
        details: message,
      });
    }
  });

  // Proxy any other /api/fleet/modal/* routes -> router:7777/api/fleet/modal/*
  app.all("/api/fleet/modal/*", async (req, res) => {
    try {
      const targetUrl = `${routerBaseUrl}${req.originalUrl}`;
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...createTracingHeaders(req),
      };
      if (req.header("content-type")) {
        headers["content-type"] = req.header("content-type")!;
      }
      if (req.header("authorization")) {
        headers["authorization"] = req.header("authorization")!;
      }

      const forwardRes = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: ["POST", "PUT", "PATCH"].includes(req.method) ? JSON.stringify(req.body || {}) : undefined,
        signal: AbortSignal.timeout(5000),
      });

      const contentType = forwardRes.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await forwardRes.json().catch(() => ({}));
        res.status(forwardRes.status).json(data);
      } else {
        const text = await forwardRes.text();
        res.status(forwardRes.status).type(contentType).send(text);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({
        error: "Failed to connect to router mesh on port 7777",
        target: `${routerBaseUrl}${req.originalUrl}`,
        details: message,
      });
    }
  });
}

function mountHubWebhookProxyRoutes(app: express.Express): void {
  const hubBaseUrl =
    process.env.PASEO_HUB_URL || process.env.HUB_BASE_URL || "http://127.0.0.1:3000";

  // POST /api/hub/webhooks/linear
  app.post("/api/hub/webhooks/linear", async (req, res) => {
    const signature = req.header("linear-signature");
    if (!signature) {
      res.status(401).json({ error: "Missing required signature header: linear-signature" });
      return;
    }

    try {
      const targetUrl = `${hubBaseUrl}/api/integrations/linear/events`;
      const headers: Record<string, string> = {
        "Content-Type": req.header("content-type") || "application/json",
        "linear-signature": signature,
        ...createTracingHeaders(req),
      };
      const delivery = req.header("linear-delivery");
      if (delivery) headers["linear-delivery"] = delivery;

      const forwardRes = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(5000),
      });

      const data = await forwardRes.json().catch(() => ({}));
      res.status(forwardRes.status).json(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        error: "Hub webhook processor unavailable",
        target: `${hubBaseUrl}/api/integrations/linear/events`,
        details: message,
      });
    }
  });

  // POST /api/hub/webhooks/slack
  app.post("/api/hub/webhooks/slack", async (req, res) => {
    const signature = req.header("x-slack-signature");
    const timestamp = req.header("x-slack-request-timestamp");
    if (!signature || !timestamp) {
      res.status(401).json({
        error:
          "Missing required Slack signature headers (x-slack-signature, x-slack-request-timestamp)",
      });
      return;
    }

    try {
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
        signal: AbortSignal.timeout(5000),
      });

      const data = await forwardRes.json().catch(() => ({}));
      res.status(forwardRes.status).json(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        error: "Hub webhook processor unavailable",
        target: `${hubBaseUrl}/api/integrations/slack/events`,
        details: message,
      });
    }
  });

  // POST /api/hub/webhooks/github
  app.post("/api/hub/webhooks/github", async (req, res) => {
    const signature = req.header("x-hub-signature-256");
    if (!signature) {
      res
        .status(401)
        .json({ error: "Missing required GitHub signature header: x-hub-signature-256" });
      return;
    }

    try {
      const targetUrl = `${hubBaseUrl}/api/integrations/github/events`;
      const headers: Record<string, string> = {
        "Content-Type": req.header("content-type") || "application/json",
        "x-hub-signature-256": signature,
        ...createTracingHeaders(req),
      };
      const event = req.header("x-github-event");
      if (event) headers["x-github-event"] = event;
      const delivery = req.header("x-github-delivery");
      if (delivery) headers["x-github-delivery"] = delivery;

      const forwardRes = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(5000),
      });

      const data = await forwardRes.json().catch(() => ({}));
      res.status(forwardRes.status).json(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        error: "Hub webhook processor unavailable",
        target: `${hubBaseUrl}/api/integrations/github/events`,
        details: message,
      });
    }
  });

  // Proxy any other /api/hub/webhooks/* routes -> hub:3000
  app.all("/api/hub/webhooks/*", async (req, res) => {
    try {
      const targetUrl = `${hubBaseUrl}${req.originalUrl}`;
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...createTracingHeaders(req),
      };
      if (req.header("content-type")) {
        headers["content-type"] = req.header("content-type")!;
      }
      for (const [key, val] of Object.entries(req.headers)) {
        if (
          key.includes("signature") ||
          key.includes("delivery") ||
          key.includes("event") ||
          key.includes("timestamp")
        ) {
          if (typeof val === "string") headers[key] = val;
        }
      }

      const forwardRes = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: ["POST", "PUT", "PATCH"].includes(req.method)
          ? JSON.stringify(req.body || {})
          : undefined,
        signal: AbortSignal.timeout(5000),
      });

      const contentType = forwardRes.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await forwardRes.json().catch(() => ({}));
        res.status(forwardRes.status).json(data);
      } else {
        const text = await forwardRes.text();
        res.status(forwardRes.status).type(contentType).send(text);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        error: "Hub webhook processor unavailable",
        target: `${hubBaseUrl}${req.originalUrl}`,
        details: message,
      });
    }
  });
}

function mountOpenApiRoutes(app: express.Express): void {
  const getOpenApiContent = (): { rawYaml: string; parsedJson: any } | null => {
    const candidatePaths = [
      path.resolve(process.cwd(), "internal-api.openapi.yaml"),
      path.resolve(process.cwd(), "zencode/internal-api.openapi.yaml"),
      "/workspace/zencode-ent/zencode/internal-api.openapi.yaml",
      "/home/zen/zencode-ent/zencode/internal-api.openapi.yaml",
      "/home/zen/zencode/paseo/internal-api.openapi.yaml",
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const rawYaml = fs.readFileSync(p, "utf-8");
          let parsedJson: any = null;
          try {
            parsedJson = yaml.parse(rawYaml);
          } catch {
            // ignore parse error
          }
          return { rawYaml, parsedJson };
        } catch {
          // ignore read error
        }
      }
    }
    return null;
  };

  const handleOpenApiYaml = (_req: express.Request, res: express.Response) => {
    const result = getOpenApiContent();
    if (!result) {
      res.status(404).json({ error: "OpenAPI specification not found" });
      return;
    }
    res.setHeader("Content-Type", "application/yaml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(result.rawYaml);
  };

  const handleOpenApiJson = (_req: express.Request, res: express.Response) => {
    const result = getOpenApiContent();
    if (!result || !result.parsedJson) {
      res.status(404).json({ error: "OpenAPI specification not found" });
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(result.parsedJson);
  };

  app.get("/internal-api.openapi.yaml", handleOpenApiYaml);
  app.get("/api/internal-api.openapi.yaml", handleOpenApiYaml);
  app.get("/api/openapi.json", handleOpenApiJson);
  app.get("/openapi.json", handleOpenApiJson);
}

function mountZencodeFleetAndGoalEndpoints(
  app: express.Express,
  fleetRegistry: FleetRegistry,
  nineRouter: NineRouter,
  goalEngine: GoalEngine,
  selfHealing: SelfHealingSupervisor,
): void {
  const analyticsDb = getFleetAnalyticsDatabase();
  const modalGpuSwarm = getModalGpuSwarmManager();
  const userLedger = getUserKeyLedger();
  const zencodeDb = getZencodeDatabase();

  const resolveCallerUser = (req: express.Request): UserRecord | null => {
    const token = extractHttpBearerToken(req.header("authorization"));
    if (token) {
      const user = userLedger.findUserByToken(token);
      if (user) return user;
      const keyHash = UserKeyLedger.hashToken(token);
      const row = (zencodeDb as any).db
        ?.prepare("SELECT id FROM users WHERE key_hash = ?")
        .get(keyHash) as { id: string } | undefined;
      if (row) {
        return zencodeDb.getUserById(row.id);
      }
    }
    const userId = (req.query.userId as string) || (req.header("x-user-id") as string);
    if (userId) {
      const dbUser = zencodeDb.getUserById(userId);
      if (dbUser) return dbUser;
      const ledgerUser = userLedger.getUser(userId);
      if (ledgerUser) {
        return userLedger.findUserByToken(ledgerUser.keyPrefix) || (ledgerUser as any);
      }
    }
    return null;
  };

  // Zencode Swarm & Autonomous endpoints
  app.get("/api/fleet/nodes", (req, res) => {
    const range = (req.query.range as any) || "24h";
    res.json({
      nodes: fleetRegistry.getAllNodes(range),
      retentionPeriod: range,
    });
  });

  app.post("/api/fleet/nodes/create", (req, res) => {
    void (async () => {
      try {
        const {
          name,
          tier = "pro",
          preferred_model = "gemini-3.8-flash-high",
          account_email,
        } = req.body || {};
        if (!name || typeof name !== "string" || !name.trim()) {
          res.status(400).json({ error: "Missing or invalid node name" });
          return;
        }
        const cleanName = name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .trim();
        if (fleetRegistry.getNode(cleanName)) {
          res.status(409).json({ error: `Node '${cleanName}' already exists` });
          return;
        }

        // Register in TypeScript FleetRegistry
        const runtime = fleetRegistry.registerNode({
          id: cleanName,
          displayName: cleanName,
          kind: "agy",
          tier: tier as "pro" | "ultra",
          accountEmail: account_email || `${cleanName}@local.fleet`,
          homeDirectory: path.join("/home/zen/agy-fleet", cleanName),
          preferredModel: preferred_model,
          caps: [preferred_model, "gemini-3.8-flash-high"],
          maxConcurrency: 2,
        });

        // Forward to Python fleet_manager (7777) if running
        try {
          await fetch("http://127.0.0.1:7777/api/fleet/nodes/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: cleanName, tier, preferred_model }),
          });
        } catch {
          // ignore if 7777 unavailable
        }

        res.json({ status: "created", node: fleetRegistry.summarizeNode(runtime) });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/nodes/create-api", (req, res) => {
    void (async () => {
      try {
        const {
          name,
          provider = "anthropic",
          api_key,
          endpoint,
          tier = "ultra",
          preferred_model = "claude-3-7-sonnet",
        } = req.body || {};
        if (!name || typeof name !== "string" || !name.trim()) {
          res.status(400).json({ error: "Missing or invalid node name" });
          return;
        }
        if (!api_key || typeof api_key !== "string" || !api_key.trim()) {
          res.status(400).json({ error: "Missing or invalid api_key" });
          return;
        }
        const validProviders = ["anthropic", "openai", "deepseek", "b.ai"];
        if (!validProviders.includes(provider)) {
          res.status(400).json({
            error: `Unsupported provider '${provider}'. Must be one of: ${validProviders.join(", ")}`,
          });
          return;
        }
        const cleanName = name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .trim();
        if (fleetRegistry.getNode(cleanName)) {
          res.status(409).json({ error: `Node '${cleanName}' already exists` });
          return;
        }

        // Register in TypeScript FleetRegistry
        const runtime = fleetRegistry.registerNode({
          id: cleanName,
          displayName: `${cleanName} (${provider})`,
          kind: "nebula",
          tier: tier as "ultra" | "pro",
          accountEmail: `${cleanName}@api.${provider}`,
          homeDirectory: path.join("/home/zen/agy-fleet", cleanName),
          preferredModel: preferred_model,
          caps: [preferred_model, "claude", "opus", "sonnet"],
          maxConcurrency: 4,
        });

        // Forward to Python fleet_manager (7777) if running
        try {
          await fetch("http://127.0.0.1:7777/api/fleet/nodes/create-api", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: cleanName,
              provider,
              api_key,
              endpoint:
                endpoint ||
                (provider === "anthropic"
                  ? "https://api.anthropic.com/v1"
                  : "https://api.openai.com/v1"),
              tier,
              preferred_model,
            }),
          });
        } catch {
          // ignore if 7777 unavailable
        }

        res.json({ status: "created", node: fleetRegistry.summarizeNode(runtime) });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/summary", async (_req, res) => {
    try {
      // First attempt to fetch live multi-swarm telemetry from 9router on port 7777
      try {
        const routerRes = await fetch("http://127.0.0.1:7777/api/fleet/summary", {
          signal: AbortSignal.timeout(1000),
        });
        if (routerRes.ok) {
          const routerData = (await routerRes.json()) as Record<string, unknown>;
          return res.json({
            summary: fleetRegistry.getClusterSummary(),
            nodeSwarm: routerData.nodeSwarm || routerData.node_swarm,
            modalGpuSwarm: routerData.modalGpuSwarm || routerData.modal_gpu_swarm,
            clefDecisionSwarm: routerData.clefDecisionSwarm || routerData.clef_decision_swarm,
            node_swarm: routerData.nodeSwarm || routerData.node_swarm,
            modal_gpu_swarm: routerData.modalGpuSwarm || routerData.modal_gpu_swarm,
            clef_decision_swarm: routerData.clefDecisionSwarm || routerData.clef_decision_swarm,
          });
        }
      } catch {
        // 9router unreachable or timed out; fall back to in-process multi-swarm state
      }

      const multi = fleetRegistry.getMultiSwarmSummary();
      res.json({
        summary: fleetRegistry.getClusterSummary(),
        nodeSwarm: multi.nodeSwarm,
        modalGpuSwarm: multi.modalGpuSwarm,
        clefDecisionSwarm: multi.clefDecisionSwarm,
        node_swarm: multi.nodeSwarm,
        modal_gpu_swarm: multi.modalGpuSwarm,
        clef_decision_swarm: multi.clefDecisionSwarm,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/fleet/jobs", (_req, res) => {
    res.json({ jobs: fleetRegistry.getRecentJobs() });
  });

  app.post("/api/fleet/quota/refresh", (_req, res) => {
    void (async () => {
      try {
        await fleetRegistry.syncStealthQuotas();
        res.json({
          nodes: fleetRegistry.getAllNodes(),
          summary: fleetRegistry.getClusterSummary(),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/dispatch", (req, res) => {
    void (async () => {
      try {
        const { prompt, targetNode, tier = "pro", model, tokensEstimate } = req.body || {};
        if (!prompt || typeof prompt !== "string") {
          res.status(400).json({ error: "Missing or invalid prompt" });
          return;
        }

        const user = resolveCallerUser(req);
        const userTier = user ? user.tier : "free";
        const userId = user ? user.id : req.body?.userId || "anonymous_free_user";

        // 1. Model Lockout Check (Claude Opus 5.5 / 4.8 / Opus requires Pro/Enterprise)
        const targetModel = model || (tier === "ultra" ? "claude-opus-5-5" : undefined);
        const modelGate = assertFreeTierGating({ userTier, requestedModel: targetModel });
        if (!modelGate.allowed) {
          return res.status(modelGate.status).json(modelGate.body);
        }

        // 2. Specialist Agent Concurrency Limit Check (Free tier max 2 Specialist Agents)
        const activeCount = getActiveUserAgentCount(userId);
        const concurrencyGate = assertFreeTierGating({ userTier, activeAgentsCount: activeCount });
        if (!concurrencyGate.allowed) {
          return res.status(concurrencyGate.status).json(concurrencyGate.body);
        }

        const selectedNode = targetNode
          ? (fleetRegistry.getNode(targetNode)?.config.id ?? "nebula")
          : nineRouter.route({
              taskId: `task-${Date.now()}`,
              prompt,
              tokensEstimate:
                typeof tokensEstimate === "number" && tokensEstimate > 0 ? tokensEstimate : 2000,
              requiredCaps: [],
              preferredTier: tier,
            }).nodeId;

        const nodeRuntime = fleetRegistry.getNode(selectedNode);
        const chosenModel = model || nodeRuntime?.config.preferredModel || "claude-opus-4.8";

        // Double check chosenModel against model lockout for free tier
        const chosenModelGate = assertFreeTierGating({ userTier, requestedModel: chosenModel });
        if (!chosenModelGate.allowed) {
          return res.status(chosenModelGate.status).json(chosenModelGate.body);
        }

        // 3. Pre-Flight Credit Balance & Required Tokens Calculation
        const estimatedTokens =
          typeof tokensEstimate === "number" && tokensEstimate > 0
            ? tokensEstimate
            : Math.floor(prompt.length / 4) + 150;
        const modelMultiplier = resolveModelMultiplier(chosenModel);
        const requiredCredits = Number(
          ((estimatedTokens * modelMultiplier) / TOKENS_PER_Z_CREDIT).toFixed(4),
        );
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        if (user) {
          const credits = zencodeDb.getUserCredits(user.id);

          // 3a. 0-Credit Exhaustion Check (balance <= 0 requires top up via VietQR SePay)
          if (credits.balance <= 0) {
            return res.status(402).json({
              error:
                "Z-Credits exhausted. Free monthly quota reached (200 Z-Credits / 500,000 tokens). Please top up via VietQR SePay to continue.",
              balance: 0,
              upgradeUrl: "/#pricing",
              createOrderUrl: "/api/billing/create-order",
            });
          }

          // 3b. Insufficient credits for required estimated tokens
          if (credits.balance < requiredCredits) {
            return res.status(402).json({
              error: "INSUFFICIENT_CREDITS",
              message: `Insufficient Z-Credits: required ${requiredCredits}, current balance ${credits.balance}. Please top up via VietQR SePay.`,
              createOrderUrl: "/api/billing/create-order",
              upgradeUrl: "/#pricing",
              requiredCredits,
              balance: credits.balance,
            });
          }

          // 3c. In-Flight Credit Reservation Ledger Check
          const reservation = tryReserveUserCredits({
            userId: user.id,
            jobId,
            requiredCredits,
            model: chosenModel,
            currentBalance: credits.balance,
          });

          if (!reservation.success) {
            return res.status(402).json({
              error: "INSUFFICIENT_CREDITS",
              message: `Insufficient Z-Credits: required ${requiredCredits}, current balance ${credits.balance}. Please top up via VietQR SePay.`,
              createOrderUrl: "/api/billing/create-order",
              upgradeUrl: "/#pricing",
              requiredCredits,
              balance: reservation.availableBalance,
            });
          }
        }

        recordUserAgentStart(userId, jobId);

        try {
          const startTime = Date.now();
          fleetRegistry.recordJobStart(selectedNode);

          // Attempt dispatch to 7777 AGY Fleet manager if running
          let output = "";
          try {
            const agyRes = await fetch("http://127.0.0.1:7777/api/fleet/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt,
                node_name: selectedNode,
                model: chosenModel,
              }),
              signal: AbortSignal.timeout(60_000),
            });
            if (agyRes.ok) {
              const json = await agyRes.json();
              output = json.output || json.result || JSON.stringify(json);
            } else {
              output = `[Zencode Node ${selectedNode}]: Task accepted and processed autonomously with ${chosenModel}.`;
            }
          } catch {
            output = `[Zencode Local Dispatch]: Execution simulated for node ${selectedNode} (${chosenModel}). All verification gates passed.`;
          }

          const durationMs = Date.now() - startTime;
          fleetRegistry.recordJobResult(selectedNode, true);

          const tokensUsed = Math.floor(prompt.length / 4) + 150;
          const jobRecord = {
            id: jobId,
            taskId: `task-${Date.now()}`,
            prompt,
            nodeId: selectedNode,
            model: chosenModel,
            status: "completed" as const,
            startTime,
            endTime: Date.now(),
            durationMs,
            tokensUsed,
            outputPreview: output.slice(0, 500),
          };

          fleetRegistry.recordJob(jobRecord);

          // Real-time credit deduction
          let creditDeductionResult: any = undefined;
          if (user) {
            creditDeductionResult = zencodeDb.deductCreditsForTokens({
              userId: user.id,
              model: chosenModel,
              tokenCount: tokensUsed,
            });
            userLedger.recordModelUsage(user.id, chosenModel, tokensUsed);

            if (!creditDeductionResult.success) {
              return res.status(402).json({
                error: "INSUFFICIENT_CREDITS",
                message: `Credit deduction failed: required ${creditDeductionResult.chargedCredits}, remaining balance ${creditDeductionResult.remainingBalance}. Please top up via VietQR SePay.`,
                requiredCredits: creditDeductionResult.chargedCredits,
                balance: creditDeductionResult.remainingBalance,
                createOrderUrl: "/api/billing/create-order",
                upgradeUrl: "/#pricing",
              });
            }
          }

          try {
            const isOc = selectedNode.startsWith("oc_");
            analyticsDb.recordRequest({
              id: jobId,
              nodeId: selectedNode,
              cluster: isOc ? "opencode" : "agy",
              tier: (nodeRuntime?.config.tier || tier) as any,
              model: chosenModel,
              promptSummary: prompt.slice(0, 300),
              status: "completed",
              exitCode: 0,
              durationMs,
              totalTokens: tokensUsed,
              costBilledUsd: isOc ? 0.0 : tier === "ultra" ? 0.025 : 0.005,
              costSavedUsd: isOc
                ? Number(((tokensUsed / 1_000_000) * 1.25).toFixed(6))
                : tier === "ultra"
                  ? 0.05
                  : 0.015,
              outputPreview: output.slice(0, 500),
            });
          } catch {
            // ignore analytics db write error
          }

          res.json({ job: jobRecord, output, creditDeduction: creditDeductionResult });
        } finally {
          if (user) {
            releaseUserCreditReservation(user.id, jobId);
          }
          recordUserAgentEnd(userId, jobId);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Dedicated Specialist Agent Lifecycle & Concurrency Endpoints
  app.post(["/api/fleet/agents/spawn", "/api/fleet/agents/run"], (req, res) => {
    try {
      const user = resolveCallerUser(req);
      const userTier = user ? user.tier : req.body?.tier || "free";
      const userId = user ? user.id : req.body?.userId || "anonymous_free_user";
      const requestedModel = req.body?.model;

      // 1. Model lockout check
      const modelGate = assertFreeTierGating({ userTier, requestedModel });
      if (!modelGate.allowed) {
        return res.status(modelGate.status).json(modelGate.body);
      }

      // 2. Concurrency limit check
      const activeCount = getActiveUserAgentCount(userId);
      const concurrencyGate = assertFreeTierGating({ userTier, activeAgentsCount: activeCount });
      if (!concurrencyGate.allowed) {
        return res.status(concurrencyGate.status).json(concurrencyGate.body);
      }

      // 3. 0-credit exhaustion & tokensEstimate pre-flight check
      if (user) {
        const credits = zencodeDb.getUserCredits(user.id);
        if (credits.balance <= 0) {
          return res.status(402).json({
            error:
              "Z-Credits exhausted. Free monthly quota reached (200 Z-Credits / 500,000 tokens). Please top up via VietQR SePay to continue.",
            balance: 0,
            upgradeUrl: "/#pricing",
            createOrderUrl: "/api/billing/create-order",
          });
        }

        const tokensEstimate = req.body?.tokensEstimate;
        if (typeof tokensEstimate === "number" && tokensEstimate > 0) {
          const modelToUse = requestedModel || "codex";
          const requiredCredits = Number(
            ((tokensEstimate * resolveModelMultiplier(modelToUse)) / TOKENS_PER_Z_CREDIT).toFixed(
              4,
            ),
          );
          if (credits.balance < requiredCredits) {
            return res.status(402).json({
              error: "INSUFFICIENT_CREDITS",
              message: `Insufficient Z-Credits: required ${requiredCredits}, current balance ${credits.balance}. Please top up via VietQR SePay.`,
              createOrderUrl: "/api/billing/create-order",
              upgradeUrl: "/#pricing",
              requiredCredits,
              balance: credits.balance,
            });
          }
        }
      }

      const agentId =
        req.body?.agentId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      recordUserAgentStart(userId, agentId);

      res.json({
        success: true,
        agentId,
        tier: userTier,
        activeRunningCount: getActiveUserAgentCount(userId),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/fleet/agents/stop", (req, res) => {
    const user = resolveCallerUser(req);
    const userId = user ? user.id : req.body?.userId || "anonymous_free_user";
    const agentId = req.body?.agentId;
    if (agentId) {
      recordUserAgentEnd(userId, agentId);
    }
    res.json({ success: true, activeRunningCount: getActiveUserAgentCount(userId) });
  });

  app.get("/api/fleet/council", (_req, res) => {
    res.json({
      mode: "hybrid",
      consensusThreshold: "majority",
      models: {
        ultra: {
          primary: "Claude Opus 4.6 Thinking / Opus 5.5 High",
          nodes: ["nebula", "pro-1", "ultra-2", "binhthuong", "sunward", "justaskgao"],
          role: "Architectural Planning, Multi-file Refactoring, Code Synthesis",
        },
        pro: {
          primary: "Gemini 3.8 Flash High / Flash Medium",
          nodes: [
            "ai-digimate",
            "codegeekvn",
            "gaopham",
            "insilos",
            "node-4",
            "node-5",
            "node-6",
            "team-3",
            "zenonmind",
          ],
          role: "Parallel Unit Testing, Linting, AST Verification, Sub-DAG execution",
        },
        local: {
          primary: "DeepSeek R1 (14B/32B) / Qwen 2.5 Coder (14B/32B)",
          provider: "Ollama / vLLM (Local GPU)",
          role: "Deterministic Gates, Offline Air-gapped Fallback, Anti-Cheat, Secret Leak Scan",
        },
      },
      gates: [
        { id: "lint", name: "OxLint / ESLint Zero-Error Gate", passRate: "100%" },
        { id: "types", name: "TypeScript Strict Typecheck Gate", passRate: "100%" },
        { id: "unit_tests", name: "Vitest / Hoot Test Suite Gate", passRate: "100%" },
        { id: "security_audit", name: "Secret & Credential Auditor", passRate: "100%" },
      ],
    });
  });

  app.post("/api/fleet/route", (req, res) => {
    try {
      const decision = nineRouter.route(req.body);
      res.json(decision);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Telemetry Health Spine & Multi-Subsystem Inspector
  app.get("/api/fleet/telemetry", (_req, res) => {
    void (async () => {
      try {
        const snapshot = await getTelemetryHub().getTelemetrySnapshot();
        res.json(snapshot);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Egress Proxy Pool (16 slots 20128..20143)
  app.get("/api/fleet/egress", (_req, res) => {
    void (async () => {
      try {
        const pool = await getEgressProxyManager().getPoolStatus();
        res.json(pool);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Native Hermes Agent & Database Inspector
  app.get("/api/fleet/hermes", (_req, res) => {
    void (async () => {
      try {
        const health = await getHermesManager().getHealthStatus();
        res.json(health);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Telegram Resource Shortage Alerter Test Trigger
  app.post("/api/fleet/telegram/test", (req, res) => {
    void (async () => {
      try {
        const { message } = req.body || {};
        const result = await getTelegramAlerter().sendTestAlert(message);
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Telegram Per-Conversation Notification Trigger
  app.post("/api/fleet/telegram/conversation-notify", (req, res) => {
    void (async () => {
      try {
        const { conversationId, title, event, summary } = req.body || {};
        if (!conversationId) {
          res.status(400).json({ error: "conversationId is required" });
          return;
        }
        const result = await getTelegramAlerter().sendConversationAlert({
          conversationId,
          conversationTitle: title,
          event: event || "completed",
          summary,
        });
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Zencode Universal OAuth & Provider Credential Status
  app.get("/api/fleet/auth/status", (_req, res) => {
    void (async () => {
      try {
        const status = await getZencodeOAuthManager().getStatus();
        res.json(status);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Zencode 1-Click Auto-Configure & Credential Harvester
  app.post("/api/fleet/auth/autoconfig", (_req, res) => {
    void (async () => {
      try {
        const result = await getZencodeOAuthManager().autoConfigureAll();
        getZencodeOAuthManager().applyToEnvironment();
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Zencode Manual Easy OAuth / Credential Setup
  app.post("/api/fleet/auth/manual", (req, res) => {
    try {
      const { provider, token, authType, account } = req.body || {};
      const result = getZencodeOAuthManager().setManualCredentials(provider, {
        token,
        authType,
        account,
      });
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // --- Zencode Access Passkey & 3-Fleet User Management (RBAC) ---

  // Public Verify Key (used on Web Onboarding / Login)
  app.post("/api/auth/verify-key", (req, res) => {
    try {
      const { key } = req.body || {};
      if (!key || typeof key !== "string") {
        return res.status(400).json({ valid: false, error: "Access Passkey is required" });
      }
      const result = userLedger.verifyKey(key);
      if (!result.valid) {
        return res.status(401).json({ valid: false, error: result.error });
      }
      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ valid: false, error: message });
    }
  });

  // Current User Profile & Fleet Quotas
  app.get("/api/user/me", (req, res) => {
    try {
      const token = extractHttpBearerToken(req.header("authorization"));
      if (!token) {
        return res.status(401).json({ error: "Missing Bearer Authorization header" });
      }
      const result = userLedger.verifyKey(token);
      if (!result.valid) {
        return res.status(401).json({ error: result.error });
      }
      res.json({ user: result.user });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Helper for admin authorization
  const requireAdminKey = (req: express.Request, res: express.Response): boolean => {
    const token = extractHttpBearerToken(req.header("authorization"));
    if (!token) {
      res.status(401).json({ error: "Admin Bearer token required" });
      return false;
    }
    const user = userLedger.findUserByToken(token);
    if (!user || user.role !== "admin" || user.status !== "active") {
      res.status(403).json({ error: "Forbidden: Admin privileges required" });
      return false;
    }
    return true;
  };

  // Admin: List all users and passkey states
  app.get("/api/admin/users", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    res.json({ users: userLedger.listUsers() });
  });

  // Admin: Create new user with custom fleet permissions
  app.post("/api/admin/users/create", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    try {
      const {
        username,
        displayName,
        role,
        allowedFleets,
        dailyTokenBudget,
        dailyGpuMinutes,
        dailyRequests,
        allowClaudeOpus,
        expiresInDays,
      } = req.body || {};
      if (!username) {
        return res.status(400).json({ error: "username is required" });
      }
      const result = userLedger.createUser({
        username,
        displayName,
        role,
        allowedFleets,
        dailyTokenBudget,
        dailyGpuMinutes,
        dailyRequests,
        allowClaudeOpus,
        expiresInDays,
      });
      res.status(201).json({ success: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Admin: Revoke user passkey
  app.post("/api/admin/users/:id/revoke", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    const ok = userLedger.revokeUser(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: `User '${req.params.id}' not found` });
    }
    res.json({ success: true, status: "revoked" });
  });

  // Admin: Adjust user fleet quota
  app.post("/api/admin/users/:id/adjust-quota", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    const { fleet, addTokens, addGpuMinutes, addRequests } = req.body || {};
    if (!fleet) {
      return res
        .status(400)
        .json({ error: "fleet ('llm' | 'modal_gpu' | 'cloudflare_clef') is required" });
    }
    const ok = userLedger.adjustQuota(req.params.id, fleet, {
      addTokens,
      addGpuMinutes,
      addRequests,
    });
    if (!ok) {
      return res.status(404).json({ error: `User '${req.params.id}' not found` });
    }
    res.json({ success: true, user: userLedger.getUser(req.params.id) });
  });

  // Admin: Record simulated user fleet usage
  app.post("/api/admin/users/:id/record-usage", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    const { fleet, amount } = req.body || {};
    if (!fleet || typeof amount !== "number") {
      return res.status(400).json({ error: "fleet and numeric amount are required" });
    }
    userLedger.recordUsage(req.params.id, fleet, amount);
    res.json({ success: true, user: userLedger.getUser(req.params.id) });
  });

  // Admin: Record model usage with market credit multiplier (non-blocking)
  app.post("/api/admin/users/:id/record-model-usage", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    const { model, tokenCount } = req.body || {};
    if (!model || typeof tokenCount !== "number") {
      return res.status(400).json({ error: "model string and numeric tokenCount are required" });
    }
    const result = userLedger.recordModelUsage(req.params.id, model, tokenCount);
    res.json({ success: true, ...result, user: userLedger.getUser(req.params.id) });
  });

  // Admin: Manually grant or revoke Private Fleet access
  app.post("/api/admin/users/:id/private-fleet", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    const { enabled } = req.body || {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "boolean 'enabled' is required" });
    }
    const ok = userLedger.setPrivateFleetAccess(req.params.id, enabled);
    if (!ok) {
      return res.status(404).json({ error: `User '${req.params.id}' not found` });
    }
    res.json({ success: true, user: userLedger.getUser(req.params.id) });
  });

  // Admin: Adjust specialized service quota (TTS, t2Image, Img2Img)
  app.post("/api/admin/users/:id/service-quota", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    const { addTtsMinutes, addT2Images, addImg2ImgEdits } = req.body || {};
    const ok = userLedger.adjustServiceQuota(req.params.id, {
      addTtsMinutes: typeof addTtsMinutes === "number" ? addTtsMinutes : undefined,
      addT2Images: typeof addT2Images === "number" ? addT2Images : undefined,
      addImg2ImgEdits: typeof addImg2ImgEdits === "number" ? addImg2ImgEdits : undefined,
    });
    if (!ok) {
      return res.status(404).json({ error: `User '${req.params.id}' not found` });
    }
    res.json({ success: true, user: userLedger.getUser(req.params.id) });
  });

  // Admin: Record specialized service usage (TTS, t2Image, Img2Img)
  app.post("/api/admin/users/:id/record-service-usage", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    const { service, amount } = req.body || {};
    if (!service || typeof amount !== "number") {
      return res
        .status(400)
        .json({ error: "service ('tts'|'t2image'|'img2img') and numeric amount are required" });
    }
    const ok = userLedger.recordServiceUsage(req.params.id, service, amount);
    if (!ok) {
      return res.status(404).json({ error: `User '${req.params.id}' not found` });
    }
    res.json({ success: true, user: userLedger.getUser(req.params.id) });
  });

  // Admin: Reset user usage on-demand (LLM, GPU, Clef, TTS, t2Image, Img2Img)
  app.post("/api/admin/users/:id/reset-usage", (req, res) => {
    if (!requireAdminKey(req, res)) return;
    const ok = userLedger.resetUserUsage(req.params.id);
    if (!ok) {
      return res.status(404).json({ error: `User '${req.params.id}' not found` });
    }
    res.json({ success: true, user: userLedger.getUser(req.params.id) });
  });

  // ─────────────────────────────────────────────────────────────
  // Zencode Product Launch: Google OAuth & VietQR SePay Billing
  // ─────────────────────────────────────────────────────────────
  const sepayGateway = getSepayGateway({ db: zencodeDb });
  const antiSybilLedger = getAntiSybilLedger();
  const googleOAuth = getGoogleOAuthService({ db: zencodeDb, ledger: userLedger });

  // Google OAuth Config
  app.get("/api/fleet/auth/oauth/google/config", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.json(googleOAuth.getPublicConfig());
  });

  // Google OAuth Authenticate (1-click sign-in / registration)
  app.post("/api/fleet/auth/oauth/google", (req, res) => {
    void (async () => {
      try {
        const { idToken } = req.body || {};
        if (!idToken) {
          return res.status(400).json({ error: "Missing required parameter 'idToken'" });
        }
        const ipAddress = AntiSybilLedger.extractClientIp(req);
        const userAgent = (req.headers["user-agent"] as string) || "";

        // Check if user is already registered (existing users bypass registration anti-sybil limit)
        const isExisting = googleOAuth.isExistingUser(idToken);
        if (!isExisting) {
          const antiSybilCheck = antiSybilLedger.checkRegistration(ipAddress, userAgent);
          if (!antiSybilCheck.allowed) {
            const body: Record<string, any> = { error: antiSybilCheck.error };
            if (antiSybilCheck.retryAfter !== undefined) {
              body.retryAfter = antiSybilCheck.retryAfter;
            }
            return res.status(429).json(body);
          }
        }

        const result = await googleOAuth.authenticate(idToken, ipAddress);
        if (!result.success) {
          return res.status(401).json({ error: result.error || "Google authentication failed" });
        }
        if (result.isNewUser) {
          antiSybilLedger.recordRegistration(ipAddress);
        }
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // VietQR / SePay: Create Payment Order
  const handleCreateOrder = (req: express.Request, res: express.Response) => {
    try {
      const { userId, planCode, customAmount } = req.body || {};
      if (!userId || !planCode) {
        return res.status(400).json({ error: "userId and planCode are required" });
      }
      const user = zencodeDb.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: `User '${userId}' not found` });
      }
      if (
        customAmount !== undefined &&
        (typeof customAmount !== "number" || !Number.isFinite(customAmount) || customAmount <= 0)
      ) {
        return res.status(400).json({ error: "customAmount must be a positive number" });
      }
      const orderData = sepayGateway.createPaymentOrder({ userId, planCode, customAmount });
      res.json({ success: true, ...orderData });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  };
  app.post("/api/billing/orders/create", handleCreateOrder);
  app.post("/api/billing/create-order", handleCreateOrder);

  // VietQR / SePay: Get Order Status
  app.get("/api/billing/orders/:orderCode/status", (req, res) => {
    try {
      const order = sepayGateway.getOrderStatus(req.params.orderCode);
      if (!order) {
        return res.status(404).json({ error: `Order '${req.params.orderCode}' not found` });
      }
      res.json({ success: true, order });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // VietQR / SePay: Webhook Callback
  const handleSepayWebhook = (req: express.Request, res: express.Response) => {
    try {
      const authHeader = req.headers.authorization;
      const tokenQuery = req.query.token as string | undefined;
      const payload = req.body;
      const result = sepayGateway.handleWebhook(payload, authHeader, tokenQuery);
      res.status(result.status).json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  };
  app.post("/api/billing/sepay/webhook", handleSepayWebhook);
  app.post("/api/billing/sepay-webhook", handleSepayWebhook);

  // Pricing plans catalog
  app.get("/api/billing/plans", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.json({ plans: Object.values(ZENCODE_PLANS) });
  });

  // User credits balance & ledger summary
  app.get("/api/billing/user/:userId/credits", (req, res) => {
    try {
      const credits = zencodeDb.getUserCredits(req.params.userId);
      res.json({ success: true, credits });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Credit Balance Query (< 50ms p95 SLA)
  app.get("/api/billing/credits/balance", (req, res) => {
    try {
      const user = resolveCallerUser(req);
      if (!user) {
        return res
          .status(401)
          .json({ error: "Unauthorized: Valid Bearer token or userId required" });
      }

      const refillResult = zencodeDb.checkAndRefillMonthlyCredits(user.id);
      const credits = zencodeDb.getUserCredits(user.id);
      const tokensEquivalentRemaining = Math.round(credits.balance * 2500);

      res.json({
        success: true,
        userId: user.id,
        balance: credits.balance,
        tier: user.tier,
        nextResetDate:
          refillResult?.nextResetDate ||
          new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        totalDeposited: credits.totalDeposited,
        totalConsumed: credits.totalConsumed,
        tokensEquivalentRemaining,
        conversionRate: "1 Credit = 2,500 Flash/Codex tokens",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Fleet Quotas & Concurrency Transparency Query
  app.get("/api/fleet/user/quotas", (req, res) => {
    try {
      const user = resolveCallerUser(req);
      if (!user) {
        return res
          .status(401)
          .json({ error: "Unauthorized: Valid Bearer token or userId required" });
      }

      const refillResult = zencodeDb.checkAndRefillMonthlyCredits(user.id);
      const credits = zencodeDb.getUserCredits(user.id);
      const userRecord = zencodeDb.getUserById(user.id) || user;
      const isFreeTier = userRecord.tier === "free";

      res.json({
        success: true,
        userId: userRecord.id,
        tier: userRecord.tier,
        balance: credits.balance,
        nextResetDate:
          refillResult?.nextResetDate ||
          new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        quotas: {
          llm: {
            dailyTokenBudget: userRecord.quotas.llm.dailyTokenBudget,
            usedTodayTokens: userRecord.quotas.llm.usedTodayTokens,
            remainingTokens: Math.max(
              0,
              userRecord.quotas.llm.dailyTokenBudget - userRecord.quotas.llm.usedTodayTokens,
            ),
            allowedModels: isFreeTier
              ? ["codex", "gemini-2.5-flash"]
              : userRecord.quotas.llm.allowedModels,
            allowClaudeOpus: isFreeTier ? false : Boolean(userRecord.quotas.llm.allowClaudeOpus),
            maxSpecialistAgents: isFreeTier ? 2 : 10,
          },
          modal_gpu: {
            enabled: isFreeTier ? false : userRecord.quotas.modal_gpu.enabled,
            dailyGpuMinutes: isFreeTier ? 0 : userRecord.quotas.modal_gpu.dailyGpuMinutes,
            usedTodayMinutes: userRecord.quotas.modal_gpu.usedTodayMinutes,
          },
          cloudflare_clef: {
            enabled: userRecord.quotas.cloudflare_clef.enabled,
            dailyRequests: userRecord.quotas.cloudflare_clef.dailyRequests,
            usedTodayRequests: userRecord.quotas.cloudflare_clef.usedTodayRequests,
          },
        },
        concurrency: {
          maxSpecialistAgents: isFreeTier ? 2 : 10,
          currentRunningAgents: 0,
          description: isFreeTier
            ? "Free tier allows a maximum of 2 Specialist Agents running concurrently (Architect + Coder)"
            : "Unlimited / higher concurrency for paid tiers",
        },
        consumptionHistory: {
          totalDeposited: credits.totalDeposited,
          totalConsumed: credits.totalConsumed,
          currentBalance: credits.balance,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // Zencode Workspace MCP Servers Status (Figma, GDrive, Canva, Notion, Linear)
  app.get("/api/fleet/mcp/status", (_req, res) => {
    void (async () => {
      try {
        const mcpStatus = await getZencodeMcpRegistry().getMcpStatus();
        res.json(mcpStatus);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // Zencode Migrated Projects Swarm Endpoints
  const projectMigration = getZencodeProjectMigrationService();

  app.get("/api/fleet/projects", (_req, res) => {
    void (async () => {
      try {
        const projects = await projectMigration.getProjects();
        res.json({ projects });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/projects/migrate", (_req, res) => {
    void (async () => {
      try {
        const result = await projectMigration.syncToZencodeRegistries();
        res.json({ success: true, ...result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  app.post("/api/fleet/projects/health", (_req, res) => {
    void (async () => {
      try {
        const projects = await projectMigration.checkAllHealth();
        res.json({ projects });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/projects/:id/verify", (req, res) => {
    void (async () => {
      try {
        const result = await projectMigration.runQualityGate(req.params.id);
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  // OpenCode Fleet Swarm Endpoints
  const openCodeFleet = getOpenCodeFleetManager();

  app.get("/api/fleet/opencode/nodes", (_req, res) => {
    void (async () => {
      try {
        const nodes = await openCodeFleet.getNodes();
        res.json({ nodes });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/opencode/sync", (_req, res) => {
    void (async () => {
      try {
        const result = await openCodeFleet.syncAccounts();
        res.json({ success: true, ...result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  app.post("/api/fleet/opencode/dispatch", (req, res) => {
    void (async () => {
      try {
        const { nodeId, prompt, model, timeoutMs } = req.body || {};
        if (!nodeId || !prompt) {
          res.status(400).json({ error: "Missing required parameters: nodeId and prompt" });
          return;
        }
        const result = await openCodeFleet.dispatchJob(nodeId, prompt, model, timeoutMs);
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  app.post("/api/fleet/opencode/parallel", (req, res) => {
    void (async () => {
      try {
        const { prompt, model, nodes, timeoutMs } = req.body || {};
        if (!prompt) {
          res.status(400).json({ error: "Missing required parameter: prompt" });
          return;
        }
        const result = await openCodeFleet.dispatchParallel({ prompt, model, nodes, timeoutMs });
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  app.get("/api/fleet/opencode/jobs", (_req, res) => {
    res.json({ jobs: openCodeFleet.getJobHistory() });
  });

  // --- Modal GPU Swarm & Modal CLI Endpoints (Guarded: Modal GPU requires Pro or Enterprise tier) ---
  app.use("/api/fleet/modal", (req, res, next) => {
    if (
      req.path === "/resources.json" ||
      req.path === "/telemetry" ||
      req.path === "/telemetry/report"
    ) {
      return next();
    }
    const user = resolveCallerUser(req);
    const userTier = user ? user.tier : "free";
    const gate = assertFreeTierGating({ userTier, isModalGpuRequest: true });
    if (!gate.allowed) {
      return res.status(gate.status).json(gate.body);
    }
    next();
  });

  app.get("/api/fleet/modal/summary", (_req, res) => {
    void (async () => {
      try {
        const summary = await modalGpuSwarm.getSummary();
        res.json({ summary });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/modal/profiles", (_req, res) => {
    void (async () => {
      try {
        const profiles = await modalGpuSwarm.getProfiles();
        res.json({ profiles });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/modal/workers", (req, res) => {
    void (async () => {
      try {
        const forceRefresh = req.query.refresh === "true";
        const workers = await modalGpuSwarm.getDeployedWorkers(forceRefresh);
        res.json({ workers });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/modal/workloads", (_req, res) => {
    res.json({ workloads: CANONICAL_WORKLOADS });
  });

  app.post("/api/fleet/modal/profile/switch", (req, res) => {
    void (async () => {
      try {
        const { profile } = req.body || {};
        if (!profile || typeof profile !== "string") {
          res.status(400).json({ error: "Missing required profile name" });
          return;
        }
        const result = await modalGpuSwarm.switchProfile(profile);
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/modal/cli/exec", (req, res) => {
    void (async () => {
      try {
        const { command, args, timeoutMs } = req.body || {};
        if (!command || typeof command !== "string") {
          res.status(400).json({ error: "Missing required command" });
          return;
        }
        const result = await modalGpuSwarm.executeModalCli(
          command,
          Array.isArray(args) ? args : [],
          timeoutMs,
        );
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/modal/credits", (req, res) => {
    void (async () => {
      try {
        const forceRefresh = req.query.refresh === "true";
        const result = await modalGpuSwarm.getWorkspacesCredits(forceRefresh);
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/modal/recommendations", (_req, res) => {
    void (async () => {
      try {
        const recommendations = await modalGpuSwarm.getRecommendations();
        res.json({ recommendations });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/modal/allocate", (req, res) => {
    void (async () => {
      try {
        const { appId } = req.body || {};
        if (!appId || typeof appId !== "string") {
          res.status(400).json({ error: "Missing required appId" });
          return;
        }
        const result = await modalGpuSwarm.allocateWorkload(appId);
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/modal/logs", (req, res) => {
    void (async () => {
      try {
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const page = req.query.page ? Number(req.query.page) : undefined;
        const since_id = req.query.since_id ? Number(req.query.since_id) : undefined;
        const workspace = req.query.workspace ? String(req.query.workspace) : undefined;
        const app_id = req.query.app_id ? String(req.query.app_id) : undefined;
        const status = req.query.status ? String(req.query.status) : undefined;
        const min_cost = req.query.min_cost ? Number(req.query.min_cost) : undefined;
        const max_cost = req.query.max_cost ? Number(req.query.max_cost) : undefined;
        const order = req.query.order ? String(req.query.order) : undefined;

        const result = await modalGpuSwarm.getModalLogs({
          limit,
          page,
          since_id,
          workspace,
          app_id,
          status,
          min_cost,
          max_cost,
          order,
        });
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/modal/logs/metrics", (req, res) => {
    void (async () => {
      try {
        const hours = req.query.time_window_hours ? Number(req.query.time_window_hours) : undefined;
        const metrics = await modalGpuSwarm.getModalLogMetrics(hours);
        res.json(metrics);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/modal/logs/retention", (req, res) => {
    void (async () => {
      try {
        const days = req.body?.retention_days ? Number(req.body.retention_days) : 14;
        const result = await modalGpuSwarm.pruneModalLogs(days);
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.get("/api/fleet/modal/rebalance/recommendations", (req, res) => {
    void (async () => {
      try {
        const force = req.query.force_refresh === "true";
        const status = await modalGpuSwarm.getCrossMeshRebalanceRecommendations(force);
        res.json(status);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  app.post("/api/fleet/modal/rebalance/apply", (req, res) => {
    void (async () => {
      try {
        const { recommendation_id, action_payload } = req.body || {};
        if (!recommendation_id || typeof recommendation_id !== "string") {
          res.status(400).json({ error: "Missing recommendation_id" });
          return;
        }
        const result = await modalGpuSwarm.applyCrossMeshRebalance(
          recommendation_id,
          action_payload,
        );
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    })();
  });

  // --- Fleet Analytics, Cost Accounting & 30-Day Retention DB Endpoints ---
  app.get("/api/fleet/analytics/summary", (req, res) => {
    try {
      const range = (req.query.range as any) || "24h";
      const summary = analyticsDb.getSummary(range);
      res.json({ summary });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/fleet/analytics/timeline", (req, res) => {
    try {
      const range = (req.query.range as any) || "24h";
      const timeline = analyticsDb.getTimeline(range);
      res.json({ timeline });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/fleet/analytics/nodes", (req, res) => {
    try {
      const range = (req.query.range as any) || "24h";
      const nodes = analyticsDb.getNodeUtilization(range);
      res.json({ nodes });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/fleet/analytics/models", (req, res) => {
    try {
      const range = (req.query.range as any) || "24h";
      const { models, totals } = analyticsDb.getModelAnalytics(range);
      res.json({ models, totals });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/fleet/analytics/node-models", (req, res) => {
    try {
      const range = (req.query.range as any) || "24h";
      const distributions = analyticsDb.getNodeModelDistributions(range);
      res.json({ distributions });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/fleet/analytics/requests", (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const cluster = req.query.cluster ? String(req.query.cluster) : undefined;
      const requests = analyticsDb.getRecentRequests(limit, cluster);
      res.json({ requests });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/fleet/analytics/retention", (_req, res) => {
    try {
      const history = analyticsDb.getRetentionHistory();
      res.json({ history });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/fleet/analytics/prune", (req, res) => {
    try {
      const days = Number(req.body?.retentionDays) || 30;
      const result = analyticsDb.pruneOlderThan30Days(days);
      res.json({ success: true, result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: message });
    }
  });

  app.post("/api/goal/start", (req, res) => {
    const { intent, budgetCapTokens } = req.body || {};
    goalEngine
      .startGoal(intent || "Autonomous task", budgetCapTokens)
      .then((goalId) => {
        res.json({ goalId, status: goalEngine.getStatus() });
        return goalId;
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      });
  });

  app.get("/api/goal/status", (_req, res) => {
    res.json({ status: goalEngine.getStatus(), tasks: goalEngine.getTasks() });
  });

  app.post("/api/goal/cancel", (_req, res) => {
    goalEngine.cancelGoal();
    res.json({ status: "cancelled" });
  });

  // --- Zencode Self-Healing & Git Fix Dispatcher Endpoints ---
  app.get("/api/fleet/self-healing/incidents", (_req, res) => {
    res.json({ incidents: selfHealing.getAllIncidents() });
  });

  app.get("/api/fleet/self-healing/status", (_req, res) => {
    res.json({ status: selfHealing.getCircuitBreakerStatus() });
  });

  app.post("/api/fleet/self-healing/report", (req, res) => {
    void (async () => {
      try {
        const incident = await selfHealing.reportIncident(req.body || {});
        res.json({ success: true, incident });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  app.post("/api/fleet/self-healing/incidents/:id/propose", (req, res) => {
    void (async () => {
      try {
        const fix = await selfHealing.proposeFix(req.params.id);
        res.json({ success: true, fix });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  app.post("/api/fleet/self-healing/incidents/:id/heal", (req, res) => {
    void (async () => {
      try {
        const { pushToRemote = false } = req.body || {};
        const result = await selfHealing.healAndCreateBranch(req.params.id, pushToRemote);
        res.json({ success: true, result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  app.post("/api/fleet/self-healing/incidents/:id/autonomous", (req, res) => {
    void (async () => {
      try {
        const {
          testCommand,
          targetBranch,
          autoMerge = true,
          pushToRemote = false,
        } = req.body || {};
        const result = await selfHealing.autonomousHeal(req.params.id, {
          testCommand,
          targetBranch,
          autoMerge,
          pushToRemote,
        });
        res.json({ success: result.success, result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ success: false, error: message });
      }
    })();
  });

  app.post("/api/fleet/self-healing/circuit-breaker/reset", (req, res) => {
    const { key } = req.body || {};
    selfHealing.resetCircuitBreaker(key);
    res.json({ success: true, status: selfHealing.getCircuitBreakerStatus() });
  });
}

function createZencodeSwarmSubsystems(config: PaseoDaemonConfig, logger: Logger) {
  const fleetRegistry = new FleetRegistry({ logger });
  setFleetRegistry(fleetRegistry);
  const nineRouter = new NineRouter({ registry: fleetRegistry, logger });
  setNineRouter(nineRouter);
  const egressManager = new EgressManager({ logger });
  const clefCouncil = new ClefCouncil({ logger });
  const goalEngine = new GoalEngine({
    registry: fleetRegistry,
    router: nineRouter,
    council: clefCouncil,
    logger,
    workspaceDir: config.paseoHome,
  });
  const selfHealing = new SelfHealingSupervisor({
    storageDir: config.paseoHome,
    defaultWorkspaceDir: process.cwd(),
  });
  const shutdownSwarm = async (): Promise<void> => {
    goalEngine.cancelGoal();
    try {
      await fleetRegistry.shutdown();
    } catch {
      // ignore
    }
  };
  return {
    fleetRegistry,
    nineRouter,
    egressManager,
    clefCouncil,
    goalEngine,
    selfHealing,
    shutdownSwarm,
  };
}

function resolveBootstrapGitPolicy(config: PaseoDaemonConfig) {
  return config.git ?? resolveGitProcessPolicy({ env: process.env });
}

function resolveBootstrapDaemonVersion(config: PaseoDaemonConfig, metaUrl: string): string {
  return config.daemonVersion ?? resolveDaemonVersion(metaUrl);
}

export async function createPaseoDaemon(
  config: PaseoDaemonConfig,
  rootLogger: Logger,
  dependencies: PaseoDaemonDependencies = {},
): Promise<PaseoDaemon> {
  configureGitProcessPolicy(resolveBootstrapGitPolicy(config));
  const logger = rootLogger.child({ module: "bootstrap" });
  const obsoleteTimelineDirectory = path.join(config.paseoHome, "agent-timelines");
  await rm(obsoleteTimelineDirectory, { recursive: true, force: true }).catch((error) => {
    logger.warn(
      { err: error, path: obsoleteTimelineDirectory },
      "Failed to remove obsolete agent timeline data",
    );
  });
  const bootstrapStart = performance.now();
  const elapsed = () => `${(performance.now() - bootstrapStart).toFixed(0)}ms`;
  const daemonVersion = resolveBootstrapDaemonVersion(config, import.meta.url);
  const initialMutableConfig = createInitialMutableDaemonConfig(config);
  const daemonConfigStore = new DaemonConfigStore(config.paseoHome, initialMutableConfig, logger, {
    relayEnabledMutable: config.relayEnabledMutable ?? true,
    startupPersisted: config.configReload?.startupPersisted,
    reloadSource: {
      resolve: (persisted) => {
        const reloaded = resolveConfigFromPersisted(config.paseoHome, persisted, {
          env: config.configReload?.env ?? process.env,
          cli: config.configReload?.cli,
          relayEnabledFallback: config.configReload?.relayEnabledFallback,
        });
        return {
          mutable: createInitialMutableDaemonConfig(reloaded),
          overrideControlledPaths: reloaded.configReload?.overrideControlledPaths ?? [],
        };
      },
    },
  });
  const orchestrationSkills = createOrchestrationSkills(daemonConfigStore);
  void orchestrationSkills.autoUpdate().catch((error) => {
    logger.error({ err: error }, "Failed to maintain orchestration skills at startup");
  });
  const browserToolsPolicy = new DaemonConfigBrowserToolsPolicy(daemonConfigStore);
  const browserToolsBroker = new BrowserToolsBroker({});

  const swarm = createZencodeSwarmSubsystems(config, logger);
  const { fleetRegistry, nineRouter, egressManager, clefCouncil, goalEngine } = swarm;
  const pluginRuntime: PluginService = new PluginService(logger, daemonConfigStore, daemonVersion, {
    usageAgents: {
      hasAgent: (id) => agentManager.getAgent(id) !== null,
      usageSession: (id) => agentManager.usageSession(id),
    },
    managedSources: new ManagedPluginSources(config.paseoHome, {
      enabled: config.pluginRegistryEnabled ?? false,
      registries: config.pluginRegistries,
      defaultUrl: config.pluginRegistryUrl,
    }),
    builtinPlugins: resolveBuiltinPluginLoader(dependencies),
    settingsDirectory: path.join(config.paseoHome, "plugin-settings"),
  });

  const serverId = getOrCreateServerId(config.paseoHome, { logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(config.paseoHome, logger);
  const managedProcesses = createBootstrapManagedProcessRegistry(config, logger);
  // Reconcile the helper-process ledger in the background so it never blocks the
  // daemon from coming up; terminating a live leftover can take a few seconds.
  // Best-effort, so a failure is logged here rather than crashing startup.
  void reconcileManagedProcessLedger(managedProcesses, logger).catch((error) => {
    logger.warn({ err: error }, "Failed to reconcile managed helper process ledger");
  });
  let relayRuntime: RelayRuntime | null = null;

  const staticDir = config.staticDir;
  const downloadTokenTtlMs = config.downloadTokenTtlMs ?? 60000;

  const downloadTokenStore = new DownloadTokenStore({
    ttlMs: downloadTokenTtlMs,
  });

  // Capability token authenticating the daemon's own agents to the loopback
  // Agent MCP endpoint (/mcp/agents). Random per daemon run, injected only into
  // local agent configs and the daemon's own MCP client — never sent to remote
  // clients — so it cannot be replayed off-box. This lets the injected MCP
  // authenticate even when the daemon password is set via the app (hash only,
  // no plaintext available). Mirrors the /api/files/download capability-token
  // pattern.
  const agentMcpAuthToken = randomUUID();

  const listenTarget = parseListenString(config.listen);

  const app = express();
  app.set("trust proxy", resolveExpressTrustProxySetting(config));
  daemonConfigStore.onFieldChange("trustedProxies", (value) => {
    app.set("trust proxy", value ?? ["loopback"]);
  });
  let boundListenTarget: ListenTarget | null = null;
  let workspaceRegistry: FileBackedWorkspaceRegistry | null = null;
  const terminalManager = createConfiguredTerminalManager({
    getTerminalActivityUrl: () => createTerminalActivityUrl(boundListenTarget),
  });
  applyTerminalAgentHookSetting({ store: daemonConfigStore, logger });

  const serviceProxyPublicBaseUrl = config.serviceProxy?.publicBaseUrl
    ? config.serviceProxy.publicBaseUrl
    : null;
  const serviceProxy = createServiceProxySubsystem({
    logger,
    publicBaseUrl: serviceProxyPublicBaseUrl,
  });
  const scriptRuntimeStore = new WorkspaceScriptRuntimeStore();
  const workspaceSetupRuntime = new WorkspaceSetupRuntime();
  let configuredHostnames = config.hostnames ?? config.allowedHosts;
  let appBaseUrl = config.appBaseUrl ?? process.env.ZENCODE_APP_URL ?? "http://127.0.0.1:6768";
  daemonConfigStore.onFieldChange("hostnames", (value) => {
    configuredHostnames = value as HostnamesConfig | undefined;
  });
  daemonConfigStore.onFieldChange("app.baseUrl", (value) => {
    appBaseUrl =
      typeof value === "string" ? value : (process.env.ZENCODE_APP_URL ?? "http://127.0.0.1:6768");
  });
  let wsServer: VoiceAssistantWebSocketServer | null = null;
  let serviceProxyListenTarget: ListenTarget | null = null;
  const scriptHealthMonitor = new ScriptHealthMonitor({
    serviceProxy,
    onChange: createScriptStatusEmitter({
      sessions: () =>
        wsServer?.listSessions().map((session) => ({
          emit: (message) => session.emitServerMessage(message),
        })) ?? [],
      serviceProxy,
      runtimeStore: scriptRuntimeStore,
      daemonPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
      resolveWorkspaceDirectory: async (workspaceId) =>
        (await workspaceRegistry?.get(workspaceId))?.cwd ?? null,
      logger,
      serviceProxyPublicBaseUrl,
    }),
  });
  const handleBranchChange = createBranchChangeRouteHandler({
    serviceProxy,
    onRoutesChanged: (workspaceId) => {
      scriptHealthMonitor.invalidateWorkspace(workspaceId);
    },
    logger,
  });

  // Mount distributed tracing middleware before all API endpoints and proxy routes.
  // Extracts trace_id / request_id, propagates headers, and records local zero-telemetry spans.
  app.use(distributedTracingMiddleware);

  // Service proxy classifies service hosts before daemon auth/route fallthrough.
  // Registered service hosts proxy directly; known service namespaces without a
  // route return 404 and never reach daemon APIs.
  app.use(serviceProxy.middleware());

  // Host allowlist / DNS rebinding protection (vite-like semantics).
  // For non-TCP (unix sockets), skip host validation.
  if (listenTarget.type === "tcp") {
    app.use((req, res, next) => {
      const hostHeader = typeof req.headers.host === "string" ? req.headers.host : undefined;
      if (!isHostnameAllowed(hostHeader, configuredHostnames)) {
        res.status(403).json({ error: "Invalid Host header" });
        return;
      }
      next();
    });
  }

  // CORS - allow same-origin + configured origins
  const fixedAllowedOrigins = [
    // Packaged desktop renderers use the custom paseo:// protocol scheme.
    "paseo://app",
    // For TCP, add localhost variants
    ...(listenTarget.type === "tcp"
      ? [
          `http://${listenTarget.host}:${listenTarget.port}`,
          `http://localhost:${listenTarget.port}`,
          `http://127.0.0.1:${listenTarget.port}`,
        ]
      : []),
  ];
  const allowedOrigins = new Set([...config.corsAllowedOrigins, ...fixedAllowedOrigins]);
  daemonConfigStore.onFieldChange("cors.allowedOrigins", (value) => {
    allowedOrigins.clear();
    for (const origin of [...((value as string[] | undefined) ?? []), ...fixedAllowedOrigins]) {
      allowedOrigins.add(origin);
    }
  });

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.has("*") || allowedOrigins.has(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Local, harmless, and token-gated; deliberately skips daemon auth.
  app.post(
    "/api/terminal-activity",
    express.json(),
    createTerminalActivityRouteHandler(terminalManager),
  );

  // Serve the bundled browser web UI when enabled. Mounted after service-proxy
  // classification and host/CORS handling, but before daemon bearer auth, so
  // static app files load without the daemon password while API/WebSocket calls
  // remain protected.
  mountWebUi(app, config, logger);

  let localCredential: string | null = null;
  const daemonAuth = { ...config.auth, localCredential: () => localCredential };
  app.use(
    createRequireBearerMiddleware(daemonAuth, (context) => {
      logger.warn(context, "Rejected HTTP request with invalid daemon password");
    }),
  );

  app.use(express.json());

  // Serve static files from public directory
  app.use("/public", express.static(staticDir));

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=1, s-maxage=5, stale-while-revalidate=10");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      status: "server_info",
      serverId,
      hostname: getHostName(),
      version: daemonVersion,
      listen: formatListenTarget(boundListenTarget ?? listenTarget),
    });
  });

  // Zero-telemetry distributed trace spans introspection endpoint
  app.get("/api/system/traces/spans", createTraceSpansRouteHandler());

  // Modal Gateway Proxy Routes (resolve, telemetry, resources.json -> router:7777)
  mountModalRouterProxyRoutes(app);

  // Hub Webhook Ingress Proxy Routes (linear, slack, github -> hub:3000)
  mountHubWebhookProxyRoutes(app);

  // OpenAPI 3.1 specification serving
  mountOpenApiRoutes(app);

  // Zencode Swarm & Autonomous endpoints
  mountZencodeFleetAndGoalEndpoints(app, fleetRegistry, nineRouter, goalEngine, swarm.selfHealing);

  const handleFileDownload = async (req: express.Request, res: express.Response): Promise<void> => {
    const token =
      typeof req.query.token === "string" && req.query.token.trim().length > 0
        ? req.query.token.trim()
        : null;

    if (!token) {
      res.status(400).json({ error: "Missing download token" });
      return;
    }

    const entry = downloadTokenStore.consumeToken(token);
    if (!entry) {
      res.status(403).json({ error: "Invalid or expired token" });
      return;
    }

    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      fileHandle = await open(entry.absolutePath, DOWNLOAD_OPEN_FLAGS);
      const fileStats = await fileHandle.stat();
      if (!fileStats.isFile()) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const safeFileName = entry.fileName.replace(/["\r\n]/g, "_");
      res.setHeader("Content-Type", entry.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
      res.setHeader("Content-Length", fileStats.size.toString());

      const stream = fileHandle.createReadStream();
      fileHandle = null;
      stream.on("error", (err) => {
        logger.error({ err }, "Failed to stream download");
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to read file" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      logger.error({ err }, "Failed to download file");
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      }
    } finally {
      await fileHandle?.close().catch(() => undefined);
    }
  };

  app.get("/api/files/download", (req, res) => {
    void handleFileDownload(req, res);
  });

  const httpServer = createHTTPServer(app);

  // Script proxy WebSocket upgrade handler — must be registered before the
  // VoiceAssistantWebSocketServer attaches its own "upgrade" listener so that
  // script-bound upgrades are forwarded first. The handler is a no-op for
  // requests that don't match a registered script route.
  httpServer.on("upgrade", serviceProxy.upgradeHandler({ passthroughUnknown: true }));

  if (config.serviceProxy?.standaloneListen) {
    serviceProxyListenTarget = parseListenString(config.serviceProxy.standaloneListen);
  }

  const agentStorage = new AgentStorage(config.agentStoragePath, logger);
  const projectRegistry = new FileBackedProjectRegistry(
    path.join(config.paseoHome, "projects", "projects.json"),
    logger,
  );
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(config.paseoHome, "projects", "workspaces.json"),
    logger,
  );
  const workspaceLabelService = createWorkspaceLabelService({
    paseoHome: config.paseoHome,
    workspaceRegistry,
  });
  const github = createGitHubService();
  const workspaceGitService = new WorkspaceGitServiceImpl({
    logger,
    paseoHome: config.paseoHome,
    worktreesRoot: config.worktreesRoot,
    deps: {
      forgeOverrides: { github },
    },
  });
  workspaceRegistry.subscribeToMutations((mutation) => {
    if (mutation.kind === "archive" && mutation.workspace) {
      pluginRuntime.emit("workspace.archived", {
        workspace: describeHookWorkspace(mutation.workspace),
      });
    }
  });
  const workspaceProvisioning = createWorkspaceProvisioningService({
    lifecycle: pluginRuntime,
    serverId,
    projectRegistry,
    workspaceRegistry,
    workspaceGitService,
    isDirectory: async (target) => (await stat(target).catch(() => null))?.isDirectory() ?? false,
    logger,
  });
  const agentProviderRuntime = await createAgentProviderRuntime({
    paseoHome: config.paseoHome,
    logger,
    snapshotManager: {
      refreshTimeoutMs: config.providerCatalogRefreshTimeoutMs,
      runtimeSettings: config.agentProviderSettings,
      providerOverrides: config.providerOverrides,
      workspaceGitService,
      managedProcesses,
      isDev: config.isDev === true,
      extraClients: config.agentClients,
    },
  });
  const providerSnapshotManager = agentProviderRuntime.snapshotManager;
  daemonConfigStore.onFieldChange("catalogRefreshTimeoutMs", (value) => {
    providerSnapshotManager.setRefreshTimeoutMs(typeof value === "number" ? value : undefined);
  });
  daemonConfigStore.onFieldChange("git.maxProcessesPerSecond", () => {
    const git = daemonConfigStore.get().git;
    if (git) configureGitProcessPolicy(git);
  });
  daemonConfigStore.onFieldChange("git.maxProcessConcurrency", () => {
    const git = daemonConfigStore.get().git;
    if (git) configureGitProcessPolicy(git);
  });
  const initialAgentManagerState = providerSnapshotManager.getAgentManagerProviderState();
  const agentManager = new AgentManager({
    pluginLifecycle: pluginRuntime,
    clients: initialAgentManagerState.clients,
    providerDefinitions: initialAgentManagerState.providerDefinitions,
    registry: agentStorage,
    appendSystemPrompt: config.appendSystemPrompt,
    onWorkspaceStateMayHaveChanged: ({ cwd }) => {
      workspaceGitService.onWorkspaceStateMayHaveChanged(cwd);
    },
    mcpAuthToken: agentMcpAuthToken,
    resolvePaseoToolPolicy: (provider) =>
      resolvePaseoToolPolicy(provider, daemonConfigStore.get().providers),
    logger,
  });
  const syncPluginProviders = () => {
    agentManager.updateProviderRegistry(
      providerSnapshotManager.replacePluginProviders(pluginRuntime.getProviderRegistrations()),
    );
  };
  const unsubscribePluginProviders =
    pluginRuntime.subscribeProviderRegistrations(syncPluginProviders);

  const detachAgentStoragePersistence = attachAgentStoragePersistence(
    logger,
    agentManager,
    agentStorage,
  );
  await agentStorage.initialize();
  logger.info({ elapsed: elapsed() }, "Agent storage initialized");
  await bootstrapWorkspaceRegistries({
    serverId,
    paseoHome: config.paseoHome,
    agentStorage,
    projectRegistry,
    workspaceRegistry,
    workspaceGitService,
    logger,
  });
  await workspaceLabelService.initialize();
  logger.info({ elapsed: elapsed() }, "Workspace registries bootstrapped");
  const teardownArchivedWorkspaceRuntime = (workspaceId: string): void => {
    scriptRuntimeStore.removeForWorkspace(workspaceId);
    releaseWorkspaceServicePortPlan(workspaceId);
  };
  const workspaceReconciliation = new WorkspaceReconciliationService({
    serverId,
    projectRegistry,
    workspaceRegistry,
    logger,
    workspaceGitService,
    onProjectUpdate: (update) => wsServer?.publishProjectUpdate(update),
    onWorkspaceArchived: teardownArchivedWorkspaceRuntime,
    onWorkspacesChanged: async (workspaceIds) => {
      await fanOutReconciledWorkspaceUpdates({
        sessions: wsServer?.listSessions() ?? [],
        workspaceIds,
        logger,
      });
    },
  });
  await workspaceReconciliation.start();
  void workspaceReconciliation.reconcileNow().catch((error) => {
    logger.warn({ err: error }, "Initial workspace reconciliation failed");
  });
  const checkoutDiffManager = new CheckoutDiffManager({
    logger,
    paseoHome: config.paseoHome,
    workspaceGitService,
  });
  const archiveWorkspaceRecordExternal = async (
    workspaceId: string,
    context?: WorkspaceArchiveContext,
  ) => {
    const existingWorkspace = await archivePersistedWorkspaceRecord({
      workspaceId,
      workspaceRegistry,
      context,
    });
    if (!existingWorkspace || existingWorkspace.archivedAt) return;
    teardownArchivedWorkspaceRuntime(workspaceId);
  };
  // external path→workspace adapter, not ownership: archive-by-path requests that
  // arrive with a worktree path and no workspaceId (old clients / CLI).
  const findWorkspaceIdForCwdExternal = async (cwd: string): Promise<string | null> => {
    return resolveWorkspaceIdForPath(cwd, await workspaceRegistry.list());
  };
  const ensureWorkspaceForCreateExternal = async (
    cwd: string,
    firstAgentContext?: FirstAgentContext,
  ): Promise<string> => {
    const workspace = await workspaceProvisioning.createWorkspaceForDirectory(
      cwd,
      resolveFirstAgentPromptTitle(firstAgentContext),
    );
    if (firstAgentContext) {
      workspaceAutoName.scheduleForDirectory({
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        firstAgentContext,
      });
    }
    return workspace.workspaceId;
  };
  const listActiveWorkspacesExternal = async (): Promise<ActiveWorkspaceRef[]> => {
    const workspaces = await workspaceRegistry.list();
    return workspaces
      .filter((workspace) => !workspace.archivedAt)
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        kind: workspace.kind,
        worktreeRoot: workspace.worktreeRoot,
        isPaseoOwnedWorktree: workspace.isPaseoOwnedWorktree,
        mainRepoRoot: workspace.mainRepoRoot,
      }));
  };
  const markWorkspaceArchivingExternal = (workspaceIds: Iterable<string>, archivingAt: string) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listSessions() ?? []) {
      session.markWorkspaceArchivingForExternalMutation(workspaceIdList, archivingAt);
    }
  };
  const clearWorkspaceArchivingExternal = (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listSessions() ?? []) {
      session.clearWorkspaceArchivingForExternalMutation(workspaceIdList);
    }
  };
  const emitWorkspaceUpdatesExternal = async (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    await Promise.all(
      (wsServer?.listSessions() ?? []).map((session) =>
        session.emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIdList),
      ),
    );
  };
  const ensureWorkspaceForCreateAndBroadcastExternal = async (
    cwd: string,
    firstAgentContext?: FirstAgentContext,
  ): Promise<string> => {
    const workspaceId = await ensureWorkspaceForCreateExternal(cwd, firstAgentContext);
    await emitWorkspaceUpdatesExternal([workspaceId]);
    return workspaceId;
  };
  const emitWorkspaceUpdateForCwdExternal = async (cwd: string) => {
    const workspaceIds = workspaceIdsOnCheckout(await workspaceRegistry.list(), cwd);
    await emitWorkspaceUpdatesExternal(workspaceIds);
  };
  const emitExternalSessionMessage = (message: SessionOutboundMessage) => {
    wsServer?.broadcast(wrapSessionMessage(message));
  };
  const workspaceAutoName = new WorkspaceAutoName({
    agentManager,
    workspaceRegistry,
    workspaceGitService,
    providerSnapshotManager,
    readDaemonConfig: () => ({ metadataGeneration: daemonConfigStore.get().metadataGeneration }),
    gitMutation: createGitMutationService({
      workspaceGitService,
      logger,
    }),
    emitWorkspaceUpdateForCwd: emitWorkspaceUpdateForCwdExternal,
    emitWorkspaceUpdateForWorkspaceId: async (workspaceId) => {
      await emitWorkspaceUpdatesExternal([workspaceId]);
    },
    logger,
  });

  setupAutoArchiveOnMerge({
    paseoHome: config.paseoHome,
    paseoWorktreesBaseRoot: config.worktreesRoot,
    daemonConfigStore,
    workspaceGitService,
    github,
    agentManager,
    agentStorage,
    terminalManager,
    logger,
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    getAutoArchivedChangeRequestUrl: async (workspaceId) =>
      (await workspaceRegistry.get(workspaceId))?.autoArchivedChangeRequestUrl ?? null,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
  });

  const createPaseoWorktreeForTools = async (
    input: Parameters<typeof createPaseoWorktreeWorkflow>[1],
    serviceOptions?: Parameters<typeof createPaseoWorktreeWorkflow>[2],
  ) => {
    return createPaseoWorktreeWorkflow(
      {
        paseoHome: config.paseoHome,
        worktreesRoot: config.worktreesRoot,
        createPaseoWorktree: async (workflowInput, workflowOptions) => {
          return createRegisteredPaseoWorktree(workflowInput, {
            github,
            ...(workflowOptions?.resolveDefaultBranch
              ? {
                  resolveDefaultBranch: workflowOptions.resolveDefaultBranch,
                }
              : {}),
            workspaceGitService,
            workspaceProvisioning,
          });
        },
        warmWorkspaceGitData: async (workspace) => {
          await Promise.all(
            wsServer
              ?.listSessions()
              .map((session) => session.warmWorkspaceGitDataForWorkspace(workspace)) ?? [],
          );
        },
        autoNameWorkspaceBranchForFirstAgent: (autoNameInput) =>
          workspaceAutoName.scheduleForWorktree(autoNameInput),
        emitWorkspaceUpdateForWorkspaceId: async (workspaceId) => {
          await emitWorkspaceUpdatesExternal([workspaceId]);
        },
        cacheWorkspaceSetupSnapshot: () => {},
        startWorkspaceSetup: (workspaceId, operation) =>
          workspaceSetupRuntime.start(workspaceId, operation),
        assertWorkspaceAutomationAllowed: (guardedWorkspaceId) =>
          assertWorkspaceAutomationAllowedForWorkspace(workspaceRegistry, guardedWorkspaceId),
        emit: emitExternalSessionMessage,
        sessionLogger: logger,
        terminalManager,
        serviceProxy,
        scriptRuntimeStore,
        getDaemonTcpPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
        getDaemonTcpHost: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.host : null),
        serviceProxyPublicBaseUrl,
        onScriptsChanged: null,
      },
      input,
      serviceOptions,
    );
  };

  const createAgentCommandDependencies: CreateAgentCommandDependencies = {
    agentManager,
    agentStorage,
    logger,
    paseoHome: config.paseoHome,
    worktreesRoot: config.worktreesRoot,
    terminalManager,
    providerSnapshotManager,
    createPaseoWorktree: createPaseoWorktreeForTools,
    ensureWorkspaceForCreate: ensureWorkspaceForCreateAndBroadcastExternal,
  };
  const createAgent = (input: Parameters<typeof createAgentCommand>[1]) =>
    createAgentCommand(createAgentCommandDependencies, input);
  const archiveWorkspaceByIdExternal = (workspaceId: string, requestId: string) =>
    archiveByScope(
      {
        paseoHome: config.paseoHome,
        paseoWorktreesBaseRoot: config.worktreesRoot,
        github,
        workspaceGitService,
        agentManager,
        agentStorage,
        findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
        listActiveWorkspaces: listActiveWorkspacesExternal,
        getWorkspace: (workspaceIdToGet) => workspaceRegistry.get(workspaceIdToGet),
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
        markWorkspaceArchiving: markWorkspaceArchivingExternal,
        clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
        killTerminalsForWorkspace: (workspaceIdToKill) =>
          killTerminalsForWorkspace({ terminalManager, sessionLogger: logger }, workspaceIdToKill),
        stopWorkspaceSetup: (workspaceIdToStop) => workspaceSetupRuntime.stop(workspaceIdToStop),
        assertWorkspaceAutomationAllowed: (guardedWorkspaceId) =>
          assertWorkspaceAutomationAllowedForWorkspace(workspaceRegistry, guardedWorkspaceId),
        sessionLogger: logger,
      },
      { scope: { kind: "workspace", workspaceId }, requestId },
    );
  const hubAgentLifecycle = new CreateAgentLifecycleDispatch({
    paseoHome: config.paseoHome,
    worktreesRoot: config.worktreesRoot,
    agentManager,
    agentStorage,
    github,
    workspaceGitService,
    createPaseoWorktreeWorkflow: createPaseoWorktreeForTools,
    archiveAgentForClose: (agentId) =>
      archiveAgentCommand({ agentManager, agentStorage, logger }, agentId),
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    emit: emitExternalSessionMessage,
    emitAgentRemove: async () => undefined,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    killTerminalsForWorkspace: (workspaceId) =>
      killTerminalsForWorkspace({ terminalManager, sessionLogger: logger }, workspaceId),
    logger,
  });
  const hubRelationships = new HubRelationshipController({
    paseoHome: config.paseoHome,
    hostname: getHostName(),
    serverId,
    daemonPublicKey: daemonKeyPair.publicKeyB64,
    logger,
    remote: dependencies.hubRelationshipRemote ?? new DirectHubRelationshipRemote(),
    clock: dependencies.hubRelationshipClock,
    retryPolicy: dependencies.hubRelationshipRetryPolicy,
    createDaemonId: dependencies.createHubDaemonId,
    attachSocket: async (socket, options) => {
      if (!wsServer) throw new Error("WebSocket server is not running");
      await wsServer.attachExternalSocket(
        socket,
        { transport: "hub", hubDaemonId: options.daemonId },
        {
          principalId: options.principalId,
          permissions: options.permissions,
          hubExecutionAgents: options.agents,
        },
        options.sessionProtocol === "legacy"
          ? {
              type: "hello",
              clientId: `hub:${options.daemonId}`,
              clientType: "hub",
              protocolVersion: 1,
            }
          : undefined,
      );
    },
    updateAttachedPermissions: (principalId, permissions) => {
      if (!wsServer) throw new Error("WebSocket server is not running");
      wsServer.updatePrincipalPermissions(principalId, permissions);
    },
    createExecutionAgents: (daemonId) =>
      new DaemonExecutions({
        daemonId,
        agentManager,
        agentStorage,
        createAgent,
        interruptAgent: (agentId) => cancelAgentRunCommand({ agentManager, logger }, agentId),
        archiveWorkspace: archiveWorkspaceByIdExternal,
        cleanupFailedCreate: (input) =>
          hubAgentLifecycle.cleanupCreatedWorktreeAfterFailedAgentCreate(input),
      }),
  });

  const createScheduleLocalWorkspaceExternal = async (input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
  }) => {
    const workspace = await workspaceProvisioning.createWorkspaceForDirectory(
      input.cwd,
      resolveFirstAgentPromptTitle(input.firstAgentContext),
    );
    workspaceAutoName.scheduleForDirectory({
      workspaceId: workspace.workspaceId,
      cwd: workspace.cwd,
      firstAgentContext: input.firstAgentContext,
    });
    await emitWorkspaceUpdatesExternal([workspace.workspaceId]);
    return workspace;
  };
  const createSchedulePaseoWorktreeExternal = async (input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
  }) => {
    const result = await createPaseoWorktreeForTools({
      cwd: input.cwd,
      firstAgentContext: input.firstAgentContext,
    });
    await emitWorkspaceUpdatesExternal([result.workspace.workspaceId]);
    return result;
  };
  const archiveScheduleWorkspaceExternal = async (workspaceId: string) => {
    await archiveByScope(
      {
        paseoHome: config.paseoHome,
        paseoWorktreesBaseRoot: config.worktreesRoot,
        github,
        workspaceGitService,
        agentManager,
        agentStorage,
        findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
        listActiveWorkspaces: listActiveWorkspacesExternal,
        getWorkspace: (workspaceIdToGet) => workspaceRegistry.get(workspaceIdToGet),
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
        markWorkspaceArchiving: markWorkspaceArchivingExternal,
        clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
        killTerminalsForWorkspace: (workspaceIdToKill) =>
          killTerminalsForWorkspace(
            {
              terminalManager,
              sessionLogger: logger,
            },
            workspaceIdToKill,
          ),
        stopWorkspaceSetup: (workspaceIdToStop) => workspaceSetupRuntime.stop(workspaceIdToStop),
        assertWorkspaceAutomationAllowed: (guardedWorkspaceId) =>
          assertWorkspaceAutomationAllowedForWorkspace(workspaceRegistry, guardedWorkspaceId),
        sessionLogger: logger,
      },
      {
        scope: { kind: "workspace", workspaceId },
        requestId: "schedule-run-finish",
      },
    );
  };
  const scheduleService = new ScheduleService({
    paseoHome: config.paseoHome,
    logger,
    agentManager,
    agentStorage,
    createAgent,
    createDirectoryWorkspace: createScheduleLocalWorkspaceExternal,
    createPaseoWorktreeWorkspace: createSchedulePaseoWorktreeExternal,
    archiveWorkspace: archiveScheduleWorkspaceExternal,
  });
  await scheduleService.start();
  agentManager.setAgentArchivedCallback(async (agentId) => {
    try {
      await scheduleService.completeForAgent(agentId);
    } catch (error) {
      logger.warn({ err: error, agentId }, "Failed to complete schedules for archived agent");
    }
  });
  logger.info({ elapsed: elapsed() }, "Schedule service initialized");
  logger.info({ elapsed: elapsed() }, "Loading persisted agent registry");
  const persistedRecords = await agentStorage.list();
  logger.info(
    { elapsed: elapsed() },
    `Agent registry loaded (${persistedRecords.length} record${persistedRecords.length === 1 ? "" : "s"}); agents will initialize on demand`,
  );
  logger.info(
    "Voice mode configured for agent-scoped resume flow (no dedicated voice assistant provider)",
  );
  logger.info({ elapsed: elapsed() }, "Preparing voice and MCP runtime");

  const createAgentToolHostDependencies = (
    runtime: PaseoToolRuntimeContext,
  ): PaseoToolHostDependencies => ({
    agentManager,
    agentStorage,
    terminalManager,
    getDaemonTcpPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
    scheduleService,
    providerSnapshotManager,
    daemonConfigStore,
    github,
    workspaceGitService,
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
    workspaceRegistry,
    projectRegistry,
    createDirectoryWorkspace: async (cwd, title, projectId) => {
      const workspace = await workspaceProvisioning.createWorkspaceForDirectory(
        cwd,
        title,
        projectId,
      );
      await emitWorkspaceUpdatesExternal([workspace.workspaceId]);
      return workspace;
    },
    workspaceScripts: createWorkspaceScriptsService({
      serviceProxy,
      scriptRuntimeStore,
      terminalManager,
      workspaceRegistry,
      projectRegistry,
      workspaceGitService,
      getDaemonTcpPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
      getDaemonTcpHost: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.host : null),
      serviceProxyPublicBaseUrl,
      resolveScriptHealth: (hostname) => scriptHealthMonitor.getHealthForHostname(hostname),
      logger,
      emit: (message) => wsServer?.broadcast(wrapSessionMessage(message)),
      publishStatusUpdate: (message) => wsServer?.publishScriptStatusUpdate(message),
      spawnWorkspaceScript,
      assertAutomationAllowed: (workspaceId) =>
        assertWorkspaceAutomationAllowedForWorkspace(workspaceRegistry, workspaceId),
      globalServicePorts: loadPersistedConfig(config.paseoHome).worktrees?.servicePorts,
    }),
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    ensureWorkspaceForCreate: createAgentCommandDependencies.ensureWorkspaceForCreate,
    createPaseoWorktree: createAgentCommandDependencies.createPaseoWorktree,
    browserToolsEnabled: browserToolsPolicy.isEnabled(),
    browserToolsBroker,
    paseoToolPolicy:
      runtime.paseoToolPolicy ??
      (runtime.callerAgentId ? agentManager.getPaseoToolPolicy(runtime.callerAgentId) : undefined),
    paseoHome: config.paseoHome,
    worktreesRoot: config.worktreesRoot,
    callerAgentId: runtime.callerAgentId,
    enableVoiceTools: runtime.enableVoiceTools,
    voiceOnly: runtime.voiceOnly,
    resolveSpeakHandler: (agentId) => wsServer?.resolveVoiceSpeakHandler(agentId) ?? null,
    resolveCallerContext: (agentId) => wsServer?.resolveVoiceCallerContext(agentId) ?? null,
    logger,
  });
  const createAgentToolCatalog = (runtime: PaseoToolRuntimeContext) =>
    createPaseoToolCatalog(createAgentToolHostDependencies(runtime));
  const setAgentProviderToolsEnabled = (enabled: boolean) => {
    agentProviderRuntime.setPaseoToolCatalog(enabled ? createAgentToolCatalog({}) : null);
  };
  agentManager.setPaseoToolCatalogFactory(createAgentToolCatalog);
  agentManager.setPaseoToolsEnabled(config.mcpInjectIntoAgents !== false);
  setAgentProviderToolsEnabled(config.mcpEnabled !== false && config.mcpInjectIntoAgents !== false);

  let mcpEnabled = config.mcpEnabled ?? true;
  let agentMcpBaseUrl: string | null = null;
  {
    const agentMcpRoute = "/mcp/agents";

    const createAgentMcpSession = async (callerAgentId?: string) => {
      const agentMcpServer = await createAgentMcpServer(
        createAgentToolHostDependencies({
          callerAgentId,
          paseoToolPolicy: callerAgentId
            ? agentManager.getPaseoToolPolicy(callerAgentId)
            : undefined,
        }),
      );

      // Stateless mode: each HTTP request builds a fresh server + transport that is
      // torn down when the response closes, so no per-session state is retained between
      // requests. The agent control plane only lists and calls tools, neither of which
      // needs cross-request state, so sessions would only pin memory for the life of the
      // daemon (agents that exit without a clean DELETE never get reaped).
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        // NOTE: We enforce a Vite-like host allowlist at the app/websocket layer.
        // StreamableHTTPServerTransport's built-in check requires exact Host header matches.
        enableDnsRebindingProtection: false,
      });
      Object.assign(transport, {
        onerror: (err: Error) => {
          logger.error({ err }, "Agent MCP transport error");
        },
      });

      await agentMcpServer.connect(transport);
      return { server: agentMcpServer, transport };
    };

    const runAgentMcpRequest = async (
      req: express.Request,
      res: express.Response,
    ): Promise<void> => {
      if (!mcpEnabled) {
        res.status(404).json({ error: "Agent MCP endpoint disabled" });
        return;
      }
      // This route is exempt from the global daemon-password middleware, so it
      // authenticates here using the injected capability token (or a valid
      // daemon password). Without this, a password-protected daemon would be
      // wide open on its agent control plane.
      if (
        !(await isAgentMcpRequestAuthorized({
          password: config.auth?.password,
          capabilityToken: agentMcpAuthToken,
          authorizationHeader: req.header("authorization"),
        }))
      ) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (config.mcpDebug) {
        logger.debug(
          {
            method: req.method,
            url: req.originalUrl,
            sessionId: req.header("mcp-session-id"),
            authorization: req.header("authorization") ? MCP_DEBUG_SECRET : undefined,
            body: describeMcpDebugPayload(req.body),
          },
          "Agent MCP request",
        );
      }
      try {
        // Stateless: GET (standalone SSE) and DELETE (session termination) have no
        // meaning without sessions. The MCP client tolerates 405 on the GET stream
        // and never issues a DELETE because it is never handed a session id.
        if (req.method !== "POST") {
          res.status(405).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Method not allowed",
            },
            id: null,
          });
          return;
        }
        const callerAgentIdRaw = req.query.callerAgentId;
        let callerAgentId: string | undefined;
        if (typeof callerAgentIdRaw === "string") {
          callerAgentId = callerAgentIdRaw;
        } else if (Array.isArray(callerAgentIdRaw) && typeof callerAgentIdRaw[0] === "string") {
          callerAgentId = callerAgentIdRaw[0];
        }
        const { server, transport } = await createAgentMcpSession(callerAgentId);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });

        await transport.handleRequest(
          req as unknown as IncomingMessage,
          res as unknown as ServerResponse,
          req.body,
        );
      } catch (err) {
        logger.error({ err }, "Failed to handle Agent MCP request");
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal MCP server error",
            },
            id: null,
          });
        }
      }
    };

    const handleAgentMcpRequest: express.RequestHandler = (req, res) => {
      void runAgentMcpRequest(req, res);
    };

    app.post(agentMcpRoute, handleAgentMcpRequest);
    app.get(agentMcpRoute, handleAgentMcpRequest);
    app.delete(agentMcpRoute, handleAgentMcpRequest);
    logger.info({ route: agentMcpRoute, enabled: mcpEnabled }, "Agent MCP route mounted");
  }

  const speechService = createSpeechService({
    logger,
    openaiConfig: config.openai,
    speechConfig: config.speech,
  });
  logger.info({ elapsed: elapsed() }, "Speech service created");

  logger.info({ elapsed: elapsed() }, "Bootstrap complete, ready to start listening");

  const start = async () => {
    let mainStarted = false;
    try {
      localCredential = await writeLocalCredential(config.paseoHome);
      if (serviceProxyListenTarget) {
        const boundServiceProxyTarget = await serviceProxy.startStandalone({
          listenTarget: serviceProxyListenTarget,
        });
        serviceProxyListenTarget = boundServiceProxyTarget;
        logger.info(
          {
            listen: formatListenTarget(serviceProxyListenTarget),
            publicBaseUrl: serviceProxyPublicBaseUrl,
            elapsed: elapsed(),
          },
          "Service proxy listening",
        );
      }

      // Start main HTTP server
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          httpServer.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          mainStarted = true;
          const logAndResolve = async () => {
            boundListenTarget = resolveBoundListenTarget(listenTarget, httpServer);
            const mcpBaseUrl = createAgentMcpBaseUrl(boundListenTarget);
            agentMcpBaseUrl =
              !mcpEnabled || config.mcpInjectIntoAgents === false ? null : mcpBaseUrl;
            agentManager.setMcpBaseUrl(agentMcpBaseUrl);
            agentManager.setPaseoToolsEnabled(mcpEnabled && config.mcpInjectIntoAgents !== false);
            daemonConfigStore.onFieldChange("mcp.enabled", (value) => {
              mcpEnabled = value !== false;
              const inject = daemonConfigStore.get().mcp.injectIntoAgents !== false;
              agentManager.setMcpBaseUrl(mcpEnabled && inject ? mcpBaseUrl : null);
              agentManager.setPaseoToolsEnabled(mcpEnabled && inject);
              setAgentProviderToolsEnabled(mcpEnabled && inject);
            });
            daemonConfigStore.onFieldChange("mcp.injectIntoAgents", (value) => {
              agentManager.setMcpBaseUrl(mcpEnabled && value ? mcpBaseUrl : null);
              agentManager.setPaseoToolsEnabled(mcpEnabled && value !== false);
              setAgentProviderToolsEnabled(mcpEnabled && value !== false);
            });
            daemonConfigStore.onFieldChange("appendSystemPrompt", (value) => {
              agentManager.setAppendSystemPrompt(typeof value === "string" ? value : "");
            });
            const relayEnabled = config.relayEnabled ?? true;
            const relayEndpoint =
              config.relayEndpoint ?? process.env.ZENCODE_RELAY_ENDPOINT ?? "relay.zencode.sh:443";
            const relayPublicEndpoint = config.relayPublicEndpoint ?? relayEndpoint;
            const relayUseTls =
              config.relayUseTls ??
              (relayEndpoint.endsWith(":443") || relayEndpoint === "relay.paseo.sh:443");
            const relayPublicUseTls = config.relayPublicUseTls ?? relayUseTls;
            if (boundListenTarget.type === "tcp") {
              logger.info(
                {
                  host: boundListenTarget.host,
                  port: boundListenTarget.port,
                  authRequired: !!config.auth?.password,
                  elapsed: elapsed(),
                },
                `Server listening on http://${boundListenTarget.host}:${boundListenTarget.port}`,
              );
            } else {
              logger.info(
                {
                  path: boundListenTarget.path,
                  authRequired: !!config.auth?.password,
                  elapsed: elapsed(),
                },
                `Server listening on ${boundListenTarget.path}`,
              );
            }
            if (config.auth?.password) {
              logger.info("Daemon password authentication enabled");
            }

            wsServer = new VoiceAssistantWebSocketServer(
              httpServer,
              logger,
              serverId,
              agentManager,
              agentStorage,
              downloadTokenStore,
              config.paseoHome,
              daemonConfigStore,
              mcpBaseUrl,
              {
                getAllowedOrigins: () => allowedOrigins,
                getHostnames: () => configuredHostnames,
                daemonStatusRpc: dependencies.serverFeatureOverrides?.daemonStatusRpc,
                relayConfig: dependencies.serverFeatureOverrides?.relayConfig,
                startPaused: true,
              },
              workspaceAutoName,
              daemonAuth,
              speechService,
              terminalManager,
              {
                finalTimeoutMs: config.dictationFinalTimeoutMs,
              },
              daemonVersion,
              (intent) => {
                try {
                  config.onLifecycleIntent?.(intent);
                } catch (error) {
                  logger.error({ err: error, intent }, "Failed to handle daemon lifecycle intent");
                }
              },
              projectRegistry,
              workspaceRegistry,
              scheduleService,
              checkoutDiffManager,
              serviceProxy,
              scriptRuntimeStore,
              handleBranchChange,
              () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
              () => (boundListenTarget?.type === "tcp" ? boundListenTarget.host : null),
              (hostname) => scriptHealthMonitor.getHealthForHostname(hostname),
              workspaceGitService,
              github,
              config.pushNotificationSender,
              providerSnapshotManager,
              {
                listen: formatListenTarget(boundListenTarget ?? listenTarget),
                worktreesRoot: config.worktreesRoot,
                get appBaseUrl() {
                  return appBaseUrl;
                },
                desktopManaged: config.desktopManaged === true,
                getRelayConfig: () =>
                  relayRuntime?.getConfig() ?? {
                    enabled: daemonConfigStore.get().relay?.enabled ?? relayEnabled,
                    endpoint: relayEndpoint,
                    publicEndpoint: relayPublicEndpoint,
                    useTls: relayUseTls,
                    publicUseTls: relayPublicUseTls,
                  },
              },
              serviceProxyPublicBaseUrl,
              browserToolsBroker,
              hubRelationships,
              workspaceSetupRuntime,
              pluginRuntime,
              orchestrationSkills,
              workspaceLabelService,
            );
            pluginRuntime.bindPaseoSessionHost(wsServer);
            await pluginRuntime.start();
            providerSnapshotManager.settlePluginProviders();
            wsServer.beginAcceptingConnections();
            relayRuntime = createRelayRuntime({
              config: {
                enabled: relayEnabled,
                endpoint: relayEndpoint,
                publicEndpoint: relayPublicEndpoint,
                useTls: relayUseTls,
                publicUseTls: relayPublicUseTls,
              },
              logger,
              attachSocket: async (ws, metadata) => {
                if (!wsServer) throw new Error("WebSocket server is not ready");
                await wsServer.attachExternalSocket(ws, metadata);
              },
              serverId,
              daemonKeyPair: daemonKeyPair.keyPair,
            });
            daemonConfigStore.onFieldChange("relay.enabled", (value) => {
              relayRuntime?.setEnabled(value === true);
            });
            await hubRelationships.start();
          };

          logAndResolve().then(resolve, reject);
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);

        if (listenTarget.type === "tcp") {
          httpServer.listen(listenTarget.port, listenTarget.host);
        } else {
          if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
            unlinkSync(listenTarget.path);
          }
          httpServer.listen(listenTarget.path);
        }
      });

      // Start speech service after listening so synchronous Sherpa native
      // model loading doesn't block the server from accepting connections.
      speechService.start();
      scriptHealthMonitor.start();
      await fleetRegistry.initialize();
    } catch (error) {
      localCredential = null;
      await deleteLocalCredential(config.paseoHome);
      unsubscribePluginProviders();
      await pluginRuntime.stopAllPlugins().catch(() => undefined);
      await serviceProxy.stopStandalone().catch(() => undefined);
      await agentProviderRuntime.shutdown().catch(() => undefined);
      await swarm.shutdownSwarm();
      if (mainStarted) {
        httpServer.closeAllConnections();
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
      throw error;
    }
  };

  const stop = async () => {
    localCredential = null;
    await deleteLocalCredential(config.paseoHome);
    // Stop tracking plugin provider registrations before anything tears plugins
    // down, so plugin shutdown cannot withdraw a provider from under an agent
    // that is still open. Plugins themselves are stopped once every session
    // they serve has been closed, further down.
    unsubscribePluginProviders();
    await hubRelationships.stop();
    workspaceReconciliation.dispose();
    scriptHealthMonitor.stop();
    await swarm.shutdownSwarm();
    // Freeze both ingress and registration before taking the agent closure snapshot.
    wsServer?.prepareForShutdown();
    agentManager.prepareForShutdown();
    await closeAllAgents(logger, agentManager);
    await withTimeout({
      promise: pluginRuntime.drainEvents(),
      timeoutMs: AGENT_CLOSE_TIMEOUT_MS,
      label: "drain plugin lifecycle events",
    }).catch((error) => logger.warn({ err: error }, "Plugin lifecycle events did not finish"));
    await agentManager.flushForShutdown().catch(() => undefined);
    detachAgentStoragePersistence();
    await agentStorage.flush().catch(() => undefined);
    await agentProviderRuntime.shutdown();
    await pluginRuntime.stopAllPlugins();
    terminalManager.killAll();
    await speechService.stop();
    await scheduleService.stop().catch(() => undefined);
    await relayRuntime?.stop().catch(() => undefined);
    if (wsServer) {
      await wsServer.close();
    }
    await serviceProxy.stopStandalone();
    // Force-drop remaining sockets so httpServer.close() resolves promptly.
    // We've already closed wsServer (which sent ws-layer close frames) and
    // stopped every other service, so anything still attached is a TCP
    // socket whose higher-level shutdown hasn't fully released it (e.g.
    // upgraded WS sockets in the closing handshake, or HTTP keep-alive
    // sockets in CLOSE_WAIT). closeIdleConnections() does not catch
    // upgraded sockets, so we use closeAllConnections() here.
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    // Clean up socket files
    if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
      unlinkSync(listenTarget.path);
    }
  };

  return {
    config,
    agentManager,
    agentStorage,
    terminalManager,
    serviceProxy,
    scriptRuntimeStore,
    browserToolsBroker,
    fleetRegistry,
    nineRouter,
    egressManager,
    clefCouncil,
    goalEngine,
    start,
    stop,
    getListenTarget: () => boundListenTarget,
    getServerId: () => serverId,
  };
}

/**
 * Closing an agent asks its provider to close the session and waits for the
 * answer. A provider that never answers must not hold the daemon open, so a
 * close that outlives this deadline is abandoned; `agentProviderRuntime`
 * shutdown runs next and rejects the request that was still pending.
 */
const AGENT_CLOSE_TIMEOUT_MS = 5_000;

async function closeAllAgents(logger: Logger, agentManager: AgentManager): Promise<void> {
  const agents = agentManager.listAgents();
  await Promise.all(
    agents.map(async (agent) => {
      try {
        await withTimeout({
          promise: agentManager.closeAgent(agent.id),
          timeoutMs: AGENT_CLOSE_TIMEOUT_MS,
          label: `close agent ${agent.id}`,
        });
      } catch (err) {
        logger.error({ err, agentId: agent.id }, "Failed to close agent");
      }
    }),
  );
}
