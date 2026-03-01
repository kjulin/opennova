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
export interface ResolvedCapabilities {
  mcpServers: Record<string, McpServerConfig>;
  engineConfig: {
    allowedTools: string[];
    disallowedTools: string[];
  };
}

/** A function that creates an MCP server config for a capability */
export type CapabilityResolver = (
  ctx: ResolverContext,
  config: CapabilityConfig,
) => McpServerConfig | null;

/** A function that returns engine config (allowedTools/disallowedTools) for a capability */
export type EngineConfigResolver = (
  ctx: ResolverContext,
  config: CapabilityConfig,
) => { allowedTools?: string[]; disallowedTools?: string[] } | null;

interface RegisteredCapability {
  resolver: CapabilityResolver;
  tools: ToolDescriptor[];
}

interface RegisteredEngineConfig {
  resolver: EngineConfigResolver;
  tools: ToolDescriptor[];
}

export class CapabilityRegistry {
  private capabilities = new Map<string, RegisteredCapability>();
  private engineConfigs = new Map<string, RegisteredEngineConfig>();

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
   * Register an engine-config capability (e.g. bash) that maps to SDK allowedTools/disallowedTools.
   */
  registerEngineConfig(
    key: string,
    resolver: EngineConfigResolver,
    tools: ToolDescriptor[],
  ): void {
    this.engineConfigs.set(key, { resolver, tools });
  }

  /**
   * Resolve capabilities from an agent's config into MCP server configs and engine config.
   */
  resolve(
    capabilities: CapabilitiesRecord | undefined,
    ctx: ResolverContext,
  ): ResolvedCapabilities {
    const result: ResolvedCapabilities = {
      mcpServers: {},
      engineConfig: { allowedTools: [], disallowedTools: [] },
    };

    if (!capabilities || Object.keys(capabilities).length === 0) return result;

    for (const [key, config] of Object.entries(capabilities)) {
      const registered = this.capabilities.get(key);
      const registeredEngine = this.engineConfigs.get(key);

      if (!registered && !registeredEngine) {
        throw new Error(
          `Unknown capability: "${key}". Available: ${[...this.capabilities.keys(), ...this.engineConfigs.keys()].join(", ")}`,
        );
      }

      if (registered) {
        const server = registered.resolver(ctx, config);
        if (server) {
          result.mcpServers[key] = server;
        }
      }

      if (registeredEngine) {
        const engineCfg = registeredEngine.resolver(ctx, config);
        if (engineCfg) {
          if (engineCfg.allowedTools) {
            result.engineConfig.allowedTools.push(...engineCfg.allowedTools);
          }
          if (engineCfg.disallowedTools) {
            result.engineConfig.disallowedTools.push(...engineCfg.disallowedTools);
          }
        }
      }
    }
    return result;
  }

  /**
   * Return descriptors for all registered capabilities.
   */
  knownCapabilities(): CapabilityDescriptor[] {
    const mcpCaps = [...this.capabilities.entries()].map(([key, cap]) => ({
      key,
      tools: cap.tools,
    }));
    const engineCaps = [...this.engineConfigs.entries()].map(([key, cap]) => ({
      key,
      tools: cap.tools,
    }));
    return [...mcpCaps, ...engineCaps];
  }

  /**
   * Return all registered capability keys.
   */
  knownKeys(): string[] {
    return [...this.capabilities.keys(), ...this.engineConfigs.keys()];
  }
}
