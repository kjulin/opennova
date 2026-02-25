# OpenNova System Spec

## What OpenNova Is

OpenNova is a personal AI agent daemon. It runs persistently on the user's machine, manages a team of AI agents, and connects them to the user through messaging channels. Each agent has an identity, instructions, responsibilities, capabilities, skills, and access boundaries. The system is designed for a single user operating multiple specialized agents.

## Pace Layers

From slowest-changing to fastest:

| Layer | Changes | Examples |
|-------|---------|----------|
| Purpose | Rarely | "Personal AI agent daemon for one user" |
| Architecture | Per major version | Layer boundaries, data model, security model |
| Boundaries | Per feature | New capability type, new channel type |
| Policy | Per configuration | Security levels, capability grants, agent identity |
| Implementation | Anytime | How a capability is wired, how triggers fire |

Specs live at the Architecture and Boundaries layers. Everything below is disposable.

## System Layers

OpenNova has four layers. Each has a clear role and a contract with adjacent layers.

```
┌─────────────────────────────────────┐
│             Channels                │  Telegram, HTTPS/API, CLI
│        (user-facing edges)          │
├─────────────────────────────────────┤
│              Daemon                 │  Lifecycle, scheduling, delivery wiring
│         (orchestration)             │
├─────────────────────────────────────┤
│              Core                   │  Agents, threads, capabilities,
│       (domain + policy)             │  prompts, security, storage
├─────────────────────────────────────┤
│             Engine                  │  Claude Agent SDK wrapper
│          (execution)                │
└─────────────────────────────────────┘
```

### Engine

*Role:* Execute a single AI conversation turn. Stateless. Knows nothing about agents, threads, or OpenNova concepts.

*Contract:* Takes a message, options (model, system prompt, MCP servers, security settings), and returns a result (text, session ID, usage metrics).

*Boundary:* The Engine interface (`Engine.run()`) is the only point of contact. Core never calls the Claude SDK directly. Engine never reaches up into Core.

*What lives here:*
- Claude Agent SDK query execution
- Event stream processing (assistant text, tool use, results)
- Callback dispatch (thinking, tool status, events)
- Session resume with fallback
- Thread title generation (utility, stateless)

*What does NOT live here:*
- Thread state, agent config, capability resolution

### Core

*Role:* All domain logic. Defines what an agent is, what a thread is, what capabilities exist, how prompts are built. Core is the layer where OpenNova's concepts live.

*Contract with Engine:* Core assembles a fully resolved `EngineOptions` (system prompt, MCP servers) and the agent's trust level, then hands both to `Engine.run()`. Engine is a black box.

*Contract with Daemon:* Core exposes the `AgentRunner` — the entry point for running a message through an agent. Daemon calls `runAgent(agentId, threadId, message, callbacks, overrides)` and receives callbacks for responses, errors, file sends, etc. Core does not know what delivery channel the caller represents — callbacks are opaque functions provided by the caller.

Core also exposes thread management functions:
- `createThread(agentDir)` → threadId
- `listThreads(agentDir)` → thread summaries (id, title, updatedAt, taskId)
- `getThreadManifest(agentId, threadId)` → thread metadata

Thread storage internals (file paths, JSONL format, locking) are never exposed outside Core.

*What lives here:*
- Agent model (config, identity, instructions, responsibilities, directories, trust, capabilities)
- Thread model (manifest, messages, events, locking)
- Capability resolution (registry, resolvers)
- System prompt assembly
- MCP server factories (memory, episodic, tasks, notes, etc.)
- Post-run side effects (usage tracking, embeddings, title generation)
- Shared data stores (memories, secrets, usage records)

*Subsystems within Core:*
- `episodic/` — Embedding-based conversation memory (search, storage, backfill)
- `prompts/` — System prompt assembly from agent config + context
- `transcription/` — Local speech-to-text via Whisper

*What does NOT live here:*
- Channel-specific logic, daemon lifecycle, scheduling, delivery routing

### Daemon

*Role:* Orchestration. Starts the system, manages channels, runs schedulers, wires delivery callbacks. The daemon is the process that stays alive.

*Contract with Core:* Calls `runAgent()` with caller-provided callbacks. Uses thread management functions (`createThread`, `listThreads`, `getThreadManifest`) for UX needs. Never constructs thread file paths or accesses thread storage directly.

*Contract with Channels:* The daemon starts channels and provides them with the `runAgent` function and thread management functions. Channels call `runAgent` directly with their own callbacks — there is no intermediary bus.

*What lives here:*
- Process lifecycle (start, signal handling, graceful shutdown)
- Delivery wiring (construction-time callback injection for schedulers)
- Channel loading and management
- Trigger scheduler (cron evaluation, thread creation, fire-and-forget runs)
- Task scheduler (task invocation)
- Episodic backfill scheduler
- CLI command dispatch
- HTTPS server (API routes, static file serving)
- Authentication detection

*What does NOT live here:*
- Domain logic, agent definitions, capability resolution, prompt building

### Channels

*Role:* User-facing communication edges. Each channel knows how to receive messages from a user and deliver responses back.

*Current channels:*
- Telegram (global bot + per-agent bots)
- HTTPS/API (task management, agent management, notes, console)
- CLI (nova commands for configuration and management)

*Contract:* Channels are adapters. They translate between their protocol (Telegram Bot API, HTTP, CLI args) and Core's `runAgent` interface. Each channel constructs its own callbacks for delivery — it does not subscribe to a shared event bus.

## Domain Model

### Agent

The central concept. An agent is a configured AI personality with bounded access.

```
Agent {
  id: string              // unique, lowercase-hyphenated
  name: string            // display name
  identity: string        // who: expertise, personality, methodology
  instructions: string    // how: files, rhythm, constraints
  responsibilities: Responsibility[]  // what: specific duties with lifecycle
  directories: string[]   // filesystem access boundaries
  capabilities: string[]  // explicit list of MCP servers this agent gets
  trust: TrustLevel       // sandbox | controlled | unrestricted
  model: Model            // default model override
  subagents: Record<string, SubagentConfig>  // Claude SDK subagents
}

Responsibility {
  title: string           // short label, unique within agent
  content: string         // instruction text for this duty
}
```

All agents are equal. Agents created during `nova init` (`nova`, `agent-builder`) are defaults, not privileged. The user can modify, replace, or delete any agent.

### Thread

A conversation between a user and an agent. Threads are append-only.

```
Thread {
  manifest: {
    title: string
    sessionId: string     // Claude SDK session (for resume)
    taskId: string        // optional bound task
  }
  messages: Message[]     // user/assistant pairs
  events: Event[]         // tool use, text, result events
}
```

Threads are locked during execution (one run at a time per thread). Threads do not carry a channel field — Core is channel-agnostic.

### Task

A structured unit of work with steps, owned by an agent.

```
Task {
  id, title, description
  owner: string           // agent ID
  status: draft | active | done | canceled
  steps: Step[]           // plan with done flags
  resources: Resource[]   // URLs or file paths
  threadId: string        // dedicated thread
}
```

Tasks can have subtasks linked to specific steps. Tasks have their own scheduler that executes active tasks with pending steps.

### Note

A markdown document owned by an agent, shareable with the user. Notes can be pinned for quick access.

## Trust and Capabilities

Agents have two independent axes of access control:

*Trust* controls SDK-native tools (files, web, bash). It is enforced by the Engine.

| Trust Level | SDK-native tools | Use Case |
|-------------|-----------------|----------|
| sandbox | None (no files, no web, no bash) | Untrusted input protection — prevents prompt injection |
| controlled | Files + Web | Standard working agent |
| unrestricted | Files + Web + Bash | Trusted automation |

Each level strictly adds to the previous.

*Capabilities* control MCP servers. Every capability in `agent.capabilities` resolves to an MCP server. Capabilities are orthogonal to trust — they always work regardless of trust level. What you see in the config is what the agent gets.

Trust is resolved per-agent: explicit agent config overrides the workspace default.

## Data Layout

All state lives under a single workspace directory (`~/.nova` by default).

```
~/.nova/
  settings.json           # workspace-level config (default security)
  telegram.json           # channel config
  memories.json           # global shared memories
  secrets.json            # encrypted secrets
  skills/                 # shared skill definitions
  agents/
    {agent-id}/
      agent.json          # agent config
      triggers.json       # cron triggers
      instructions.md     # self-updated instructions (via MCP)
      threads/
        {thread-id}.jsonl # messages + events
      embeddings.jsonl    # episodic memory vectors
      notes/              # markdown notes
      .claude/            # Claude SDK config, skills
  tasks/
    active.json           # active tasks
    history/              # completed/canceled tasks
```

## Architectural Boundaries (Spec Index)

Each boundary below should have its own spec. This system spec defines how they relate.

| Spec | Status | What It Covers |
|------|--------|----------------|
| capabilities | DONE | Registry, resolver pattern, run-time injections |
| engine | DONE | Engine interface, trust levels, options, result shape, session management |
| threads | DONE | Creation, locking, message flow, cognitive boundary, post-run effects |
| agent-runner | DONE | Orchestration, callbacks, caller wiring patterns |
| Agent Model | DONE | Config shape, field semantics, lifecycle, self-mutation boundaries |
| System Prompt Assembly | DONE | Prompt building, context injection, formatting |
| Skills | DONE | Skill definitions, discovery, injection |
| Scheduling | DONE | Triggers, task scheduler, delivery wiring |
| Channel Contract | TODO | Adapter pattern, callback construction, message routing |
| Tasks | DONE | Data model, lifecycle, subtasks, scheduler, thread binding, MCP tools |
| Scheduling | TODO | Triggers, task scheduler, backfill — timer-based concerns |
| Storage | TODO | Data layout, file formats, migration strategy |
| Inter-Agent Communication | TODO | ask-agent, delegation depth, thread creation |

## Design Principles

1. *Code is disposable, specs are durable.* Any implementation file should be regenerable from its corresponding spec.

2. *Trust and capabilities are orthogonal.* Trust governs SDK-native tools (Engine's job). Capabilities govern MCP servers (explicit in agent config). They never interfere with each other.

3. *One user, many agents.* The system is not multi-tenant. Architectural decisions optimize for a single operator.

4. *Layers only talk to neighbors.* Channels → Daemon → Core → Engine. No skipping.

5. *Agents are configuration, not code.* An agent is fully defined by its JSON config (identity + instructions + responsibilities + capabilities + trust). No agent requires custom code.

6. *Append-only where possible.* Threads, events, usage records, embeddings — append-only simplifies reasoning about state.

7. *Capabilities are the unit of extension.* Adding a new tool to the system means adding a capability to the registry. Nothing else needs to change.

8. *Core is channel-agnostic.* Core does not know about Telegram, HTTP, or any delivery mechanism. Callers provide callbacks; Core calls them. Delivery routing is the daemon's and channels' concern.
