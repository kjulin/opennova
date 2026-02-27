# Skills

## Core Idea

A skill is a reusable instruction document that extends an agent's behavior. Skills are defined once in the workspace library and assigned per-agent via `agent.json`. They are consumed by the Claude Agent SDK — OpenNova manages storage, assignment, and materialization. The SDK handles discovery and injection.

OpenNova does not parse, interpret, or inject skill content into the system prompt. It manages the storage and the assignment model. The SDK does the rest.

## Skill Library

All skills live in the workspace skill library:

```
{workspace}/skills/{skill-name}/SKILL.md
```

This is the single source of truth for skill content. Skills are created, edited, and deleted here. The library is managed by the user through the console UI or CLI — agents do not create or modify skills.

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

## Assignment Model

Skill assignments are stored in `agent.json`:

```json
{
  "name": "Phoenix Architect",
  "skills": ["nightly-review", "spec-eval"]
}
```

The `skills` field is:
- **Optional** (defaults to empty array)
- **Array of skill names** (strings matching directories in `skills/`)
- **Validated at write time** (skill must exist in library when added)

`agent.json` is the source of truth for which skills an agent has. The `.claude/skills/` directory is a derived cache — it is materialized at runtime and can be deleted and regenerated.

### Runtime Materialization

When an agent is invoked, the runtime materializes its skills into `.claude/skills/` for SDK discovery. This is a full reconcile — the directory is made to exactly match the `skills` array in `agent.json`.

**Local implementation:**
1. Read `agent.json`, get `skills: []`
2. Remove any entries in `.claude/skills/` not in the config
3. For each skill name in config:
   - Verify `skills/{name}` exists in library (fail if missing)
   - Create symlink `agents/{id}/.claude/skills/{name}` → `skills/{name}`
4. Run agent (SDK discovers skills via directory scan)

**Materialization decisions:**
- **When:** On agent invocation (lazy)
- **Caching:** Keep symlinks persistent (they're cheap)
- **Missing skills:** Fail agent invocation (forces user to fix config)

## SDK Integration

The Claude Agent SDK discovers skills through the `.claude/` directory convention. OpenNova enables this with:

```
settingSources: ["project"]
```

This tells the SDK to scan the agent's working directory (`{agentDir}`) for `.claude/skills/`. The SDK reads `SKILL.md` files, parses frontmatter, and injects skills into the agent's available capabilities.

OpenNova's role is strictly:
1. Store skill content in the workspace library
2. Persist assignments in `agent.json`
3. Materialize symlinks at invocation time for SDK discovery

OpenNova never reads skill content at runtime, never injects skills into the system prompt, and never interprets what a skill does.

## Operations

### Link (Activate)

Adds a skill to an agent's `skills` array in `agent.json` and creates the symlink.

```
Input: agentId, skillName
Actions:
  1. Validate skill exists in library
  2. Add skillName to agent.json skills[] (if not present)
  3. Create symlink for SDK discovery
```

Idempotent — linking an already-linked skill is a no-op.

### Unlink (Deactivate)

Removes a skill from an agent's `skills` array in `agent.json` and removes the symlink.

```
Input: agentId, skillName
Actions:
  1. Remove skillName from agent.json skills[]
  2. Remove symlink
```

Idempotent — unlinking a skill that isn't linked is a no-op.

### Delete Skill

Removes the skill from the library and cleans up all references.

```
Input: skillName
Actions:
  1. Delete skills/{name}/
  2. For each agent with skillName in agent.json:
     - Remove from skills[] array
     - Write agent.json
     - Remove symlink
```

### List Agent Skills

```
Input: agentId
Output: skills[] from agent.json
```

No filesystem scanning. The configuration is the source of truth.

## Management Surfaces

### Console UI

CRUD operations on the skill library plus assignment management:
- List all skills (with assignment state per agent)
- Create skill (name, description, content)
- Edit skill (description, content)
- Delete skill (removes from library, cleans up all agent references)
- Assign/unassign skill for specific agents

### CLI

```
nova skills list [--agent <id>]
nova skills link <name> --agent <id|all>
nova skills unlink <name> --agent <id|all>
nova skills delete <name>
```

`link` assigns a skill to an agent (or all agents). `unlink` removes the assignment.

## Constraints

- The workspace skill library (`{workspace}/skills/`) is the single source of truth for skill content.
- `agent.json` is the single source of truth for skill assignments.
- Agent `.claude/skills/` directories are a derived cache — materialized at invocation, deletable and regenerable.
- Agents do not create, edit, or delete skills. Skills are a user-managed resource.
- OpenNova does not parse or inject skill content. The SDK handles discovery and injection.
- Skill names are unique within the workspace.

## What Lives Here

- Skill storage model (workspace library, directory format, SKILL.md)
- Assignment model (agent.json skills field, operations)
- Runtime materialization (lazy, full reconcile)
- SDK integration point (`settingSources`)
- Management surfaces (console, CLI)

## What Does NOT Live Here

- SDK subagents (`.claude/agents/` — separate concept, separate spec)
- Skill content authoring guidelines (user concern, not system architecture)
- System prompt assembly (System Prompt spec — skills are not part of the system prompt)
