# Thread Lifecycle

## Core Idea

A thread is a sequence of messages processed by an agent. It is append-only, serialized by a lock, and owned by exactly one agent. Each run starts with an input message — from a user, a scheduler, another agent, or an API call — and the agent processes it through tool calls and internal messages until it produces a result. Not every thread is a human conversation. Task threads, trigger threads, and ask-agent threads are all threads with non-human origins. The structure is the same regardless of who or what provides the input.

The thread is the agent's cognitive boundary. The agent knows only what is in its thread — the system prompt and the conversation history that accumulates within it. Everything outside the thread (other threads, other agents, system state) does not exist from the agent's perspective.

Tool use is the mechanism by which new information enters the thread. When an agent calls a tool, the result is appended to the thread as internal messages — tool call and tool response become part of the conversation history. This is how an agent "learns" anything beyond what it was told in the system prompt: episodic memory search results, task state, file contents, other agents' responses — all arrive as tool results appended to the thread.

This makes capabilities architecturally significant. Adding or removing a capability doesn't just enable or disable a feature — it expands or narrows what information the agent can pull into its thread. The thread is the totality of what the agent knows; tools are the only way to grow it during execution.

Threads are cheap to create, never migrated between agents, and carry minimal metadata. Their storage format (JSONL) makes them trivially parseable and appendable. A thread's history is an implementation detail of Core — no layer above Core reads thread files directly.

## Thread Structure

A thread is a single JSONL file. The first line is the manifest (metadata). All subsequent lines are events.

```
{agentDir}/threads/{threadId}.jsonl

Line 1:  ThreadManifest  (metadata)
Line 2+: ThreadEvent[]   (messages, tool use, results)
```

### ThreadManifest

```
ThreadManifest {
  agentId: string         // owning agent
  sessionId?: string      // Claude SDK session for conversation continuity
  taskId?: string         // bound task (thread becomes task's dedicated thread)
  title?: string          // auto-generated after 2+ user messages
  createdAt: string       // ISO timestamp
  updatedAt: string       // ISO timestamp, updated after every run
}
```

The manifest is mutable — it is the only part of a thread that gets rewritten. All other lines are append-only.

The manifest does not carry a `channel` field. Core does not know or care which delivery channel originated a thread. Delivery routing is the caller's concern — channels and schedulers track their own thread associations externally.

### ThreadEvent

Every line after the manifest is a `ThreadEvent`. Events are always appended, never modified.

```
ThreadEvent =
  | ThreadMessageEvent     // user or assistant message
  | ThreadToolUseEvent     // tool invocation during execution
  | ThreadAssistantTextEvent  // narration text accompanying tool use
  | ThreadResultEvent      // execution metrics (cost, tokens, duration)
```

```
ThreadMessageEvent {
  type: "message"
  role: "user" | "assistant"
  text: string
  timestamp: string
}

ThreadToolUseEvent {
  type: "tool_use"
  name: string
  input: Record<string, unknown>
  timestamp: string
}

ThreadAssistantTextEvent {
  type: "assistant_text"
  text: string
  timestamp: string
}

ThreadResultEvent {
  type: "result"
  cost?: number
  durationMs?: number
  turns?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  timestamp: string
}
```

Legacy format: older threads may contain messages without a `type` field (bare `{role, text, timestamp}` objects). Readers treat lines without a `type` field as `ThreadMessageEvent`. Older threads may also contain a `channel` field in the manifest — readers ignore it.

## Thread Creation

```
createThread(agentDir, options?) → threadId
```

- Generates a random 12-character hex ID.
- Writes a JSONL file containing only the manifest line.
- Returns the thread ID.

`createThread()` is the single entry point. Every thread in the system — regardless of origin — is created through this function.

### Creation Triggers

Threads are created by channels and schedulers, never by Core itself:

| Caller | Context |
|--------|---------|
| Telegram channel | `/new` command, first message auto-creation |
| Task creation (HTTPS) | Dedicated task thread, `taskId` set |
| Trigger scheduler | Scheduled cron execution |
| Ask-agent | Inter-agent delegation |

Core provides `createThread()` but does not decide *when* threads are created. That decision belongs to channels and schedulers.

## Thread Locking

Only one execution can run against a thread at a time.

```
withThreadLock(threadId, fn) → Promise<T>
```

Implementation: per-thread promise chain. Concurrent calls to the same thread queue behind the current execution. Different threads run in parallel.

The lock wraps the entire AgentRunner execution — from user message append through engine run to post-run effects dispatch. The lock is released after the synchronous work completes but before fire-and-forget effects finish.

## Message Flow (Single Run)

A single `runAgent()` call follows this sequence:

```
1. Acquire thread lock
2. Load manifest
3. Append user message
4. Build system prompt (with task context if bound)
5. Resolve capabilities → MCP servers
6. Run engine
   ├─ Stream events → append to thread (tool_use, assistant_text, result)
   └─ Callbacks → caller delivery (thinking, tool status)
7. Append assistant message
8. Update manifest (sessionId, updatedAt)
9. Emit onResponse callback
10. Dispatch post-run effects (fire-and-forget)
11. Release thread lock
```

### Error Handling

- *Abort (user-initiated stop):* Appends `(stopped by user)` as assistant message, updates manifest, returns empty. No error callback.
- *Engine error:* Appends `(error: {message})` as assistant message, emits `onError` callback, re-throws. Manifest is NOT updated with a new sessionId on error.

### Event Streaming

During engine execution, events are written to the thread file in real-time via the `onEvent` callback. This means the thread file grows during execution, not just at the end. Events are timestamped at write time.

## Session Continuity

Threads maintain conversation context across runs through the Claude SDK's session mechanism.

- `manifest.sessionId` is passed to `engine.run()` on each invocation.
- Engine passes it to the SDK as a `resume` parameter.
- The SDK returns a new `sessionId` in its response.
- AgentRunner writes the new `sessionId` back to the manifest.
- If session resume fails, Engine automatically retries as a new conversation (transparent to AgentRunner).

The session is an SDK-side optimization for conversation continuity. The thread file remains the durable record — sessions can be lost without data loss.

## Post-Run Effects

Three fire-and-forget operations run after the response is delivered. None block the response callback. All are independent — failure in one does not affect the others.

### Usage Tracking

Appends a usage record to the workspace-level `usage.jsonl`:

```
UsageRecord {
  timestamp, agentId, threadId,
  inputTokens, outputTokens, cacheReadTokens,
  costUsd, durationMs, turns
}
```

Condition: always (when usage metrics are present in engine result).

### Embedding Generation

Generates vector embeddings for the last user message and assistant response, appending to `{agentDir}/embeddings.jsonl`. Powers episodic memory search.

Condition: embedding model is available (`nova init` has been run).

### Title Generation

Generates a 3-6 word thread title using a fast model (Haiku).

Condition: thread has no title yet AND has 2+ user messages (skips initial greetings).

Mutates the manifest — this is the only post-run effect that writes back to the thread file. Because it's fire-and-forget, there is a race window: if another run starts before title generation completes, the title write could conflict with the next manifest save. In practice, this is harmless — worst case, the title is overwritten by the next run's manifest save and retried on the following run.

## Manifest Mutation

The manifest is the only mutable part of a thread. It can be mutated by:

| Mutator | Fields | When |
|---------|--------|------|
| AgentRunner (synchronous) | `sessionId`, `updatedAt` | After every successful run |
| AgentRunner (fire-and-forget) | `title` | After 2+ user messages, if no title |

All mutations go through `saveManifest()`, which rewrites line 1 of the JSONL file while preserving all event lines.

## Active Thread Selection

The concept of an "active thread" — which thread receives the next user message — lives entirely in channels. Core has no concept of active threads.

Each channel maintains its own active thread tracking:
- Telegram stores `activeThreadId` in its config.
- Agent bots store `activeThreadId` in their bot config.
- Tasks have dedicated threads bound by `taskId`.
- Triggers create a new thread per execution.
- Ask-agent always creates a new thread.

Core exposes query functions for channel UX:
- `listThreads(agentDir)` → thread summaries
- `getThreadManifest(agentId, threadId)` → single thread metadata
- `findThread(workspaceDir, threadId)` → cross-agent thread lookup

## Thread Deletion

```
deleteThread(agentDir, threadId)
```

Deletes the JSONL file. No cascade — embeddings, usage records, and task bindings are not cleaned up. Thread deletion is rare (manual cleanup only).

## Constraints

- Threads are append-only (except manifest line 1).
- One execution per thread at a time (promise-based lock).
- Thread storage internals (JSONL format, file paths) are never exposed outside Core.
- Active thread selection is a channel concern, not Core's.
- Post-run effects are fire-and-forget — they never block the response.
- All thread creation goes through `createThread()` — no direct file writes.
- Threads belong to exactly one agent. No thread sharing, no thread migration between agents.
- Core does not track or route by delivery channel. Threads are channel-agnostic.

## What Lives Here

- Thread creation, deletion, listing
- JSONL storage (manifest + events)
- Per-thread execution locking
- Message and event append operations
- Manifest load/save with validation
- Post-run effect dispatch (usage, embeddings, title)

## What Does NOT Live Here

- Active thread selection (caller concern)
- Delivery routing (caller concern)
- System prompt assembly (separate spec)
- Capability resolution (separate spec)
- Engine execution (engine contract)
- Task binding logic (task system creates threads with taskId, thread just carries it)
