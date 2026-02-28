# CapabilityRegistry

## Core Idea

A capability is a named, configurable unit that resolves to tools — today almost always an MCP server, but the abstraction doesn't guarantee that. Each agent declares its capabilities as an object where keys are capability names and values are capability-specific configuration. The CapabilityRegistry is the single source of truth for what capabilities exist and how they resolve.

```
Agent capabilities object → CapabilityRegistry.resolve() → tools for engine
```

AgentRunner contains zero MCP wiring knowledge. It asks CapabilityRegistry to resolve the agent's capabilities and passes the result to the engine.

There is no separate trust/security layer. An agent's capabilities object *is* its permission model — it defines exactly which tools the agent can access. If a capability isn't listed, the agent doesn't have it. If `tools` is specified, only those tools are available. No allowedTools, no sandbox/controlled/unrestricted distinction.

## Agent Config Format

Capabilities are declared as an object. Each key is a capability name registered in CapabilityRegistry. The value is capability-specific config (can be empty `{}`).

```json
{
  "capabilities": {
    "memory": {},
    "history": {},
    "tasks": {},
    "audio": { "tools": ["transcribe"] },
    "files": { "dirs": ["/data/reports"], "tools": ["read_file"] }
  }
}
```

### Tools Filter

Any capability entry can include a `tools` array to restrict which tools from that capability are exposed to the agent. When omitted, all tools are available.

```json
"audio": { "tools": ["transcribe"] }
```

This means the audio capability is resolved, but only the `transcribe` tool is available — other tools are filtered out. This is an allowlist — no disallowedTools, no wildcards.

### Capability-Specific Config

Beyond `tools`, each capability can define its own config schema. The resolver declares what config it accepts. `tools` is reserved by the registry and stripped before the config is passed to the resolver.

```json
"files": { "dirs": ["/data/reports"], "tools": ["read_file"] }
```

The resolver receives `{ "dirs": ["/data/reports"] }`. The registry handles `tools` filtering separately.

## CapabilityRegistry

### CapabilityResolver

Each resolver registers with a key and implements resolution:

```typescript
interface ToolDescriptor {
  key: string          // tool name as exposed by the MCP server (e.g. "transcribe")
  name: string         // human-readable name (e.g. "Transcribe Audio")
  description: string  // what the tool does
}

interface CapabilityResolver {
  key: string
  tools: ToolDescriptor[]
  configSchema?: Record<string, unknown>  // JSON Schema for capability-specific config (excludes `tools`)
  resolve(ctx: ResolverContext, config: ResolvedConfig): ResolvedCapability | null
}

// What the resolver receives after the registry processes the agent config
interface ResolvedConfig {
  tools: string[]                      // validated tool allowlist (or all tool keys if agent omitted `tools`)
  [key: string]: unknown               // capability-specific config
}

interface ResolvedCapability {
  mcpServer: McpServerConfig
}
```

Each resolver declares its `tools` list — the complete set of tools this capability can provide. This serves two purposes:

1. **Validation** — when an agent config includes `tools: ["transcribe"]`, the registry validates those names against the resolver's declared tools. Unknown tool names are an error.
2. **Discovery** — the registry can enumerate all tools across all capabilities for UIs, agent builders, and documentation without starting any MCP servers.

The registry resolves the `tools` field before passing config to the resolver: it validates the allowlist against declared tools, then passes the resolved list (defaulting to all tool keys when omitted). The resolver receives `tools` as a resolved array and is responsible for only exposing those tools — e.g., by passing the list to its MCP server factory so disallowed tools are never registered.

A resolver can return `null` to skip (e.g., a capability that requires a runtime dependency not available in the current execution context).

### ResolverContext

All resolvers receive the same context. Not every resolver uses every field.

```typescript
interface ResolverContext {
  agentDir: string
  workspaceDir: string
  thread: ThreadManifest
  callbacks: AgentRunnerCallbacks
  agent: AgentConfig
}
```

### Registry API

```typescript
interface CapabilityDescriptor {
  key: string
  tools: ToolDescriptor[]
  configSchema?: Record<string, unknown>  // JSON Schema for capability-specific config (excludes `tools`)
}

class CapabilityRegistry {
  register(resolver: CapabilityResolver): void
  resolve(
    capabilities: Record<string, CapabilityConfig>,
    ctx: ResolverContext,
  ): ResolvedCapabilities

  knownCapabilities(): CapabilityDescriptor[]
}

interface CapabilityConfig {
  tools?: string[]
  [key: string]: unknown
}

interface ResolvedCapabilities {
  mcpServers: Record<string, McpServerConfig>
}
```

`resolve()` iterates the agent's capabilities object. For each key, it finds the registered resolver, validates the `tools` allowlist against the resolver's declared tools (defaulting to all if omitted), passes the resolved config to the resolver, and collects the results. Unknown capabilities are an error.

Since resolvers enforce tool filtering themselves, the MCP servers in `ResolvedCapabilities` only expose allowed tools.

## Run-time Injections

Not all MCP servers are capabilities. Some are wired by AgentRunner based on execution context, never listed in agent config, and not togglable.

Run-time injections are added after capability resolution. They use the same infrastructure but are not part of the agent's capabilities object and are not registered in CapabilityRegistry.

## AgentRunner Integration

```
const registry = CapabilityRegistry.instance()
const { mcpServers } = registry.resolve(agent.capabilities, context)
const injections = resolveInjections(mode, context)

const result = await engine.run(message, {
  systemPrompt,
  mcpServers: { ...mcpServers, ...injections },
  ...overrides
}, sessionId, callbacks, abortController)
```

Tool filtering is already enforced — resolvers only expose allowed tools in the MCP servers they return.

## Constraints

- Every capability is explicitly listed in `agent.capabilities`. No implicit inclusion.
- Capabilities *are* the security model. No separate trust layer.
- No capability resolver receives a channel parameter. Core is channel-agnostic.
- `tools` is a reserved key in capability config — always handled by the registry, never passed to resolvers.
- Registering a new CapabilityResolver automatically makes that capability available for agent configuration. No other code changes needed.
