# Agent Storage

## Problem

Agent loading and persistence is currently scattered across multiple files with direct filesystem dependencies:
- `agents/io.ts` — reads/writes `agent.json` files
- `agents/agents.ts` — directory resolution, agent loading
- `skills.ts` — imports `readAgentJson/writeAgentJson` directly
- Daemon commands — construct paths, call functions ad-hoc

This makes cloud deployment impossible. Everything assumes local filesystem with `agent.json` files. There's no single contract for "how do I get an agent?"

## Contract

`AgentStore` is the single boundary for agent CRUD operations. It abstracts storage implementation — consumers don't know whether agents are stored in directories, databases, or memory.

```typescript
interface AgentStore {
  // Reads
  list(): Map<string, AgentConfig>
  get(id: string): AgentConfig | null

  // Writes
  create(id: string, config: AgentJson): void
  update(id: string, partial: Partial<AgentJson>): void
  delete(id: string): void
}
```

### list() → Map<string, AgentConfig>

Returns all agents in the workspace. Agent ID is the map key.

**Guarantees:**
- Returns a snapshot (callers can't mutate the store's internal state)
- All agents are valid (schema-validated)
- IDs match the map keys

**Does NOT guarantee:**
- Consistent view across multiple calls (agents may be added/removed between calls)
- Specific ordering

### get(id: string) → AgentConfig | null

Returns a single agent by ID, or `null` if not found.

**Guarantees:**
- If found, the agent is valid (schema-validated)
- `config.id === id`
- `config.trust` is defined (no undefined trust levels)

**Does NOT materialize:**
- Skills (`.claude/skills/` is not created)
- Directories (paths are not validated)
- Threads (agent data is separate from runtime state)

### create(id: string, config: AgentJson) → void

Creates a new agent.

**Validation:**
- Agent ID matches `/^[a-z0-9][a-z0-9-]*$/`
- Config validates against `AgentJsonSchema`
- `trust` field is required
- Skills in `config.skills` exist in library (optional enforcement, see below)

**Failures:**
- Throws if ID already exists
- Throws if ID format invalid
- Throws if config schema invalid
- Implementation-specific: may throw if skill validation enabled and skill missing

**Idempotency:** Not idempotent. Creating twice fails.

### update(id: string, partial: Partial<AgentJson>) → void

Updates agent fields. Merges `partial` with existing config and validates the result.

**Semantics:**
- Shallow merge: `{ ...existing, ...partial }`
- Full validation after merge (merged config must pass schema)
- Array fields are replaced, not merged (e.g., `skills: ["new"]` replaces entire array)

**Failures:**
- Throws if agent doesn't exist
- Throws if merged result fails schema validation
- Implementation-specific: may throw if skill validation enabled and skill missing

**Idempotency:** Idempotent if `partial` matches current values.

### delete(id: string) → void

Removes an agent.

**Semantics:**
- Deletes agent config
- Implementation may or may not delete agent's runtime data (threads, embeddings, etc.)
- Filesystem implementation deletes entire `agents/{id}/` directory
- Database implementation may soft-delete or cascade

**Idempotency:** Idempotent (no-op if agent doesn't exist).

## Validation Rules

All implementations MUST validate:
- **Agent ID format:** `/^[a-z0-9][a-z0-9-]*$/`
- **Config schema:** Via `AgentJsonSchema`
- **Trust level:** Required (no default applied by store)

Implementations MAY validate:
- **Skill existence:** Whether skills in `config.skills` exist in library
- **Directory existence:** Whether paths in `config.directories` are valid
- **Capability names:** Whether capabilities are registered

Validation failures MUST throw clear errors with the validation rule that failed.

## What the Store Does NOT Do

**Does NOT materialize skills:**
- Skills are materialized separately by `materializeSkills()`
- Store only persists the `skills: []` array
- Materialization happens before agent invocation (not during read)

**Does NOT manage threads:**
- Agent config is separate from agent runtime data
- Deleting agent MAY delete associated threads (implementation choice)

**Does NOT validate directories:**
- Directory paths are stored as strings
- Validation happens at runtime (when directories are actually used)
- Store doesn't expand `~` or check existence

**Does NOT manage capabilities:**
- Capability names are stored as strings
- Resolution happens at runtime (via capability registry)
- Store doesn't check if capabilities exist

**Does NOT apply defaults:**
- Store writes exactly what it receives
- Defaults applied by agent runner or calling code
- Exception: `trust` has no default (caller must provide)

## Thread Safety

Implementations MUST be safe for:
- **Concurrent reads:** Multiple `get()` or `list()` calls in parallel
- **Read during write:** Reading agent A while writing agent B

Implementations MAY NOT be safe for:
- **Concurrent writes to same agent:** Two `update()` calls for same ID
- **Read-modify-write without locking:** Caller must handle optimistic concurrency

## Deletion Test

Can you delete the agent storage implementation and regenerate it from this spec in < 2 hours?

If yes, the boundary is real. If no, the contract is incomplete or the coupling is too tight.

## Open Questions

### Should `update()` support patch semantics (partial array updates)?

**Current:** Arrays are replaced entirely (`skills: ["new"]` replaces whole array)

**Alternative:** Support append/remove operations (`{ skills: { add: ["x"], remove: ["y"] } }`)

**Decision:** Start simple (full replacement). Add patch semantics if needed.

### Should `create()` validate skill existence?

**Current:** No validation (lazy — fails at materialization)

**Alternative:** Validate immediately (fail fast)

**Decision:** No validation in store. Skills are validated at materialization time. Allows creating agents that reference skills not yet in library.

### Should `delete()` remove agent runtime data?

**Decision:** Implementation-specific. Store MAY delete threads, embeddings, etc. Store MAY preserve for audit/recovery.

### Should store handle skill materialization?

**Decision:** No. Materialization is separate from storage. Store persists config, runtime materializes skills before invocation.

## Success Criteria

This boundary is successful if:

1. **Cloud deployment is trivial:** Implement new store, swap at startup, done
2. **Tests don't need filesystem:** Agent logic testable with in-memory implementation
3. **Implementation is replaceable:** Can delete and regenerate from spec in < 2 hours
4. **Calling code is simpler:** No path construction, no storage-specific imports

If adding `AgentStore` makes code MORE complex or HARDER to change, the abstraction has failed.
