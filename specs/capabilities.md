# Capability Resolution

## Core Idea

A capability is something that resolves to an MCP server and is togglable per agent. Each agent's `capabilities` array is the complete, explicit list of what MCP servers it gets. The capability registry is the single source of truth for what capabilities exist and how they resolve.

```
Agent capabilities → resolve each → MCP servers for engine
```

AgentRunner contains zero MCP wiring knowledge. It asks the registry to resolve the agent's capabilities and passes the result to the engine.

Trust (sandbox/controlled/unrestricted) is orthogonal — it governs SDK-native tools, not capabilities. A capability listed in agent config always works regardless of trust level.

## Resolution

Resolution is a flat lookup. For each entry in `agent.capabilities`, the registry returns an MCP server config. Unknown capabilities are an error (logged and skipped).

```
resolveCapabilities(
  capabilities: string[],
  context: ResolverContext,
): Record<string, McpServerConfig>
```

## Registry

Every capability maps to a *resolver* — a function that returns an MCP server config. This handles both external (stdio process) and internal (SDK factory) capabilities uniformly.

```
type CapabilityResolver = (context: ResolverContext) => McpServerConfig

interface ResolverContext {
  agentDir: string
  agentId: string
  threadId: string
  agent: AgentConfig
  workspaceDir: string
  directories: string[]
  manifest: ThreadManifest
  callbacks: AgentRunnerCallbacks
  runAgent: RunAgentFn         // for ask-agent recursion
  askAgentDepth: number
}
```

Not every resolver uses every field. But all resolvers receive the same context — no special signatures per capability.

### Registry Table

| Capability | Resolver |
|------------|----------|
| memory | `createMemoryMcpServer()` |
| history | `createHistoryMcpServer(agentDir, agentId, threadId)` — search past conversation threads |
| tasks | `createTasksMcpServer(agentId, workspaceDir)` |
| notes | `createNotesMcpServer(agentDir, callbacks)` |
| self | `createSelfManagementMcpServer(agentDir, workspaceDir, agentId)` — instructions + skill management |
| media | `createMediaMcpServer(agentDir, directories, callbacks)` — file send, transcription, future TTS |
| secrets | `createSecretsMcpServer(workspaceDir)` |
| triggers | `createTriggerMcpServer(agentDir, channel)` |
| agents | `createAgentsMcpServer(depth, runAgent)` — inter-agent communication, can reach any agent |
| agent-management | `createAgentManagementMcpServer()` |
| browser | external stdio: `npx @playwright/mcp@latest` |

## Run-time Injections

Not all MCP servers are capabilities. Some are wired by AgentRunner based on execution context, never listed in agent config, and not togglable.

| Injection | When | Resolver |
|-----------|------|----------|
| notify-user | `silent: true` (background/task runs) | `createNotifyUserMcpServer(callbacks)` |

Run-time injections are added after capability resolution. They use the same registry infrastructure but are not part of the agent's `capabilities` array.

## AgentRunner Integration

```
// Pseudocode — the target shape, not the implementation

const servers = resolveCapabilities(agent.capabilities, context)
const injections = resolveInjections(mode, context)

const result = await engine.run(message, {
  systemPrompt,
  mcpServers: { ...servers, ...injections },
  ...overrides
}, trust, sessionId, callbacks, abortController)
```

The post-run side effects (usage tracking, embedding, title generation) are a separate concern — not part of capability resolution.

## Constraints

- Every capability is explicitly listed in `agent.capabilities`. No implicit inclusion.
- Capabilities are orthogonal to trust. Trust governs SDK-native tools, capabilities govern MCP servers.
- Run-time injections are never in agent config — they're derived from execution context.
- The registry is the only place that knows how to create MCP servers. No MCP construction elsewhere.
