# Skills

## Core Idea

A skill is a reusable instruction document that extends an agent's behavior. Skills are defined once in the workspace library and activated per-agent. They are consumed by the Claude Agent SDK — OpenNova manages the filesystem layout, the SDK handles discovery and injection.

OpenNova does not parse, interpret, or inject skill content into the system prompt. It manages the storage and the activation model. The SDK does the rest.

## Skill Library

All skills live in the workspace skill library:

```
{workspace}/skills/{skill-name}/SKILL.md
```

This is the single source of truth for skill content. Skills are created, edited, and deleted here.

### Skill Format

A skill is a directory containing a `SKILL.md` file with optional YAML frontmatter:

```
---
name: skill-name
description: Short description shown to the agent for invocation
---

# Skill content

Instructions for when and how to use this skill...
```

- `name` — identifier, matches directory name
- `description` — tells the agent when to invoke this skill (used by SDK for skill discovery)
- Body — the full instructions the agent receives when the skill is invoked

### Skill Naming

Skill names follow the same rules as agent IDs: lowercase alphanumeric with hyphens (`/^[a-z0-9][a-z0-9-]*$/`).

## Activation Model

A skill in the library is inert until activated for an agent. Activation creates a symlink from the agent's `.claude/skills/` directory to the skill in the library:

```
{agentDir}/.claude/skills/{skill-name} → {workspace}/skills/{skill-name}
```

Deactivation removes the symlink.

The agent's `.claude/skills/` directory contains only symlinks to the workspace library — never source files.

### Activation Semantics

- A skill can be activated for one agent, multiple agents, or all agents.
- Activation is idempotent — activating an already-active skill is a no-op.
- Deactivating a skill that isn't active is a no-op.
- Deleting a skill from the library removes the skill directory and all symlinks pointing to it across all agents.

## SDK Integration

The Claude Agent SDK discovers skills through the `.claude/` directory convention. OpenNova enables this with a single configuration:

```
settingSources: ["project"]
```

This tells the SDK to scan the agent's working directory (`{agentDir}`) for `.claude/skills/` and `.claude/agents/`. The SDK reads `SKILL.md` files, parses frontmatter, and injects skills into the agent's available capabilities.

OpenNova's role is strictly filesystem management:
1. Store skill content in the workspace library
2. Create symlinks on activation, remove on deactivation
3. Remove all symlinks when a skill is deleted

OpenNova never reads skill content at runtime, never injects skills into the system prompt, and never interprets what a skill does.

## Operations

Three operations maintain the symlink state. There is no background sync or startup reconciliation — if a symlink is stale, the operation that should have cleaned it up has a bug.

### Activate

Creates a symlink from `{agentDir}/.claude/skills/{name}` to `{workspace}/skills/{name}`. Idempotent — if the symlink already exists and points to the correct target, no-op.

### Deactivate

Removes the symlink from `{agentDir}/.claude/skills/{name}`. Idempotent — if no symlink exists, no-op.

### Delete Skill

Removes the skill directory from the library. Scans all agents and removes any symlinks pointing to the deleted skill. This is the only operation that touches multiple agents' `.claude/skills/` directories.

## Agent Skill Self-Management

Agents with the `self` capability can manage their own skills. This is a natural extension of the self-mutation surface: just as `self` lets agents update their instructions (how they operate), it lets them manage their skills (how they extend their behavior).

### Scope

An agent with `self` can:
- **List skills** — see all skills in the workspace library with their own activation state
- **Create a skill** — write a new skill to the workspace library and activate it for themselves
- **Update a skill** — modify the content of a skill in the workspace library
- **Delete a skill** — remove a skill from the workspace library (and all symlinks across agents)
- **Activate a skill** — activate an existing skill for themselves
- **Deactivate a skill** — deactivate a skill for themselves

### Workspace Library Is Shared

Skills live in the workspace library, which is shared across all agents. When an agent creates or updates a skill, it modifies a shared resource. This is intentional — skills are reusable by design. An agent that creates a useful skill makes it available for any agent to activate.

The shared nature means an agent can update or delete a skill that other agents also use. This is acceptable because:
1. Skills are disposable — they can be regenerated from their description and intent
2. The workspace is single-user — there's no adversarial multi-tenant concern
3. The user can always intervene through Console UI or CLI

### Self-Management Tools

The `self` capability MCP server exposes skill management tools alongside the existing `update_my_instructions` and `read_my_instructions`:

| Tool | Description |
|------|-------------|
| `list_skills` | List all skills in the workspace library with activation state for this agent |
| `create_skill` | Create a new skill (name, description, content) and activate it for this agent |
| `update_skill` | Update an existing skill's description and/or content |
| `delete_skill` | Delete a skill from the library (removes all symlinks) |
| `activate_skill` | Activate an existing skill for this agent |
| `deactivate_skill` | Deactivate a skill for this agent |

### Constraints on Self-Management

- Agents can only activate/deactivate skills for *themselves* — never for other agents.
- Create, update, and delete operate on the workspace library (shared resource).
- Activation on create is automatic — creating a skill without activating it for yourself would be pointless in the self-management context.
- Skill naming rules are enforced: lowercase alphanumeric with hyphens.
- The tools live in the `self` capability — no new capability is introduced.

### Why `self` and Not a New Capability

Skills are part of how an agent operates. The `self` capability already governs what agents can change about their own behavior. Adding skills to `self` follows the same pattern:
- `instructions` = how the agent operates (text in config)
- `skills` = how the agent extends its behavior (documents in the library)

Both are behavioral configuration. Both are safe to let agents manage because the user controls whether `self` is granted. A separate `skill-management` capability would fracture the self-mutation surface without adding meaningful security boundary — any agent that should manage skills should also be able to update its instructions, and vice versa.

## Management Surfaces

### Console UI

CRUD operations on the skill library plus activation management:
- List all skills (with activation state per agent)
- Create skill (name, description, content)
- Edit skill (description, content)
- Delete skill (removes from library, cleans up symlinks)
- Activate/deactivate skill for specific agents

### CLI

```
nova skills list [--agent <id>]
nova skills link <name> --agent <id|all>
nova skills unlink <name> --agent <id|all>
```

`link` activates a skill for an agent (or all agents). `unlink` deactivates.

### Agent Self-Management

Agents with the `self` capability can manage skills through the MCP tools described above. This is the third management surface — alongside Console UI and CLI.

## Constraints

- The workspace skill library (`{workspace}/skills/`) is the single source of truth for skill content.
- Agent `.claude/skills/` directories contain only symlinks — never source files.
- OpenNova does not parse or inject skill content. The SDK handles discovery and injection.
- Skill names are unique within the workspace.
- No background sync or startup reconciliation. Symlink state is maintained by explicit operations only.
- Agent skill self-management is gated by the `self` capability. Agents without `self` cannot create, modify, or activate skills.
- Agents can only activate/deactivate skills for themselves — cross-agent activation requires Console UI, CLI, or agent-management tools.

## What Lives Here

- Skill storage model (workspace library, directory format, SKILL.md)
- Activation model (symlinks, operations)
- SDK integration point (`settingSources`)
- Agent self-management scope and tools
- Management surfaces (console, CLI, agent self-management)

## What Does NOT Live Here

- SDK subagents (`.claude/agents/` — separate concept, separate spec)
- Skill content authoring guidelines (user concern, not system architecture)
- System prompt assembly (System Prompt spec — skills are not part of the system prompt)
- Agent config (Agent Model spec — skills are not listed in agent.json)
