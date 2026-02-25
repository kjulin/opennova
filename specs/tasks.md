# Tasks

## Core Idea

A task is a structured unit of work with steps, owned by an agent. Tasks are the system's way of tracking work that spans multiple conversation turns — work that needs a plan, progress tracking, and potentially delegation to other agents through subtasks.

Tasks are a workspace-level concept, not per-agent. They live in a shared store because a single task can involve multiple agents (parent task owned by one agent, subtasks owned by others). Any agent with the `tasks` capability can create, read, and manage tasks.

## Data Model

### Task

```
Task {
  id: string              // auto-incrementing numeric string ("1", "2", ...)
  title: string           // clear, actionable label
  description: string     // context and brief
  owner: string           // agent ID
  createdBy: string       // agent ID — who created this task
  status: Status          // draft | active | done | canceled
  steps: Step[]           // ordered plan with progress tracking
  resources: Resource[]   // attached URLs or file paths
  threadId?: string       // dedicated conversation thread
  createdAt: string       // ISO timestamp
  updatedAt: string       // ISO timestamp
}
```

### Step

```
Step {
  title: string           // short label (max 60 chars)
  details?: string        // expanded description
  done: boolean           // progress flag
  taskId?: string         // linked subtask ID (one subtask per step)
}
```

A step can optionally link to a subtask — a separate task delegated to another agent (or the same agent) for that piece of work. One subtask per step. The subtask is a full task with its own thread, steps, and lifecycle.

### Resource

```
Resource {
  type: "url" | "file"   // resource kind
  value: string           // URL or absolute file path
  label?: string          // display name
}
```

Attachments for context: links to PRs, specs, files relevant to the work. Visible in the task dashboard.

### Status

```
draft    → visible but not executed by the scheduler
active   → in progress, scheduler will invoke the owning agent
done     → completed, moved to history
canceled → abandoned, moved to history (cascades to subtasks)
```

Transitions: `draft → active → done` is the happy path. `active → canceled` and `draft → canceled` are valid. There is no `done → active` (reopen) — create a new task instead.

### Owner

The `owner` field determines who drives the task:
- An agent ID means the task scheduler will invoke that agent to work on it

Owner must be a valid agent ID (directory exists with `agent.json`). Validated on create and on owner change.

The `createdBy` field records who originated the task. It is set once at creation and never changes.

## Storage

Tasks are a workspace-level store, not per-agent:

```
{workspaceDir}/tasks/
  tasks.json              // active tasks (draft + active)
  history.jsonl           // completed + canceled tasks (append-only)
```

### tasks.json

```json
{
  "tasks": [ ... ],
  "nextId": 42
}
```

A JSON object with the active task array and a monotonic ID counter. The counter never decreases — even if all tasks are archived, the next task gets the next number. This keeps IDs globally unique and stable for references.

Read-modify-write on every mutation. No concurrent write protection beyond the single-process daemon model.

### history.jsonl

One JSON object per line, append-only. Each entry is the full task snapshot at archive time, plus an `archivedAt` timestamp. History is read in reverse (most recent first) with a configurable limit.

Tasks move to history on completion (`done`) or cancellation (`canceled`). Once in history, tasks are immutable — no updates, no status changes.

### Why workspace-level, not per-agent

A task owned by agent A can have subtasks owned by agents B and C. If tasks were per-agent, reading a subtask's status would require cross-agent filesystem access. The shared store keeps task queries simple: one file, all tasks.

## Thread Binding

Every task gets a dedicated conversation thread, created immediately after the task itself. The thread is created in the owner agent's directory and bound to the task via `taskId` in the thread manifest.

```
createThread(ownerAgentDir, channel, { taskId })
→ threadId stored on task.threadId
→ taskId stored on thread manifest
```

When the thread-runner detects `taskId` on the manifest, it loads the task and injects the `<Task>` block into the system prompt (see System Prompt Assembly spec). This gives the agent full task context — title, description, steps with progress markers — on every conversation turn in that thread.

The thread channel is currently hardcoded to `"telegram"`. This should be derived from execution context or made configurable — it's a known limitation.

### Thread-task invariant

One task, one thread. The thread is the task's conversation surface. All scheduler invocations, user replies, and agent work for a task happen in this thread. The task thread does not drift — the `<Task>` prompt block includes a directive to focus on the task.

If a task has no thread (e.g., created through a code path that skipped thread creation), the scheduler creates one on first invocation. This is a recovery path, not a normal flow.

## MCP Tools (Agent Surface)

Tasks are exposed to agents through the `tasks` MCP server. An agent with the `tasks` capability gets the following tools:

### Task CRUD

| Tool | Description |
|------|-------------|
| `create_task` | Create a new task. Defaults owner to the calling agent. Creates a dedicated thread. |
| `get_task` | Get full task details by ID. Can read any task (active or history). |
| `update_task` | Update title, description, status, or owner. Setting status to `done` archives the task. |
| `complete_task` | Shorthand: mark done and archive. |
| `cancel_task` | Cancel and archive. Cascades to linked subtasks. |
| `list_tasks` | List the calling agent's active tasks only. |
| `list_history` | List completed/canceled tasks from history. Most recent first, configurable limit. |

### Step Management

| Tool | Description |
|------|-------------|
| `update_steps` | Full replace of the steps array. Used to set the initial plan. |
| `update_step` | Update a single step by index. Can change title, details, and done status. |

`update_steps` replaces the entire steps array — used when the agent is defining or restructuring its plan. `update_step` modifies a single step in place — used for progress tracking (marking done) and updating details without touching other steps.

The split matters because steps carry state that other agents control: `taskId` (subtask linkage) is set by `create_subtask` and must not be overwritable through step updates. `update_step` can change `title`, `details`, and `done` but never `taskId`. `update_steps` sets the initial plan shape but should only be used before subtasks are linked — once a step has a `taskId`, the plan should be modified through `update_step` to avoid clobbering linkages.

### Subtasks

| Tool | Description |
|------|-------------|
| `create_subtask` | Create a subtask linked to a specific step. Creates a new task + thread for the subtask owner. |

Constraints:
- Only the parent task's owner can create subtasks for it
- One subtask per step (enforced — attempting to link a second returns an error)
- Subtask owner is validated (must be an existing agent)
- The subtask is a full task — it gets its own thread, can have its own steps, can itself create subtasks

### Resources

| Tool | Description |
|------|-------------|
| `add_resource` | Attach a URL or file path to a task |
| `remove_resource` | Remove a resource by index (0-based) |

### Visibility

`list_tasks` returns only the calling agent's tasks. But `get_task` can read any task by ID — agents need this to check subtask status across agent boundaries.

## Scheduler

The task scheduler is a daemon-level concern. It periodically invokes agents to work on their active tasks.

### Hourly Tick

```
Cron: "0 6-21 * * *"  (every hour, 6am–10pm local time)
```

On each tick:
1. Load all active tasks
2. Filter out in-flight tasks (already being processed)
3. For each remaining task: invoke the owning agent on the task's thread with the `TASK_WORK_PROMPT`

Tasks are processed sequentially within a tick. Each invocation runs with `background: true` (agent output is not sent to the user unless the agent explicitly uses `notify_user`).

### In-flight Deduplication

A task can only have one active invocation at a time. The scheduler tracks in-flight task IDs and skips tasks that are already being processed. This prevents duplicate work from overlapping scheduler ticks or manual triggers.

### Manual Trigger

```
runTaskNow(workspaceDir, taskId) → error string | null
```

Allows immediate task invocation outside the scheduler rhythm. Used by the HTTP API (`POST /api/tasks/:id/run`). Same constraints apply: task must be active, agent-owned, and not already in-flight.

### Event-Driven Runs

Two lifecycle events trigger immediate agent invocation, bypassing the hourly wait:

| Event | Action |
|-------|--------|
| Subtask completed | Wake the parent task's owner agent |
| Task created for an agent | Wake that agent |

"Wake" means: trigger the same task processing run that the hourly scheduler triggers — `runTaskNow` with the same `TASK_WORK_PROMPT` and `background: true` mode. The hourly scheduler remains as a safety net.

This shifts the bottleneck from system latency (~1 hour per handoff) to user response time, which is where it should be.

### Task Work Prompt

The scheduler sends a static prompt that instructs the agent to:
1. Review the `<Task>` block in its system prompt
2. Check progress against steps
3. Create a plan (`update_steps`) if none exists
4. Check linked subtask status before proceeding past a step
5. Work on the next incomplete step
6. Use `notify_user` for user input
7. Call `complete_task` when finished

This prompt is the same for every agent and every task. The specificity comes from the `<Task>` block in the system prompt, not from the scheduler prompt.

## HTTP API

The daemon exposes task management through REST endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List all active tasks + agent list + in-flight IDs |
| `POST` | `/api/tasks` | Create task (owner required — must be an existing agent) |
| `GET` | `/api/tasks/history` | List archived tasks (limit via query param) |
| `GET` | `/api/tasks/:id` | Get single task |
| `PATCH` | `/api/tasks/:id` | Update task fields |
| `POST` | `/api/tasks/:id/complete` | Complete and archive |
| `POST` | `/api/tasks/:id/cancel` | Cancel and archive (cascades subtasks) |
| `POST` | `/api/tasks/:id/run` | Trigger immediate task processing |

The API mirrors the MCP tools but without agent-scoped filtering on list. The API is the surface for the web dashboard (task list mini-app) and the Console.

## Subtask Mechanics

Subtasks are the delegation mechanism. A parent agent breaks its work into steps, and for steps that require another agent's expertise, it creates a subtask.

### Creation Flow

```
Parent agent (owns task #5, step 2):
  create_subtask(taskId: "5", stepIndex: 2, title: "...", owner: "other-agent")
  → Creates task #6 (owner: other-agent, createdBy: parent-agent)
  → Creates thread in other-agent's directory (taskId: "6")
  → Links: task #5 step 2 → taskId: "6"
```

### Completion Flow

```
Subtask agent completes task #6:
  complete_task("6") → task archived
  → Event fires → parent agent woken immediately
  → Parent agent calls get_task("6"), sees status: "done"
  → Parent agent marks step 2 as done, proceeds to step 3
```

The event-driven run ensures the parent agent is woken immediately on subtask completion, rather than waiting for the next hourly tick.

### Cascade Cancel

When a parent task is canceled, all linked subtasks are recursively canceled. This prevents orphaned subtask work.

Completion does NOT cascade — completing a parent task does not automatically complete its subtasks. This is intentional: subtasks may still be in progress when the parent decides to mark itself done.

## Constraints

- Task IDs are globally unique, monotonically increasing, and never reused.
- Tasks are workspace-level, not per-agent. Any agent with `tasks` capability can read any task.
- `list_tasks` is agent-scoped (shows only the calling agent's tasks). `get_task` is global.
- One thread per task. Thread is created on task creation.
- One subtask per step. Enforced at link time.
- Step `taskId` (subtask linkage) is set only by `create_subtask` — never by `update_step` or `update_steps`.
- Cancel cascades to subtasks. Complete does not.
- In-flight deduplication prevents concurrent processing of the same task.
- History is append-only and immutable.
- Thread channel for task threads is currently hardcoded to "telegram" — this is a known limitation.

## What Lives Here

- Task data model (Task, Step, Resource, Status)
- Storage layout and format (tasks.json, history.jsonl)
- Task lifecycle (create, update, complete, cancel, archive)
- Subtask mechanics (creation, linking, cascade cancel)
- Thread binding (one thread per task, taskId on manifest)
- MCP tool catalog (what agents can do with tasks)
- Scheduler behavior (hourly tick, in-flight tracking, manual trigger, event-driven runs)
- HTTP API surface

## What Does NOT Live Here

- System prompt `<Task>` block format (System Prompt Assembly spec)
- Thread creation and manifest format (Threads spec)
- Capability resolution for `tasks` server (Capabilities spec)
- Channel-specific task presentation, e.g., Telegram supergroup/topics (Channel Contract spec, when written)
- Web dashboard / task list mini-app (implementation concern)
- Task work prompt content (implementation detail — the spec documents its existence and role, not its exact wording)
