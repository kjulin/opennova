# System Prompt Assembly

## Core Idea

The system prompt is the agent's world model for a single run. It tells the agent who it is, how to work, what it can access, what it knows, and what context it's operating in. The prompt builder assembles this from the agent's config, the workspace state, and the execution context.

The builder is the single entry point. Every section of the system prompt is assembled inside the builder — no caller appends additional prompt content after the builder returns. This makes the builder the source of truth for prompt structure.

## Builder Interface

```
buildSystemPrompt(
  agent: AgentConfig,
  channel: ChannelType,
  cwd: string,
  directories: string[],
  options?: {
    task?: Task,
    silent?: boolean,
  }
): string
```

The builder receives resolved values — cwd and directories are already expanded, task is already loaded. The builder does not fetch, resolve, or look up anything. It formats.

## Prompt Structure

The system prompt is a sequence of tagged sections. Each section is wrapped in an XML-style tag and has a single responsibility.

```
<Identity>           Who the agent is
<Instructions>       How the agent operates
<Responsibilities>   What the agent does (conditional)
<Directories>        Filesystem boundaries
<Storage>            Persistence guidance
<Formatting>         Channel-specific output rules
<Context>            Current time and timezone
<Memories>           Shared cross-agent facts
<Task>               Bound task context (conditional)
<Background>         Silent execution mode (conditional)
```

Sections are emitted in this order. Conditional sections are omitted entirely when their condition is not met — no empty tags, no placeholders.

## Section Semantics

### Identity

```
<Identity>
{agent.identity}
</Identity>
```

Source: `agent.identity` field.

Omitted if the agent has no `identity` field. 

### Instructions

```
<Instructions>
{agent.instructions}
</Instructions>
```

Source: `agent.instructions` field.

Omitted if the agent has no `instructions` field. Only emitted when `identity` is present (the new format). Legacy `role` agents do not get a separate Instructions block.

### Responsibilities (conditional)

```
<Responsibilities>
  <Responsibility title="Agent routing">
    When a new conversation starts, determine whether to handle it or delegate...
  </Responsibility>
  <Responsibility title="Product onboarding">
    Help the user get started with Nova. Goals: ...
  </Responsibility>
</Responsibilities>
```

Source: `agent.responsibilities` array.

Each responsibility is rendered as a child element with its title as an attribute and content as body text. The XML structure makes individual responsibilities addressable — the agent can reference them by title when deciding to remove one.

Omitted if the agent has no responsibilities. This is the common case — responsibilities are optional and most agents operate fine with just identity + instructions.

### Directories

```
<Directories>
Your working directory is: {cwd}
There may already be existing files — check before creating new ones.

You also have access to these additional directories:
- {dir1}
- {dir2}
</Directories>
```

Source: `cwd` (agent's own directory) and `directories` (resolved from agent config).

Tells the agent where it can operate on the filesystem. The additional directories list is omitted if empty.

Omitted entirely if `directories` is empty AND `cwd` is not meaningful (sandbox agents that can't access files). In practice, emitted for any agent with file access.

### Storage

```
<Storage>
{persistence guidance}
</Storage>
```

Source: static content (not per-agent).

Explains the four persistence mechanisms: files, instructions, memory, triggers. Helps the agent choose the right tool for the right kind of information. This is behavioral guidance — it doesn't grant access, it teaches usage.

Omitted for agents without file or persistence capabilities. The test: if the agent has no capabilities that persist anything, Storage is noise.

### Formatting

```
<Formatting>
{channel-specific formatting rules}
</Formatting>
```

Source: channel type (e.g., "telegram").

Channel-specific output formatting rules. Currently only Telegram has custom formatting (Markdown syntax). Other channels emit no Formatting block.

Omitted for channels without specific formatting requirements.

### Context

```
<Context>
Current time: {formatted local time} ({timezone})
</Context>
```

Source: system clock.

Always emitted. Every agent needs to know the current time for scheduling, relative references, and time-aware responses.

### Memories

```
<Memories>
- {memory 1}
- {memory 2}
</Memories>
```

Source: workspace `memories.json` (shared across all agents).

Cross-agent facts: user's name, timezone, preferences, decisions. Loaded fresh on each run. Omitted if no memories exist.

### Task (conditional)

```
<Task>
You are working on task #{id}. Focus solely on progressing this task.

Title: {title}
Description: {description}
Status: {status}
Steps:
1. → Step one
2. ○ Step two
3. ✓ Step three (done)
</Task>
```

Source: `options.task` (loaded by caller from thread manifest's `taskId`).

Only emitted when the thread is bound to a task. Gives the agent full task context including step progress. The task section includes a directive to focus on the task — this is intentional, as task threads should not drift.

### Background (conditional)

```
<Background>
You are running in the background (scheduled task). Your responses will NOT be sent to the user automatically.
If you need to notify the user about something important, use the notify_user tool.
</Background>
```

Source: `options.background` flag.

Only emitted when the agent is running in silent mode (triggers, task scheduler). Tells the agent its output won't reach the user directly and to use `notify_user` for important communication.

## What the Builder Does NOT Do

- *Resolve capabilities.* The builder does not know what MCP servers the agent gets. Capabilities are resolved separately and passed to the engine.
- *Enforce security.* Trust levels are enforced by the Engine's SDK permission mapping. The prompt does not contain security instructions.
- *Fetch data.* The builder receives pre-loaded values (agent config, memories, task). It does not read files, query databases, or call external services.
- *Define behavior.* Agent-specific behavioral rules (communication style, interaction patterns, domain knowledge) belong in the agent's `identity` and `instructions` fields. The builder provides system-level context, not behavioral coaching.

## Assembly Order Rationale

The section order follows a principle: *identity before context, context before state.*

1. *Who you are and what you do* (Identity, Instructions, Responsibilities) — establishes the agent's frame and current duties.
2. *What you can access* (Directories, Storage) — sets operational boundaries.
3. *How to communicate* (Formatting) — output constraints.
4. *What's happening now* (Context, Memories) — current state of the world.
5. *What you're doing* (Task, Background) — execution-specific context.

Early sections change slowly (identity rarely changes). Later sections change per-run (context is always fresh, task state evolves). This mirrors the pace layer principle: slow layers first, fast layers last.

## Constraints

- The builder is the single assembler. No prompt content is appended after the builder returns.
- Every section has an XML-style tag. No untagged free text in the system prompt.
- Conditional sections are fully omitted, not empty.
- The builder formats but does not fetch. All data arrives pre-loaded through its parameters.
- Section order is fixed. Callers cannot reorder or inject between sections.
- Legacy `<Role>` format is a migration path, not a target. New agents always use Identity + Instructions.

## What Lives Here

- System prompt section catalog (tags, semantics, sources)
- Builder interface and assembly order
- Conditional section rules
- Section content templates

## What Does NOT Live Here

- Agent config shape (Agent Model spec)
- Capability resolution (Capabilities spec)
- Trust enforcement (Engine Contract spec)
- Thread execution flow (Thread Lifecycle spec)
- Skill injection (Skills spec — skills are injected by the SDK via `.claude/` directory, not by the prompt builder)
- Memory storage format (Storage spec)
