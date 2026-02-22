# Engine Contract

## Core Idea

The Engine is the lowest layer in OpenNova. It executes a single AI conversation turn. It is stateless and knows nothing about agents, threads, or capabilities. It receives a message, options, and a trust level — and returns a result.

The Engine is the SDK boundary. It is the only code that touches the underlying AI SDK (currently Claude Agent SDK). Nothing else in the system imports from or calls the SDK directly. A different SDK can be supported by implementing a new Engine.

## Interface

```
Engine {
  run(
    message: string,
    options: EngineOptions,
    trust: TrustLevel,
    sessionId?: string,
    callbacks?: EngineCallbacks,
    abortController?: AbortController,
  ): Promise<EngineResult>
}
```

```
TrustLevel = "sandbox" | "controlled" | "unrestricted"
```

## EngineOptions

```
EngineOptions {
  // Execution context
  cwd?: string                    // working directory
  directories?: string[]          // additional accessible directories

  // Prompt
  systemPrompt?: string
  model?: Model                   // "sonnet" | "opus" | "haiku"
  maxTurns?: number

  // Tools
  mcpServers?: Record<string, McpServerConfig>   // resolved MCP servers
  agents?: Record<string, SubagentConfig>         // Claude SDK subagents
}
```

EngineOptions contains no SDK-specific permission fields. The Engine translates `trust` into whatever its underlying SDK requires.

## Trust Level

Trust controls what SDK-native tools the Engine makes available. It is the Engine's responsibility to enforce this.

| Trust Level | SDK-native tools | Rationale |
|-------------|-----------------|-----------|
| sandbox | None (no files, no web, no bash) | Untrusted input protection — prevents prompt injection via web, filesystem access |
| controlled | Files (Read, Write, Edit, Glob, Grep) + Web (WebSearch, WebFetch) | Standard working agent — can read/write files and access the web |
| unrestricted | Everything including Bash | Full system access — trusted automation |

Each level strictly adds to the previous. MCP servers (capabilities) work at every trust level — trust only governs SDK-native tools.

How trust maps to SDK parameters is an implementation detail of each Engine. For the Claude Agent SDK engine:

- `sandbox` → `permissionMode: "dontAsk"`, `allowedTools` restricted to MCP patterns only
- `controlled` → `permissionMode: "dontAsk"`, `disallowedTools: ["Bash"]`
- `unrestricted` → `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true`

## EngineResult

```
EngineResult {
  text: string                    // final assistant response text
  sessionId?: string              // session ID for future resume
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    costUsd: number
    durationMs: number
    turns: number
  }
}
```

## EngineCallbacks

Callbacks provide real-time visibility into execution. All are optional.

```
EngineCallbacks {
  onThinking?: () => void
  onAssistantMessage?: (text: string) => void
  onToolUse?: (toolName: string, input: Record<string, unknown>, summary: string) => void
  onToolUseSummary?: (summary: string) => void
  onEvent?: (event: EngineEvent) => void
}
```

### EngineEvent

Structured events emitted during execution:

```
EngineEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "result"; cost?: number; durationMs?: number; turns?: number;
      inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }
```

### Callback Semantics

- `onThinking` — Fired at run start and after tool results (with delay). Signals "waiting for model."
- `onAssistantMessage` — Text blocks that accompany tool use (narration). Pure text-only responses are NOT fired here — they appear only in the final result.
- `onToolUse` — Each tool invocation, with a human-friendly summary string.
- `onToolUseSummary` — SDK-provided tool execution summaries.
- `onEvent` — All structured events. Callers that need to record execution history subscribe here.

## Session Management

Sessions enable conversation continuity across multiple `run()` calls.

- If `sessionId` is provided, Engine passes it to the SDK as a `resume` parameter.
- The SDK returns a `session_id` in its response, captured in `EngineResult.sessionId`.
- The caller (AgentRunner) persists the sessionId between runs.

### Fallback

If session resume fails (SDK error), Engine automatically retries as a new conversation (no sessionId). This is transparent to the caller — they receive a result either way, with a new sessionId.

## Boundary Rules

- Engine never imports from Core, Daemon, or Channels.
- Engine never interprets agent config, capabilities, or thread state.
- Engine *does* interpret trust — it translates trust into SDK-native tool constraints.
- All SDK interaction is contained within Engine — no other layer imports the AI SDK.
- Engine is stateless — no state survives between `run()` calls.
- The `Engine` interface is the sole contract. Callers depend on the interface, not the implementation.

## What Lives Here

- AI SDK query execution
- Trust → SDK permission mapping
- Event stream processing (assistant text, tool use, results)
- Callback dispatch with human-friendly tool status messages
- Session resume with automatic fallback

## What Does NOT Live Here

- Agent config, thread state, capability resolution
- MCP server construction
- System prompt assembly
- Post-run side effects (usage tracking, embeddings, title generation)
