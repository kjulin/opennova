import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig } from "./agents/index.js";
import type { ThreadManifest } from "./threads.js";
import type { FileType } from "./media/mcp.js";
import type { RunAgentFn } from "./agents/ask-agent.js";
import { createNotifyUserMcpServer } from "./notify-user.js";
import { createMemoryMcpServer } from "./memory.js";
import { createHistoryMcpServer } from "./episodic/index.js";
import { createTasksMcpServer } from "#tasks/index.js";
import { createNotesMcpServer } from "#notes/index.js";
import { createSelfManagementMcpServer, createAgentManagementMcpServer } from "./agents/management.js";
import { createMediaMcpServer } from "./media/mcp.js";
import { createSecretsMcpServer } from "./secrets.js";
import { createAgentsMcpServer } from "./agents/ask-agent.js";
import { createTriggerMcpServer } from "./triggers.js";

export interface ResolverContext {
  agentId: string;
  agentDir: string;
  workspaceDir: string;
  threadId: string;
  directories: string[];
  manifest: ThreadManifest;
  callbacks: {
    onFileSend?: (filePath: string, caption: string | undefined, fileType: FileType) => void;
    onShareNote?: (title: string, slug: string, message: string | undefined) => void;
    onPinChange?: () => void;
    onNotifyUser?: (message: string) => void;
  };
  agent: AgentConfig;
  askAgentDepth?: number;
  runAgentFn?: RunAgentFn;
}

type CapabilityResolver = (ctx: ResolverContext) => McpServerConfig | null;

const CAPABILITY_REGISTRY: Record<string, CapabilityResolver> = {
  memory: () => createMemoryMcpServer(),
  history: (ctx) => createHistoryMcpServer(ctx.agentDir, ctx.agentId, ctx.threadId),
  tasks: (ctx) => createTasksMcpServer(ctx.agentId, ctx.workspaceDir),
  notes: (ctx) => createNotesMcpServer(ctx.agentDir, ctx.callbacks.onShareNote, ctx.callbacks.onPinChange),
  self: (ctx) => createSelfManagementMcpServer(ctx.agentId),
  media: (ctx) => createMediaMcpServer(ctx.agentDir, ctx.directories, ctx.callbacks.onFileSend ?? (() => {})),
  secrets: (ctx) => createSecretsMcpServer(ctx.workspaceDir),
  agents: (ctx) => {
    if (!ctx.runAgentFn) return null;
    return createAgentsMcpServer(ctx.agent, ctx.askAgentDepth ?? 0, ctx.runAgentFn);
  },
  "agent-management": () => createAgentManagementMcpServer(),
  triggers: (ctx) => createTriggerMcpServer(ctx.agentDir),
  browser: () => ({
    type: "stdio" as const,
    command: "npx",
    args: ["@playwright/mcp@latest"],
  }),
};

export const KNOWN_CAPABILITIES = Object.keys(CAPABILITY_REGISTRY);

/**
 * Return `mcp__<name>__*` wildcard patterns for each declared capability.
 * Used to add capability tools to the security allowedTools list.
 */
export function capabilityToolPatterns(
  capabilities: string[] | undefined,
): string[] {
  if (!capabilities || capabilities.length === 0) return [];
  return capabilities.map((cap) => `mcp__${cap}__*`);
}

export function resolveCapabilities(
  capabilities: string[] | undefined,
  ctx: ResolverContext,
): Record<string, McpServerConfig> {
  if (!capabilities || capabilities.length === 0) return {};

  const servers: Record<string, McpServerConfig> = {};
  for (const cap of capabilities) {
    const resolver = CAPABILITY_REGISTRY[cap];
    if (!resolver) {
      throw new Error(`Unknown capability: "${cap}". Available: ${KNOWN_CAPABILITIES.join(", ")}`);
    }
    const config = resolver(ctx);
    if (config) {
      servers[cap] = config;
    }
  }
  return servers;
}

export function resolveInjections(
  ctx: ResolverContext,
  options?: { background?: boolean | undefined },
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};

  if (options?.background) {
    servers["notify-user"] = createNotifyUserMcpServer((message) => {
      ctx.callbacks.onNotifyUser?.(message);
    });
  }

  return servers;
}
