# Trigger Store

## Problem

Trigger persistence is currently raw file I/O scattered across multiple files with duplicate implementations:
- `src/core/triggers.ts` — `loadTriggers(agentDir)` / `saveTriggers(agentDir, triggers)` + MCP server
- `src/api/console-triggers.ts` — duplicate `loadTriggers` / `saveTriggers` implementations
- `src/daemon/triggers.ts` — scheduler that scans `agents/*/` directories, loads triggers, fires cron jobs

Triggers live at `agents/{agentId}/triggers.json` — one JSON array per agent. There's no store abstraction, no single access layer, and the console API duplicates core logic. Cron validation is also duplicated across the MCP server and console API.

## Contract

`TriggerStore` is the single boundary for trigger CRUD operations. It abstracts storage implementation — consumers don't know whether triggers are stored in JSON files, databases, or memory.

```typescript
interface TriggerStore {
  list(agentId?: string): Trigger[]
  get(triggerId: string): Trigger | null
  create(agentId: string, input: TriggerInput): Trigger
  update(triggerId: string, partial: Partial<TriggerInput>): Trigger
  delete(triggerId: string): void
  deleteAllForAgent(agentId: string): void
}

interface TriggerInput {
  cron: string
  tz?: string
  prompt: string
  lastRun?: string
}
```

`Trigger` includes `agentId` as a field — every trigger knows which agent owns it.

### list(agentId?: string) → Trigger[]

Returns triggers. If `agentId` is provided, returns triggers for that agent only. If omitted, returns all triggers across all agents.

**Guarantees:**
- All triggers are valid (schema-validated)
- Every trigger includes `agentId`
- Returns empty array if no triggers match

**Does NOT guarantee:**
- Specific ordering
- Agent existence (caller's responsibility when `agentId` is provided)

**Use case (no agentId):** Scheduler needs to scan all agents every tick. Console GET `/` lists all triggers.

### get(triggerId: string) → Trigger | null

Returns a single trigger by ID, or `null` if not found.

**Guarantees:**
- Trigger is valid (schema-validated)
- Trigger includes `agentId`

**Why no `agentId` parameter:** Trigger IDs are globally unique (12-char hex). The current console API already does cross-agent scans to find triggers by ID for PATCH/DELETE. The store internalizes this scan.

### create(agentId: string, input: TriggerInput) → Trigger

Creates a new trigger for the given agent. Returns the created trigger with generated ID.

**Guarantees:**
- Trigger ID is unique across all agents
- Trigger ID format: `/^[a-f0-9]{12}$/` (12-char hex)
- Cron expression is validated before persistence
- `lastRun` is initialized to current timestamp (prevents firing on first scheduler tick)
- Returned trigger includes `agentId`

**Validation:**
- `cron` is a valid 5-field cron expression
- `prompt` is a non-empty string

**Failures:**
- Throws if cron expression is invalid
- Throws if prompt is empty

**Idempotency:** Not idempotent. Creates new ID each time.

### update(triggerId: string, partial: Partial<TriggerInput>) → Trigger

Updates trigger fields. Merges `partial` with existing trigger.

**Semantics:**
- `cron`, `tz`, `prompt`, and `lastRun` are updatable (not `id`, not `agentId`)
- If `cron` is provided, it is validated before persistence

**Failures:**
- Throws if trigger doesn't exist
- Throws if updated cron expression is invalid

**Idempotency:** Idempotent if `partial` matches current values.

### delete(triggerId: string) → void

Removes a single trigger by ID.

**Idempotency:** Idempotent (no-op if trigger doesn't exist).

### deleteAllForAgent(agentId: string) → void

Removes all triggers for an agent. Used during agent deletion cleanup.

**Idempotency:** Idempotent (no-op if agent has no triggers).

## Validation Rules

All implementations MUST validate:
- **Trigger ID format:** `/^[a-f0-9]{12}$/` (12-char hex, lowercase)
- **Cron expression:** Valid 5-field cron syntax (validated via `cron-parser`)
- **Prompt:** Non-empty string

Implementations MAY validate:
- **Agent existence:** Whether `agentId` exists in agent store
- **Timezone:** Whether `tz` is a valid IANA timezone

Validation failures MUST throw clear errors with the validation rule that failed.

## What the Store Does NOT Do

**Does NOT schedule cron jobs:**
- Cron scheduling is the scheduler's job (`src/daemon/triggers.ts`)
- Store only persists trigger config and `lastRun` timestamps

**Does NOT create MCP servers:**
- MCP tool registration is the capability layer's job
- Store is called by MCP tools, not the other way around

**Does NOT validate agent existence:**
- Caller's responsibility to check that `agentId` is valid
- Allows creating triggers for agents that are being set up

**Does NOT expose storage format:**
- JSON files? Database rows? Caller doesn't know.
- File paths, directory structures are internal

**Does NOT apply defaults:**
- `tz` is optional — caller or scheduler applies system timezone fallback
- Store writes exactly what it receives

## Current Consumers

| Consumer | Current approach | Store methods needed |
|----------|-----------------|---------------------|
| `src/core/triggers.ts` (MCP server) | `loadTriggers(agentDir)` / `saveTriggers(agentDir, ...)` | `list`, `create`, `update`, `delete` |
| `src/daemon/triggers.ts` (scheduler) | Scans all agent dirs, loads triggers, saves lastRun | `list` (no agentId), `update` (lastRun) |
| `src/api/console-triggers.ts` (console API) | Duplicate load/save, scans all agents | `list`, `get`, `create`, `update`, `delete` |
| `src/core/agents/store.ts` (agent deletion) | `fs.rmSync(agentDir)` removes triggers implicitly | `deleteAllForAgent` |

## Thread Safety

Implementations MUST be safe for:
- **Concurrent reads:** Multiple `get()`, `list()` calls in parallel
- **Read during write:** Reading agent A's triggers while writing agent B's

Implementations MAY NOT be safe for:
- **Concurrent writes to same agent's triggers:** Two `create()` calls for same agent
- **Read-modify-write without locking:** Caller must handle optimistic concurrency

## Deletion Test

Can you delete the trigger store implementation and regenerate it from this spec in < 2 hours?

If yes, the boundary is real. If no, the contract is incomplete or the coupling is too tight.

## Open Questions

### Should `create()` accept an explicit `id`?

**Current:** ID is always generated by the store (12-char hex via `randomBytes(6)`).

**Alternative:** Allow callers to pass an ID (for import/migration).

**Decision:** No. Store generates IDs. Import scenarios can be handled separately.

### Should `delete()` throw or no-op for missing triggers?

**Decision:** Idempotent (no-op). Delete is called defensively (cleanup code).

## Success Criteria

This boundary is successful if:

1. **Cloud deployment is trivial:** Implement new store, swap at startup, done
2. **No duplicate I/O code:** Console API and MCP server use the same store
3. **Cron validation in one place:** Store validates, callers don't
4. **Tests don't need filesystem:** Trigger logic testable with in-memory implementation
5. **Implementation is replaceable:** Can delete and regenerate from spec in < 2 hours
6. **Calling code is simpler:** No path construction, no JSON parsing, no cross-agent scanning

If adding `TriggerStore` makes code MORE complex or HARDER to change, the abstraction has failed.
