import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig } from "../agents/index.js";
import type { ThreadManifest } from "../threads/index.js";
import type { FileType } from "../file-send.js";
import type { RunAgentFn } from "../agents/ask-agent.js";

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

/** Per-capability config from agent.json */
export interface CapabilityConfig {
  tools?: string[] | undefined;
  [key: string]: unknown;
}

/** Map of capability name → config in agent.json */
export type CapabilitiesRecord = Record<string, CapabilityConfig>;

/** Describes a tool provided by a capability */
export interface ToolDescriptor {
  name: string;
  description: string;
}

/** Describes a registered capability */
export interface CapabilityDescriptor {
  key: string;
  tools: ToolDescriptor[];
}

/** Resolved config for a single capability (MCP server + metadata) */
export interface ResolvedCapability {
  server: McpServerConfig;
  tools: ToolDescriptor[];
}

/** All resolved capabilities */
export type ResolvedCapabilities = Record<string, McpServerConfig>;

/** A function that creates an MCP server config for a capability */
export type CapabilityResolver = (
  ctx: ResolverContext,
  config: CapabilityConfig,
) => McpServerConfig | null;

interface RegisteredCapability {
  resolver: CapabilityResolver;
  tools: ToolDescriptor[];
}

export class CapabilityRegistry {
  private capabilities = new Map<string, RegisteredCapability>();

  /**
   * Register a capability with its resolver and tool metadata.
   */
  register(
    key: string,
    resolver: CapabilityResolver,
    tools: ToolDescriptor[],
  ): void {
    this.capabilities.set(key, { resolver, tools });
  }

  /**
   * Resolve capabilities from an agent's config into MCP server configs.
   * Returns a map of capability name → McpServerConfig.
   */
  resolve(
    capabilities: CapabilitiesRecord | undefined,
    ctx: ResolverContext,
  ): ResolvedCapabilities {
    if (!capabilities || Object.keys(capabilities).length === 0) return {};

    const servers: ResolvedCapabilities = {};
    for (const [key, config] of Object.entries(capabilities)) {
      const registered = this.capabilities.get(key);
      if (!registered) {
        throw new Error(
          `Unknown capability: "${key}". Available: ${[...this.capabilities.keys()].join(", ")}`,
        );
      }

      const server = registered.resolver(ctx, config);
      if (server) {
        servers[key] = server;
      }
    }
    return servers;
  }

  /**
   * Return descriptors for all registered capabilities.
   */
  knownCapabilities(): CapabilityDescriptor[] {
    return [...this.capabilities.entries()].map(([key, cap]) => ({
      key,
      tools: cap.tools,
    }));
  }

  /**
   * Return all registered capability keys.
   */
  knownKeys(): string[] {
    return [...this.capabilities.keys()];
  }
}
