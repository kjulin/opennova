# Agent Model

## Core Idea

An agent is a configured AI personality with bounded access. It is defined entirely by its JSON config — no agent requires custom code. The config is the specification: it declares who the agent is (identity), how it operates (instructions), what it can access (directories, capabilities), and what trust level it runs at.

Agent configs live at the Policy pace layer — they change per configuration, not per release. The system treats all agents equally. Agents created during `nova init` (currently `nova` and `agent-builder`) are defaults, not privileged. The user can modify, replace, or delete any agent.

## Config Shape

```
AgentConfig {
  id: string              // derived from directory name, not stored in JSON
  name: string            // display name (required)
  description?: string    // one-line summary — shown to other agents for delegation discovery
  identity?: string       // who: expertise, personality, methodology
  instructions?: string   // how: files, rhythm, focus, constraints
  responsibilities?: Responsibility[]  // what: specific duties with lifecycle
  directories?: string[]  // filesystem access boundaries
  capabilities?: string[] // explicit list of MCP servers this agent gets
  trust: TrustLevel       // sandbox | controlled | unrestricted (required)
  model?: Model           // default model override
  subagents?: Record<string, SubagentConfig> // Claude SDK inline subagents
}

Responsibility {
  title: string           // short label, unique within agent (e.g., "Agent routing")
  content: string         // instruction text for this responsibility
}
```

The `agent.json` file contains everything except `id`. The ID is the directory name — it is not stored in the JSON and is injected at load time.

## Field Semantics

### identity

Who the agent is. Expertise, personality, methodology, worldview. This is the slowest-changing field in the config — it defines the agent's character and rarely needs updating. Maps to the `<Identity>` block in the system prompt.

Identity is set by the user (directly or via agent-builder).

### instructions

How the agent operates. Files to reference, session rhythm, constraints, learned preferences. This is the faster-changing field — it evolves as the agent learns what works. Maps to the `<Instructions>` block in the system prompt.

If the agent has the `self` capability, it can read and update its own instructions via `update_my_instructions`. See the pace layer hierarchy below for the full self-mutation surface.

### responsibilities

What the agent does. Specific duties with potential lifecycle. Each responsibility has a title (unique within the agent) and content (instruction text). Maps to the `<Responsibilities>` block in the system prompt.

Responsibilities are the fastest-changing layer of agent definition. They can be added and removed at runtime — by the agent itself (via `self` capability) or by the user (via Console or direct edit). Presence means active. Absence means done. No status fields, no state tracking.

The title is the public API: other agents see responsibility titles through `list_available_agents` for delegation discovery. The content is private — only the owning agent sees it in its system prompt.

Responsibilities are optional. An agent with just identity + instructions works exactly as before.

### The pace layer hierarchy: identity → instructions → responsibilities

Three fields define what an agent is, at three different rates of change:

- *Identity* (slow) — who the agent is. Answers "who are you?" Survives across many conversations unchanged. User-controlled only.
- *Instructions* (medium) — how the agent operates. Answers "how should you work right now?" Evolves as the agent learns. Agent-mutable via `self` capability (full replace).
- *Responsibilities* (fast) — what the agent does. Answers "what are your current duties?" Can change at runtime. Agent-mutable via `self` capability (individual CRUD).

This hierarchy forms: *be → operate → do.*

This separation matters because it makes `self` capability safe. An agent with `self` can refine how it works (instructions) and manage what it does (responsibilities) but cannot redefine who it is (identity). The user controls identity; the agent controls instructions and responsibilities.

### description

Visible to other agents through `list_available_agents`. This is the delegation discovery surface — other agents decide whether to delegate based on this field. Not shown in the agent's own system prompt.

### directories

Filesystem access boundaries. Paths are resolved at load time:
- `~` expands to home directory
- Absolute paths used as-is
- Relative paths resolved against workspace directory

The agent's own directory (`{workspaceDir}/agents/{id}`) is always the working directory. Declared directories are *additional* access. An agent with no `directories` can only access its own agent directory.

### capabilities

The complete, explicit list of MCP servers the agent gets. Every capability in this array resolves to an MCP server through the capability registry. No implicit capabilities — what you see in config is what the agent gets.

See the Capabilities spec for the registry, resolution, and run-time injections.

### trust

Controls SDK-native tools (files, web, bash). Required — every agent must declare its trust level.

| Trust Level | SDK-native tools |
|-------------|-----------------|
| sandbox | None |
| controlled | Files + Web |
| unrestricted | Files + Web + Bash |

Trust is orthogonal to capabilities. See the Engine spec for trust enforcement and the Capabilities spec for the separation.

Trust can only be set by the user — never by an agent or by the agent-management tools. This is the security boundary: agents can be granted capabilities, but the trust level is always a human decision.

### model

Override the default model for this agent. Optional — most agents use the system default.

### subagents

Claude SDK inline subagents. These are SDK-level agents (not OpenNova agents) defined within the config. They run inside the same engine call and share the parent's tools.

This is a pass-through to the SDK — OpenNova does not interpret subagent configs beyond passing them to the engine.

## Agent ID

The agent ID is the directory name under `{workspaceDir}/agents/`. It is:
- Lowercase alphanumeric with hyphens: `/^[a-z0-9][a-z0-9-]*$/`
- Unique within the workspace
- Stable — renaming an agent means renaming the directory (and all contained data moves with it)
- Not stored in `agent.json` — derived from filesystem at load time

The ID is used as a key throughout the system: thread ownership, task ownership, trigger association, Telegram bot mapping.

## Agent Loading

```
loadAgents() → Map<string, AgentConfig>
```

Scans `{workspaceDir}/agents/`, reads `agent.json` from each subdirectory, injects the directory name as `id`. Malformed configs are logged and skipped — they do not crash the system.

Loading is stateless — agents are read fresh from disk on each invocation. There is no in-memory agent cache that could go stale.

## Agent Lifecycle

### Creation

Agents can be created through:
- `nova init` — creates default agents from workspace template
- `agent-management` MCP tools — `create_agent` (used by agent-builder)
- Manual file creation — user writes `agent.json` directly

All paths produce the same artifact: a directory with an `agent.json` file.

### Modification

- `agent-management` MCP tools — `update_agent` (fields except trust)
- `self` capability — agent updates its own instructions and manages its own responsibilities
- Console UI — full config editing (including structural editing of responsibilities)
- Manual file editing — user edits `agent.json` directly

Trust level cannot be set through agent-management tools or self-management. It is always a user decision via CLI or direct file edit.

### Deletion

```
delete_agent(id) → removes {workspaceDir}/agents/{id}/ recursively
```

Deletion removes the agent directory and everything in it: config, threads, embeddings, notes, triggers, Claude SDK config. There is no soft delete or archive.

No cascade beyond the directory: tasks owned by a deleted agent become orphaned (task system handles this gracefully). Telegram bot configs referencing a deleted agent become inert.

### Renaming

Renaming changes the agent's ID (directory name) and optionally its display name. All contained data (threads, triggers, embeddings) moves with the directory. External references (task ownership, Telegram bot configs) are NOT updated — they become stale. This is acceptable because renaming is rare and the user can fix references.

## Default Agents

`nova init` creates two agents from the workspace template:

- `nova` — general-purpose executive assistant (trust: controlled)
- `agent-builder` — agent creation specialist (trust: sandbox)

These are defaults, not privileged. They receive no special treatment at runtime. The user can modify their identity, instructions, capabilities, trust level, or delete them entirely.

The workspace template defines their initial config. After initialization, the workspace copies diverge from the template — there is no sync mechanism.

## Agent Directory Layout

```
{workspaceDir}/agents/{id}/
  agent.json            # agent config
  triggers.json         # cron triggers (optional)
  threads/
    {threadId}.jsonl    # thread data
  embeddings.jsonl      # episodic memory vectors
  notes/                # markdown notes
  .claude/              # Claude SDK config, skills
```

The agent directory is the agent's world. Everything the system needs to know about an agent is in this directory or derivable from its config.

## Constraints

- Agent config is the single source of truth for an agent's identity and access boundaries.
- All agents are equal — no agent receives special runtime treatment based on its ID.
- Trust is a user-controlled field — agents cannot set or change trust levels.
- An agent with `self` capability can modify its own `instructions` field and CRUD its own `responsibilities`. Identity and all other fields are user-controlled.
- Agent ID is derived from filesystem — not stored in config, not settable independently of the directory.
- Capabilities are explicit — no implicit MCP server wiring. What's in `capabilities` is what the agent gets (plus run-time injections per the Capabilities spec).
- Agent loading is stateless — configs are read from disk on each invocation with no caching.

## What Lives Here

- AgentConfig shape and field semantics
- Agent ID rules and derivation
- Agent lifecycle (create, update, rename, delete)
- Default agents and workspace template relationship
- Agent directory layout
- Self-mutation boundaries (what agents can change about themselves)

## What Does NOT Live Here

- Capability resolution (Capabilities spec)
- Trust enforcement (Engine spec)
- System prompt assembly (separate spec)
- Thread management (Threads spec)
- Inter-agent communication (separate spec)
- Trigger scheduling (separate spec)
