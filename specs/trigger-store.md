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
  // Per-agent
  list(agentId: string): Trigger[]
  create(agentId: string, input: TriggerInput): Trigger
  deleteAllForAgent(agentId: string): void

  // Cross-agent
  listAll(): Map<string, Trigger[]>
  get(triggerId: string): (Trigger & { agentId: string }) | null

  // Mutations by trigger ID
  update(triggerId: string, partial: Partial<TriggerInput>): Trigger
  delete(triggerId: string): void
  setLastRun(triggerId: string, timestamp: string): void
}

interface TriggerInput {
  cron: string
  tz?: string
  prompt: string
}
```

### list(agentId: string) → Trigger[]

Returns all triggers for a given agent.

**Guarantees:**
- All triggers are valid (schema-validated)
- Returns empty array if agent has no triggers

**Does NOT guarantee:**
- Specific ordering
- Agent existence (caller's responsibility)

### create(agentId: string, input: TriggerInput) → Trigger

Creates a new trigger for the given agent. Returns the created trigger with generated ID.

**Guarantees:**
- Trigger ID is unique across all agents
- Trigger ID format: `/^[a-f0-9]{12}$/` (12-char hex)
- Cron expression is validated before persistence
- `lastRun` is initialized to current timestamp (prevents firing on first scheduler tick)

**Validation:**
- `cron` is a valid 5-field cron expression
- `prompt` is a non-empty string

**Failures:**
- Throws if cron expression is invalid
- Throws if prompt is empty

**Idempotency:** Not idempotent. Creates new ID each time.

### deleteAllForAgent(agentId: string) → void

Removes all triggers for an agent. Used during agent deletion cleanup.

**Idempotency:** Idempotent (no-op if agent has no triggers).

### listAll() → Map<string, Trigger[]>

Returns all triggers across all agents. Map key is agent ID, value is that agent's triggers.

**Guarantees:**
- All triggers are valid (schema-validated)
- Agents with no triggers are omitted from the map

**Use case:** Scheduler needs to scan all agents every tick. Console GET `/` lists all triggers.

### get(triggerId: string) → (Trigger & { agentId: string }) | null

Returns a single trigger by ID with its owning agent ID, or `null` if not found.

**Guarantees:**
- Trigger is valid (schema-validated)
- `agentId` identifies which agent owns this trigger

**Why no `agentId` parameter:** Trigger IDs are globally unique (12-char hex). The current console API already does cross-agent scans to find triggers by ID for PATCH/DELETE. The store internalizes this scan.

### update(triggerId: string, partial: Partial<TriggerInput>) → Trigger

Updates trigger fields. Merges `partial` with existing trigger.

**Semantics:**
- Only `cron`, `tz`, and `prompt` are updatable (not `id`, not `lastRun`)
- If `cron` is provided, it is validated before persistence

**Failures:**
- Throws if trigger doesn't exist
- Throws if updated cron expression is invalid

**Idempotency:** Idempotent if `partial` matches current values.

### delete(triggerId: string) → void

Removes a single trigger by ID.

**Idempotency:** Idempotent (no-op if trigger doesn't exist).

### setLastRun(triggerId: string, timestamp: string) → void

Updates the `lastRun` timestamp for a trigger. Separated from `update()` because this is a scheduler-internal operation, not a user-facing update.

**Guarantees:**
- Timestamp is persisted before return

**Failures:**
- Throws if trigger doesn't exist

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
| `src/daemon/triggers.ts` (scheduler) | Scans all agent dirs, loads triggers, saves lastRun | `listAll`, `setLastRun` |
| `src/api/console-triggers.ts` (console API) | Duplicate load/save, scans all agents | `list`, `listAll`, `get`, `create`, `update`, `delete` |
| `src/core/agents/store.ts` (agent deletion) | `fs.rmSync(agentDir)` removes triggers implicitly | `deleteAllForAgent` |

## Thread Safety

Implementations MUST be safe for:
- **Concurrent reads:** Multiple `get()`, `list()`, `listAll()` calls in parallel
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

### Should `setLastRun()` be part of `update()`?

**Current:** Separate method.

**Alternative:** Allow `update(triggerId, { lastRun: "..." })` as a general field update.

**Decision:** Separate. `setLastRun()` is a scheduler-internal operation with different semantics (no validation of user-facing fields, no cron re-validation). Keeping it separate makes the intent clear and avoids exposing `lastRun` as a user-updatable field.

### Should `delete()` and `setLastRun()` throw or no-op for missing triggers?

**Current decision:** `delete()` is idempotent (no-op). `setLastRun()` throws (scheduler bug if trigger is missing).

**Rationale:** Delete is called defensively (cleanup code). `setLastRun` should only be called for triggers that just matched a cron expression — if the trigger is gone, something is wrong.

## Success Criteria

This boundary is successful if:

1. **Cloud deployment is trivial:** Implement new store, swap at startup, done
2. **No duplicate I/O code:** Console API and MCP server use the same store
3. **Cron validation in one place:** Store validates, callers don't
4. **Tests don't need filesystem:** Trigger logic testable with in-memory implementation
5. **Implementation is replaceable:** Can delete and regenerate from spec in < 2 hours
6. **Calling code is simpler:** No path construction, no JSON parsing, no cross-agent scanning

If adding `TriggerStore` makes code MORE complex or HARDER to change, the abstraction has failed.
