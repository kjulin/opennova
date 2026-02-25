# Agent Runner

## Core Idea

The AgentRunner orchestrates a single agent turn: message in, response out. It is the seam where all Core contracts converge — agent config, thread storage, system prompt assembly, capability resolution, and the engine. Its job is assembly and sequencing, not policy.

The AgentRunner owns no domain logic. It does not know how system prompts are structured, how capabilities resolve to MCP servers, or how the engine talks to the SDK. It receives an agent ID and thread ID, gathers what it needs from adjacent modules, hands everything to the engine, and records the result.

```
Caller (channel, scheduler, ask-agent)
     │
     ▼
AgentRunner.runAgent(agentId, threadId, message, ...)
     │
     ├─ loads agent config (agents)
     ├─ loads thread manifest (threads)
     ├─ appends user message (threads)
     ├─ builds system prompt (prompt builder)
     ├─ resolves capabilities → MCP servers (capability registry)
     ├─ resolves run-time injections (capability registry)
     ├─ calls engine.run() (engine)
     ├─ records result (threads, usage)
     └─ dispatches post-run effects (embeddings, title)
```

The AgentRunner is the only caller of `engine.run()`. Nothing else in the system executes AI turns.

## Interface

```
AgentRunner {
  runAgent(
    agentId: string,
    threadId: string,
    message: string,
    callbacks?: AgentRunnerCallbacks,
    overrides?: RunAgentOverrides,
    abortController?: AbortController,
  ): Promise<{ text: string }>
}
```

### RunAgentOverrides

```
RunAgentOverrides {
  model?: Model         // override agent's default model
  maxTurns?: number     // limit agentic turns
  background?: boolean  // running in background (trigger/task scheduler)
}
```

Overrides are caller-supplied execution context, not agent config. They do not change what the agent *is* — they change how this particular run executes.

`background` replaces `silent`. The naming signals intent: the agent is running without a live user session, not that it should be quiet.


### AgentRunnerCallbacks

```
AgentRunnerCallbacks {
  // Engine passthrough
  onThinking?: () => void
  onAssistantMessage?: (text: string) => void
  onToolUse?: (toolName: string, input: Record<string, unknown>, summary: string) => void
  onToolUseSummary?: (summary: string) => void
  onEvent?: (event: EngineEvent) => void

  // AgentRunner-level
  onResponse?: (agentId: string, threadId: string, text: string) => void
  onError?: (agentId: string, threadId: string, error: string) => void

  // Capability callbacks (forwarded through ResolverContext)
  onFileSend?: (agentId: string, threadId: string, filePath: string, caption?: string, fileType: FileType) => void
  onShareNote?: (agentId: string, threadId: string, title: string, slug: string, message?: string) => void
  onPinChange?: (agentId: string) => void
  onNotifyUser?: (agentId: string, threadId: string, message: string) => void
}
```

Callbacks are the AgentRunner's upward interface — how it communicates with the caller without knowing who that caller is.

Engine callbacks (`onThinking`, `onAssistantMessage`, etc.) pass through the runner transparently. The runner adds `onEvent` interception to persist events to the thread file.

Capability callbacks (`onFileSend`, `onShareNote`, `onPinChange`, `onNotifyUser`) originate from MCP server implementations during engine execution. The runner receives them through capability resolution context and enriches them with `agentId` and `threadId` before forwarding to the caller.

No callback carries a `channel` parameter. The runner does not know what delivery channel the caller represents. The caller already knows — it closes over its own delivery infrastructure when constructing the callbacks.

## Execution Sequence

```
1. Acquire thread lock
2. Load agent config
3. Load thread manifest
4. Append user message to thread
5. Build system prompt
   └─ builder(agent, cwd, directories, { task?, background? })
6. Resolve capabilities → MCP servers
   └─ resolveCapabilities(agent.capabilities, context)
7. Resolve run-time injections
   └─ resolveInjections(overrides, context)
8. Call engine.run(message, options, trust, sessionId, callbacks, abort)
   ├─ events streamed → thread file
   └─ callbacks forwarded → caller
9. Append assistant message to thread
10. Update manifest (sessionId, updatedAt)
11. Record usage
12. Emit onResponse callback
13. Dispatch post-run effects (fire-and-forget)
    ├─ Embedding generation
    └─ Title generation
14. Release thread lock
```

### Step 5: Prompt Assembly

The runner calls the prompt builder with all resolved inputs. The builder returns a complete system prompt. The runner does not append, modify, or inspect the prompt after the builder returns.

```
const systemPrompt = buildSystemPrompt(agent, cwd, directories, {
  task: taskId ? getTask(workspaceDir, taskId) : undefined,
  background: overrides?.background,
})
```

Task loading (step 5) is the runner's responsibility — it reads the `taskId` from the manifest and loads the task. The builder receives the loaded task object, not a task ID.

### Step 6-7: MCP Assembly

Capability resolution and run-time injections produce the complete set of MCP servers. The runner merges them and passes the result to the engine.

```
const capabilityServers = resolveCapabilities(agent.capabilities, context)
const injectionServers = resolveInjections(overrides, context)
const mcpServers = { ...capabilityServers, ...injectionServers }
```

The runner does not construct MCP server configs. It does not know what "memory" or "notes" resolve to. It calls the registry and forwards the result.

### Step 8: Engine Call

The runner assembles `EngineOptions` from the outputs of steps 5-7 and calls `engine.run()`. This is a pure delegation — the runner does not interpret the engine result beyond extracting `text`, `sessionId`, and `usage`.

```
engine.run(message, {
  cwd,
  directories,
  systemPrompt,
  model: overrides?.model ?? agent.model,
  maxTurns: overrides?.maxTurns,
  agents: agent.subagents,
  mcpServers,
}, agent.trust, manifest.sessionId, engineCallbacks, abortController)
```

### Steps 9-13: Post-Run

The runner records the result and dispatches effects. This is bookkeeping, not orchestration. See the Thread Lifecycle spec for post-run effect details (usage tracking, embedding generation, title generation).

## Error Handling

Two error cases:

### User Abort

When `abortController.signal` is aborted:
- Append `(stopped by user)` as assistant message
- Update manifest `updatedAt`
- Return `{ text: "" }`
- No error callback

### Engine Error

When `engine.run()` throws:
- Append `(error: {message})` as assistant message
- Emit `onError` callback
- Re-throw the error
- Manifest `sessionId` is NOT updated (preserves last good session)

## Ask-Agent Recursion

When an agent delegates to another agent via the `agents` capability, it triggers a recursive `runAgent` call. The runner creates a closure that maintains the callback chain and passes it through the resolver context:

```
const runAgentForAskAgent = (targetAgentId, targetThreadId, targetMessage, depth) =>
  runAgent(targetAgentId, targetThreadId, targetMessage, callbacks, { background: overrides?.background }, abortController)
```

The `askAgentDepth` parameter (tracked in resolver context) prevents infinite recursion — the `agents` capability resolver enforces a depth limit.

## What the Runner Owns

- *Sequencing* — the order of operations from message receipt to response delivery.
- *Thread I/O* — appending messages, updating manifest, acquiring locks. (Delegates to thread module.)
- *Assembly* — gathering outputs from prompt builder, capability resolver, and injections into a single engine call.
- *Callback routing* — intercepting engine events for persistence, enriching capability callbacks with context, forwarding to caller.
- *Post-run dispatch* — triggering fire-and-forget effects after the response.

## What the Runner Does NOT Own

- *Prompt content* — the builder decides what goes in the system prompt.
- *MCP wiring* — the capability registry decides how capabilities resolve.
- *Trust enforcement* — the engine translates trust into SDK permissions.
- *Thread selection* — the caller decides which thread to use.
- *Delivery* — the caller decides how responses reach the user.

## The Delegation Principle

The runner's value is that it touches everything but knows nothing. It is the thinnest possible orchestration layer. If the runner contains domain logic — prompt string manipulation, MCP server construction, trust interpretation, delivery routing — the architecture has a boundary violation.

Test: the runner should be deletable and regenerable from the interfaces of its dependencies (prompt builder, capability resolver, engine, thread storage). If regeneration requires knowledge not captured in those interfaces, the adjacent specs are incomplete.

## Caller Wiring

Each caller of `runAgent` provides its own callbacks. The runner does not wrap, intercept, or default them (beyond event persistence via `onEvent`).

### Interactive (Telegram channel)

The channel constructs callbacks that deliver to the active Telegram chat. Engine callbacks (`onThinking`, `onToolUse`) drive typing indicators and status messages. `onResponse` sends the final message. `onFileSend`, `onShareNote`, `onNotifyUser` deliver through the same bot instance.

### Background (triggers, task scheduler)

The daemon constructs callbacks via a delivery factory (see Scheduling spec). `onResponse` and `onError` are suppressed (no live session). `onNotifyUser` always delivers — that's its purpose. `onFileSend` and `onShareNote` deliver through the resolved bot for that agent.

### Ask-Agent

Callbacks are forwarded from the parent run. The child run's `onResponse` is captured by the parent, not delivered to the user.

## Constraints

- The AgentRunner is the sole caller of `engine.run()`. No other module executes AI turns.
- The builder returns a complete system prompt. The runner never appends to it.
- All MCP servers come from capability resolution or run-time injections. The runner does not construct MCP configs.
- Callbacks are the only upward communication. The runner never imports from Daemon or Channels.
- No callback carries a `channel` parameter. Delivery routing is the caller's concern.
- Thread lock wraps the entire execution — from message append through post-run effect dispatch.
- Post-run effects are fire-and-forget. They never block the response callback.

## What Lives Here

- `runAgent()` orchestration sequence
- RunAgentOverrides shape
- AgentRunnerCallbacks shape
- Callback routing (engine events → thread persistence, capability callbacks → caller)
- Ask-agent recursion setup
- Error handling (abort, engine failure)

## What Does NOT Live Here

- System prompt assembly (System Prompt spec)
- Capability resolution (Capabilities spec)
- Engine execution (Engine Contract spec)
- Thread storage internals (Thread Lifecycle spec)
- Post-run effect implementation (Thread Lifecycle spec)
- Active thread selection (caller concern)
- Delivery infrastructure (Scheduling spec, channel implementations)
- Event bus (eliminated — callbacks replace bus-mediated routing)
