# Threads

## Contract

`Threads` is the single boundary for thread CRUD, event logging, and episodic search. It abstracts storage implementation — consumers don't know whether threads are in JSONL files, SQLite, or Postgres.

```typescript
interface Threads {
  // CRUD
  create(agentId: string, opts?: ThreadCreateOpts): string
  get(threadId: string): ThreadManifest | null
  list(agentId: string): ThreadManifest[]
  delete(threadId: string): void

  // Events
  appendMessage(threadId: string, msg: ThreadMessage): Promise<void>
  appendEvent(threadId: string, event: ThreadEvent): Promise<void>
  loadEvents(threadId: string): ThreadEvent[]


  updateManifest(threadId: string, partial: Partial<ThreadManifest>): void

  // Search (episodic memory)
  search( query: string, opts?: SearchOptions): Promise<SearchResult[]>

  // Backfill (indexing)
  backfill(): Promise<BackfillResult>
}

interface SearchOptions {
  agentId?: string
  limit?: number          // Max results (default 5)
  contextWindow?: number  // Messages around match (default 3)
}

interface SearchResult {
  threadId: string
  threadTitle: string
  timestamp: string
  score: number
  messages: SearchResultMessage[]
}

interface BackfillResult {
  embedded: number  // New messages indexed
  cleaned: number   // Orphaned embeddings removed
}
```

### create(agentId: string, opts?: CreateThreadOptions) → string

Creates a new thread for the given agent. Returns globally unique thread ID (12-char hex).

**Guarantees:**
- Thread ID is unique across all agents
- Thread ID format: `/^[a-f0-9]{12}$/`
- Manifest includes agentId
- Manifest is initialized with `createdAt` and `updatedAt`
- If `opts.taskId` provided, it's stored in manifest

**Does NOT guarantee:**
- Sequential IDs (IDs are random)
- Specific ID generation algorithm (implementation detail)

**Idempotency:** Not idempotent. Creates new ID each time.

### get(threadId: string) → ThreadManifest | null

Returns thread metadata by ID. Thread ID is globally unique, so no `agentId` parameter needed.

**Guarantees:**
- Manifest is valid (schema-validated)
- Returns `null` if thread doesn't exist

**Does NOT load:**
- Events/messages (use `loadEvents()` for that)
- Embeddings (internal to search implementation)

### list(agentId: string) → ThreadManifest[]

Returns all threads for a given agent.

**Guarantees:**
- All manifests are valid (schema-validated)

**Does NOT guarantee:**
- Specific ordering (implementation may sort by `updatedAt`, creation time, etc.)
- Consistent view across calls (threads may be created/deleted between calls)

### delete(threadId: string) → void

Deletes a thread and all associated data.

**Semantics:**
- Deletes manifest and events
- Implementation SHOULD delete associated embeddings
- Implementation MAY preserve for audit/recovery

**Idempotency:** Idempotent (no-op if thread doesn't exist).

### appendMessage(threadId: string, msg: ThreadMessage) → Promise<void>

Appends a user or assistant message to the thread.

**Guarantees:**
- Message is persisted before promise resolves
- Concurrent appends to same thread are serialized (no interleaving)
- Updates `manifest.updatedAt`

**Does NOT guarantee:**
- Synchronous return (implementation may be async for network/indexing)
- Message is immediately searchable (backfill may be required)

**Thread safety:** Safe for concurrent appends to different threads. Appends to same thread are serialized.

### appendEvent(threadId: string, event: ThreadEvent) → Promise<void>

Appends a tool use, assistant text, or result event to the thread.

**Guarantees:**
- Event is persisted before promise resolves
- Concurrent appends to same thread are serialized
- Updates `manifest.updatedAt`

**Does NOT index:**
- Tool use events are logged but not searchable (search only indexes messages)

### loadEvents(threadId: string) → ThreadEvent[]

Loads all events (messages, tool uses, assistant text, results) from a thread.

**Guarantees:**
- Events returned in append order
- Both messages and non-message events included
- Empty array if thread doesn't exist

**Does NOT guarantee:**
- Events are cached (implementation may read from disk/network each time)

### getManifest(threadId: string) → ThreadManifest | null

Returns just the manifest (metadata) for a thread.

**Guarantees:**
- Manifest is valid (schema-validated)
- Returns `null` if thread doesn't exist

**Use case:** When you need thread title, timestamps, or custom metadata without loading all events.

### updateManifest(threadId: string, partial: Partial<ThreadManifest>) → void

Updates thread manifest fields.

**Semantics:**
- Shallow merge: `{ ...existing, ...partial }`
- Updates `updatedAt` automatically
- Array fields are replaced, not merged

**Failures:**
- Throws if thread doesn't exist
- Throws if merged result fails schema validation

**Idempotency:** Idempotent if `partial` matches current values.

### search(agentId: string, query: string, opts?: SearchOptions) → Promise<SearchResult[]>

Searches past conversations for this agent using natural language query.

**Guarantees:**
- Results sorted by relevance (highest score first)
- Results deduplicated by thread (one hit per thread, even if multiple messages match)
- Each result includes ±N context messages around the match (default N=3)
- Returns empty array if no matches or embeddings not available

**Does NOT guarantee:**
- Immediate availability of recently appended messages (may require backfill)
- Specific scoring algorithm (cosine similarity today, could be BM25 tomorrow)
- Cross-agent search (always scoped to single agent)

**Search scope:** Only searches user and assistant messages. Tool use events, assistant text fragments, and result events are not indexed.

**Performance:** Implementation may cache embeddings, use vector indexes, or pre-compute similarities. Calling code doesn't care.

### backfill(agentId: string) → Promise<BackfillResult>

Ensures all messages are indexed for search. Fills gaps and cleans orphans.

**Semantics:**
- Scans all threads for agent
- Generates embeddings for any un-indexed messages
- Removes embeddings for threads that no longer exist
- Returns counts of newly indexed and cleaned records

**Idempotency:** Idempotent. Safe to run repeatedly. Only indexes what's missing.

**Performance:** Expensive for large agents (hundreds of threads). Implementations should support incremental indexing.

**When to call:**
- On agent initialization (if search is enabled)
- After bulk operations (importing old threads)
- Periodically in background (cron job)
- Never required for correctness (search may return stale results, but won't break)

## Validation Rules

All implementations MUST validate:
- **Thread ID format:** `/^[a-f0-9]{12}$/` (12-char hex, lowercase)
- **Manifest schema:** Via `ThreadManifestSchema`
- **Message roles:** Only `"user"` or `"assistant"` allowed in messages
- **Event types:** Only valid `ThreadEvent` types (message, tool_use, assistant_text, result)

Implementations MAY validate:
- **Agent existence:** Whether `agentId` exists in agent store
- **Task existence:** Whether `taskId` in manifest exists in task store
- **Timestamp format:** Whether timestamps are valid ISO 8601

Validation failures MUST throw clear errors with the validation rule that failed.

## What the Store Does NOT Do

**Does NOT manage agents:**
- Agent config is separate from thread storage
- Deleting agent MAY delete associated threads (implementation choice)
- Store doesn't validate agent existence (caller's responsibility)

**Does NOT expose storage format:**
- JSONL files? Database rows? S3 objects? Caller doesn't know.
- Embeddings format is internal (dimensionality, normalization, storage)
- Event serialization is internal (JSON lines today, Protobuf tomorrow)

**Does NOT expose search internals:**
- Embedding model (MiniLM today, OpenAI tomorrow, FTS later)
- Similarity algorithm (cosine today, BM25 tomorrow)
- Index structure (in-memory today, Qdrant tomorrow)
- Context window logic (fixed N today, semantic chunks tomorrow)

**Does NOT handle concurrency between processes:**
- Single-process thread safety is guaranteed (via locks)
- Multi-process coordination is not (use distributed locks if needed)

**Does NOT auto-backfill:**
- Search returns results based on current index state
- Caller must explicitly call `backfill()` to ensure freshness
- Implementation MAY auto-backfill on first search (but not required)

## Thread Safety

Implementations MUST be safe for:
- **Concurrent reads:** Multiple `get()`, `list()`, `loadEvents()` calls in parallel
- **Read during write:** Reading thread A while appending to thread B
- **Concurrent appends to different threads:** No serialization across threads
- **Concurrent appends to same thread:** Serialized via per-thread lock (no interleaving)

Implementations MAY NOT be safe for:
- **Concurrent manifest updates to same thread:** Two `updateManifest()` calls may clobber
- **Concurrent search + backfill:** Backfill may modify index while search is reading

## Deletion Test

Can you delete the thread storage implementation and regenerate it from this spec in < 2 hours?

**For JSONL + embeddings implementation:** Yes, if you have:
- This spec
- The interface definitions
- Access to `threads.ts` and `episodic/` as reference (but not as dependency)

**For SQLite + FTS implementation:** Yes, if you have:
- This spec
- Schema design (threads table, events table, fts5 virtual table)
- No dependencies on old implementation

If no, the contract is incomplete or the coupling is too tight.

## Open Questions

### Should search be synchronous or async?

**Current:** `async` — embedding generation and similarity search take time

**Alternative:** Synchronous with pre-built index (fails if index not ready)

**Decision:** Async. Allows implementations to generate query embedding, hit vector DB, etc. Caller uses `await`.

### Should backfill be automatic on first search?

**Current:** Manual — caller must run `backfill()` explicitly

**Alternative:** Auto-backfill on first search (lazy initialization)

**Decision:** Manual. Keeps `search()` predictable and fast. Backfill is expensive (hundreds of threads). Caller controls when it happens.

### Should `appendMessage` auto-index for search?

**Current:** No — messages are only indexed during `backfill()`

**Alternative:** Auto-index on append (real-time search)

**Decision:** No auto-index. Keeps `appendMessage` fast and simple. Implementations MAY add this as an opt-in feature, but it's not part of the contract.

### Should search support cross-agent queries?

**Current:** No — search is always scoped to `agentId`

**Alternative:** Add `searchAll(query, opts)` for workspace-wide search

**Decision:** Not yet. Start with single-agent search. Add cross-agent search if needed.

### Should store expose "find thread by ID across all agents"?

**Current:** No — caller must know `agentId` to use `list()`

**Alternative:** Add `findThread(threadId)` that searches all agents (like current `findThread()` in threads.ts)

**Decision:** Add it. Thread IDs are globally unique, so lookups shouldn't require `agentId`. This is different from `get()` because `get()` returns full thread with manifest, while `findThread()` is a utility for locating which agent owns a thread.

Actually, reviewing the interface: `get(threadId)` already handles this. It returns `ThreadWithAgentId`, which includes `agentId`. So no separate `findThread()` needed.

## Success Criteria

This boundary is successful if:

1. **Cloud deployment is trivial:** Implement `PostgresThreadStore`, swap at startup, done
2. **Search implementation is swappable:** Swap embeddings → FTS → cloud vector DB without touching callers
3. **Tests don't need filesystem:** Thread logic testable with in-memory implementation
4. **Implementation is replaceable:** Can delete and regenerate from spec in < 2 hours
5. **Calling code is simpler:** No path construction, no JSONL manipulation, no direct embedding imports

If adding `ThreadStore` makes code MORE complex or HARDER to change, the abstraction has failed.

