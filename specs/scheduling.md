# Scheduling

## Core Idea

Scheduling covers timer-driven agent invocations: trigger firing and task step execution. Both are background operations — the user is not actively watching. Both need a way to deliver results when the agent has something to say.

The key architectural decision: schedulers receive their delivery callbacks at construction time, not at invocation time. The daemon knows what delivery infrastructure exists when it boots. It wires that knowledge into the schedulers as closures. The schedulers never resolve delivery themselves — they call the functions they were given.

This eliminates the event bus for outbound delivery. There is no broadcast-and-filter. Each scheduler has a direct line to its delivery target, injected by the daemon.

## Delivery Callbacks

```
DeliveryCallbacks {
  deliverResponse: (agentId: string, threadId: string, text: string) => void
  deliverError: (agentId: string, threadId: string, error: string) => void
  deliverFile: (agentId: string, threadId: string, filePath: string, caption?: string, fileType?: FileType) => void
  deliverNote: (agentId: string, threadId: string, title: string, slug: string, message?: string) => void
  deliverPinChange: (agentId: string) => void
}
```

`DeliveryCallbacks` is the shape the daemon constructs for background callers. It is not an interface in Core — Core knows nothing about it. It exists at the daemon layer as the bridge between "agent wants to communicate" and "here's how communication works."

### Delivery Factory

The daemon constructs delivery callbacks per agent at boot time:

```
makeDeliveryCallbacks(agentId: string): DeliveryCallbacks
```

The factory closes over the daemon's channel infrastructure:
- Checks whether the agent has a dedicated Telegram bot (`telegramConfig.agentBots[agentId]`)
- If yes: uses the agent's bot instance and chatId
- If no: uses the main Nova bot and its chatId

This decision is static per agent — determined by workspace configuration at daemon startup. It does not change between invocations.

### Wiring to AgentRunnerCallbacks

The scheduler maps `DeliveryCallbacks` to `AgentRunnerCallbacks` when calling `runAgent`:

```
const delivery = makeDeliveryCallbacks(agentId)

runAgent(agentDir, threadId, prompt, {
  // Background: suppress onResponse (no live session)
  // onNotifyUser always delivers — that's its purpose
  onNotifyUser: (agentId, threadId, text) => delivery.deliverResponse(agentId, threadId, text),
  onFileSend: (agentId, threadId, filePath, caption, fileType) => delivery.deliverFile(agentId, threadId, filePath, caption, fileType),
  onShareNote: (agentId, threadId, title, slug, message) => delivery.deliverNote(agentId, threadId, title, slug, message),
  onPinChange: (agentId) => delivery.deliverPinChange(agentId),
}, { background: true })
```

Background runs suppress `onResponse` and `onError` — the user didn't ask for this run, so unsolicited responses are not delivered. Only `onNotifyUser` breaks through, which is the agent's explicit request to communicate something important.

## Trigger Scheduler

### Responsibility

Evaluates cron expressions for all agents every 60 seconds. When a trigger's cron matches, fires a new agent run with the trigger's prompt.

### Interface

```
startTriggerScheduler(
  makeDeliveryCallbacks: (agentId: string) => DeliveryCallbacks,
): { stop: () => void }
```

The scheduler receives a delivery factory — not delivery callbacks directly — because it iterates over all agents and needs per-agent delivery resolution.

### Execution Flow

```
1. Every 60 seconds, scan all agent directories
2. For each agent, load triggers.json
3. For each trigger, evaluate cron against current time (in trigger's timezone)
4. If cron matches and lastRun is before the previous match:
   a. Update lastRun, save triggers.json
   b. Create a new thread for this run
   c. Resolve delivery callbacks for this agent
   d. Call runAgent with the trigger's prompt, delivery callbacks, { background: true }
   e. Fire and forget — scheduler does not await the run
```

### Trigger Shape

```
Trigger {
  id: string            // random hex ID
  cron: string          // 5-field cron expression
  tz?: string           // IANA timezone (defaults to system timezone)
  prompt: string        // message sent to the agent
  lastRun?: string      // ISO timestamp of last firing
}
```

Triggers do not carry a `channel` field. Delivery routing is determined by the daemon's delivery factory at scheduler construction time, not stored per-trigger.

### Thread Creation

The trigger scheduler calls `createThread(agentDir, { taskId?: undefined })` to create a fresh thread for each firing. The scheduler does not stamp a channel on the thread — threads are channel-agnostic.

### Trigger MCP Server

The trigger capability (`createTriggerMcpServer`) allows agents to manage their own triggers. It no longer accepts a `channel` parameter — triggers are just cron + prompt pairs. The daemon resolves delivery when the trigger fires.

```
createTriggerMcpServer(agentDir): McpServerConfig
```

## Task Scheduler

### Responsibility

Periodically invokes agents to work on their active tasks. Runs hourly during waking hours (06:00–22:00 local time).

### Interface

```
startTaskScheduler(
  makeDeliveryCallbacks: (agentId: string) => DeliveryCallbacks,
): { stop: () => void, tick: () => Promise<void> }
```

Same pattern as trigger scheduler — receives a delivery factory, not hardcoded delivery logic.

### Execution Flow

```
1. On each tick (hourly), load all active tasks
2. Filter to agent-owned tasks (skip user-owned)
3. Skip tasks already in-flight
4. For each task:
   a. Ensure thread exists (create if missing)
   b. Resolve delivery callbacks for the task's owner
   c. Call runAgent with task work prompt, delivery callbacks, { background: true }
   d. Await completion (sequential — tasks are processed one at a time)
```

### Manual Triggering

```
runTaskNow(workspaceDir, taskId): string | null
```

Returns an error string or null on success. Uses the same delivery factory as the scheduler. Fire-and-forget — the caller gets immediate confirmation, not the task result.

## Episodic Backfill Scheduler

### Responsibility

Generates embeddings for threads that were created before the embedding model was available. Not delivery-related — included here because it's a timer-driven daemon concern.

### Interface

```
startEpisodicBackfillScheduler(): { stop: () => void }
```

No delivery callbacks needed — backfill is a pure Core operation with no user-facing output.

## What the Daemon Wires

At boot, the daemon:

1. Starts Telegram bots (main + per-agent)
2. Constructs `makeDeliveryCallbacks` closing over the bot instances
3. Passes the factory to `startTriggerScheduler` and `startTaskScheduler`
4. Starts the episodic backfill scheduler (no delivery needed)

```
// daemon/index.ts — conceptual shape
const { mainBot, agentBots } = startTelegramBots()

const makeDeliveryCallbacks = (agentId) => {
  const botConfig = telegramConfig.agentBots?.[agentId]
  const bot = botConfig ? agentBots[agentId] : mainBot
  const chatId = botConfig?.chatId ?? telegramConfig.chatId
  return {
    deliverResponse: (agentId, threadId, text) => sendMessage(bot, chatId, text),
    deliverFile: (agentId, threadId, filePath, ...) => sendFile(bot, chatId, filePath, ...),
    deliverNote: (agentId, threadId, ...) => sendNote(bot, chatId, ...),
    deliverPinChange: (agentId) => sendPinUpdate(bot, chatId, agentId),
    deliverError: (agentId, threadId, error) => sendMessage(bot, chatId, "Something went wrong."),
  }
}

startTriggerScheduler(makeDeliveryCallbacks)
startTaskScheduler(makeDeliveryCallbacks)
startEpisodicBackfillScheduler()
```

## What Dies

- *Event bus for outbound delivery.* The bus existed to decouple "who produces events" from "who consumes them." With callbacks injected at construction time, producers and consumers are wired directly. The indirection of broadcast-and-filter is eliminated.
- *`channel` field on triggers.* Triggers no longer decide where their output goes. The daemon decides, based on agent configuration, at boot time.
- *`channel` field on thread manifests.* Threads don't need to know their origin channel. The caller that created the thread already knows.
- *`updateThreadChannel()`.* No more channel migration. Threads are channel-agnostic.
- *The daemon runner wrapper (`daemon/runner.ts`).* Its only job was mapping callbacks to bus events. With no bus, callers wire callbacks directly to `core.runAgent`.

## Constraints

- Schedulers never import from channels. They call injected functions.
- Delivery resolution happens once at boot, not per-invocation.
- Background runs suppress `onResponse`/`onError`. Only `onNotifyUser` delivers to the user.
- `onFileSend`, `onShareNote`, `onPinChange` always deliver in background mode — these are explicit agent actions, not unsolicited chatter.
- Thread creation by schedulers does not stamp a channel. Threads are channel-agnostic.
- The delivery factory is the daemon's concern. Core never sees it.

## What Lives Here

- Trigger scheduler (cron evaluation, firing, thread creation)
- Task scheduler (periodic task invocation, in-flight tracking)
- Episodic backfill scheduler
- DeliveryCallbacks shape
- Delivery factory pattern (construction-time injection)

## What Does NOT Live Here

- Telegram bot management (channel implementation)
- Agent configuration (Agent Model spec)
- Task storage and lifecycle (Task spec)
- Thread internals (Thread Lifecycle spec)
- AgentRunner execution (Agent Runner spec)
