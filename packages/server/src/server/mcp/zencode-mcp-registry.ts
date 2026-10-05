import { getZencodeOAuthManager } from "../auth/zencode-oauth-manager.js";

export interface WorkspaceMcpServerDef {
  id: string;
  name: string;
  provider: string;
  description: string;
  command: string;
  args: string[];
  requiredEnvKeys: string[];
  packageUrl: string;
  capabilities: string[];
}

export interface WorkspaceMcpStatusItem {
  id: string;
  name: string;
  provider: string;
  description: string;
  isConfigured: boolean;
  status: "ready" | "needs_credentials";
  command: string;
  args: string[];
  capabilities: string[];
  source?: string;
  account?: string;
}

export const WORKSPACE_MCP_SERVERS: WorkspaceMcpServerDef[] = [
  {
    id: "figma",
    name: "Figma Design-to-Code MCP",
    provider: "figma",
    description:
      "Inspect Figma frame hierarchy, extract design tokens (colors, typography) and auto-layout code",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-figma"],
    requiredEnvKeys: ["FIGMA_ACCESS_TOKEN"],
    packageUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-figma",
    capabilities: ["get_file", "get_file_nodes", "get_image", "get_comments", "post_comment"],
  },
  {
    id: "gdrive",
    name: "Google Drive & Docs MCP",
    provider: "gdrive",
    description:
      "Search Google Drive, read Docs specifications, parse Sheets data, and export documents as context",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    requiredEnvKeys: ["GOOGLE_DRIVE_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS"],
    packageUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-gdrive",
    capabilities: ["search_files", "read_file_content", "list_folder", "create_doc"],
  },
  {
    id: "canva",
    name: "Canva Creative Asset MCP",
    provider: "canva",
    description:
      "Generate creative assets, search templates, and export high-res visual assets via Canva Connect API",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-canva"],
    requiredEnvKeys: ["CANVA_API_KEY"],
    packageUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-canva",
    capabilities: ["search_templates", "create_design", "export_asset", "get_brand_kit"],
  },
  {
    id: "notion",
    name: "Notion Knowledge & Kanban MCP",
    provider: "notion",
    description:
      "Query Notion knowledge base, retrieve product requirements, and update project tracking databases",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-notion"],
    requiredEnvKeys: ["NOTION_API_KEY"],
    packageUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-notion",
    capabilities: ["search", "query_database", "retrieve_page", "create_page", "update_block"],
  },
  {
    id: "linear",
    name: "Linear Issue Tracking MCP",
    provider: "linear",
    description:
      "Query sprints, triage assigned tickets, create bug reports, and sync status with git branches",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-linear"],
    requiredEnvKeys: ["LINEAR_API_KEY"],
    packageUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-linear",
    capabilities: ["list_issues", "get_issue", "create_issue", "update_issue", "list_projects"],
  },
];

export class ZencodeMcpRegistry {
  private readonly oauthManager = getZencodeOAuthManager();

  public async getMcpStatus(): Promise<WorkspaceMcpStatusItem[]> {
    const authStatus = await this.oauthManager.getStatus();

    return WORKSPACE_MCP_SERVERS.map((server) => {
      const providerAuth = authStatus[server.provider];
      const hasEnv = server.requiredEnvKeys.some((k) => !!process.env[k]);
      const isConfigured = providerAuth?.status === "authenticated" || hasEnv;

      return {
        id: server.id,
        name: server.name,
        provider: server.provider,
        description: server.description,
        isConfigured,
        status: isConfigured ? "ready" : "needs_credentials",
        command: server.command,
        args: server.args,
        capabilities: server.capabilities,
        source: providerAuth?.source || (hasEnv ? "process.env" : undefined),
        account: providerAuth?.account,
      };
    });
  }

  public getExecutableConfig(serverId: string): {
    command: string;
    args: string[];
    env: Record<string, string>;
  } | null {
    const server = WORKSPACE_MCP_SERVERS.find((s) => s.id === serverId);
    if (!server) return null;

    const token = this.oauthManager.getRawCredential(server.provider);
    const env: Record<string, string> = { ...process.env } as Record<string, string>;

    if (token) {
      for (const envKey of server.requiredEnvKeys) {
        if (!env[envKey]) {
          env[envKey] = token;
        }
      }
    }

    return {
      command: server.command,
      args: server.args,
      env,
    };
  }
}

let mcpRegistryInstance: ZencodeMcpRegistry | null = null;

export function getZencodeMcpRegistry(): ZencodeMcpRegistry {
  if (!mcpRegistryInstance) {
    mcpRegistryInstance = new ZencodeMcpRegistry();
  }
  return mcpRegistryInstance;
}
