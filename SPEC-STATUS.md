# Spec vs Implementation — Discrepancy Map

Status of each spec alignment as of 2026-02-23.

## Engine (`specs/engine.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| E1 | SubagentConfig undefined | `agents?: Record<string, SubagentConfig>` | type is inlined; spec never defines SubagentConfig |
| E2 | Sandbox trust table wrong | "None (no files, no web, no bash)" | sandbox allows `WebSearch`, `WebFetch`, `Skill`, `Task`, `TaskOutput` + MCP tools |
| E3 | Controlled allowedTools | only `disallowedTools: ["Bash"]` | also sets `allowedTools: STANDARD_ALLOWED_TOOLS` (whitelist + blacklist) |
| E4 | SDK boundary claim | "no other layer imports the AI SDK" | 17+ files import `@anthropic-ai/claude-agent-sdk` (capabilities, MCP factories, agent-management, daemon/runner) |

Note on E4: most violations are type-only imports (`McpServerConfig`, `tool()`) for MCP server construction. The spec's claim is aspirational — isolating all SDK usage to Engine would require a major refactor of the MCP factory pattern.

## Agent Runner (`specs/agent-runner.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| R1 | First parameter | `agentId: string` | `agentDir: string` (extracts id internally) |
| R5 | Extra parameter | not in spec | `extraMcpServers?: Record<string, McpServerConfig>` — actively used for trigger MCP injection |
| R7 | Parameter order | `(agentId, threadId, message, callbacks?, overrides?, abortController?)` | `(agentDir, threadId, message, callbacks?, extraMcpServers?, askAgentDepth?, abortController?, overrides?)` |
| R8 | resolveInjections signature | `resolveInjections(overrides, context)` | `resolveInjections(context, options?)` — parameter order inverted |
| R9 | Ask-agent recursion shape | passes `{ background: overrides?.background }` | passes full `overrides` object |

## Agent Model (`specs/agent-model.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| A3 | create_agent tool description | should say "trust field" | says "security field" |

## Threads (`specs/threads.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| T2 | `taskId` not in schema | `taskId?: string` in spec | not in `ThreadManifestSchema`, passes through via `.passthrough()` |

## System Prompt Assembly (`specs/system-prompt-assembly.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| P6 | Options field name | `silent?: boolean` | `background?: boolean` |

## Capabilities (`specs/capabilities.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| C4 | Extra context field | not in spec | `channel: string` in ResolverContext |
| C5 | Run-time injection naming | `silent: true` | `background: true` |

## Skills (`specs/skills.md`)

**No significant discrepancies.** Implementation matches spec cleanly.

Extra: `nova skills delete` CLI command exists — operation is in spec but not explicitly as a CLI command.

## System Overview (`specs/system.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| S1 | Data layout: `instructions.md` | spec says instructions in separate `.md` file | stored as field in `agent.json` |
| S2 | Data layout: thread manifest | spec shows `{thread-id}.json` separate from `.jsonl` | manifest is first line of `.jsonl` (no separate file) |
| S3 | Data layout: tasks storage | spec shows `active.json` + `history/` directory | code uses `tasks.json` + `history.jsonl` |
| S4 | Agent optionality | spec shows `identity` and `instructions` as required | both are optional in `AgentConfig` |
| S5 | Agent extra fields | not in spec | `description` and `allowedAgents` fields exist on disk |
| S6 | Thread extra fields | not in spec | `agentId`, `createdAt`, `updatedAt` in manifest (agentId now documented in threads spec) |
| S7 | Layer boundary | "layers only talk to neighbors" | channels import directly from `#core/index.js`, skipping daemon |
| S8 | Spec index status | shows "System Prompt Assembly: TODO" | spec exists and is done |

---

## Remaining Open Items

### Spec-needs-update (implementation is correct, spec is stale)

| ID | Spec | What to update |
|---|---|---|
| P6 | system-prompt-assembly | `silent` → `background` in options |
| C4 | capabilities | Add `channel: string` to ResolverContext |
| C5 | capabilities | `silent` → `background` in run-time injection description |
| R5 | agent-runner | Document `extraMcpServers` parameter (used for trigger injection) |
| R8 | agent-runner | Fix `resolveInjections` signature to match implementation |
| S1 | system | `instructions.md` → field in `agent.json` |
| S2 | system | Thread manifest is first line of `.jsonl`, not separate file |
| S3 | system | Tasks use `tasks.json` + `history.jsonl` |
| S8 | system | Mark System Prompt Assembly spec as DONE |

### Code-needs-update (spec is correct, code should change)

| ID | Spec | What to fix |
|---|---|---|
| R1 | agent-runner | Consider `agentId` parameter instead of `agentDir` |
| R7 | agent-runner | Consider cleaning up parameter order to match spec |
| R9 | agent-runner | Pass `{ background }` only, not full overrides, in ask-agent recursion |
| T2 | threads | Add `taskId` to `ThreadManifestSchema` explicitly |
| A3 | agent-model | Fix create_agent tool description: "security" → "trust" |

### Design decisions needed

| ID | Spec | Question |
|---|---|---|
| E1 | engine | Define `SubagentConfig` type in spec, or leave as implementation detail? |
| E2-E3 | engine | Update trust level table to match actual SDK permission mapping |
| E4 | engine | Acknowledge MCP factories import SDK, or refactor to isolate? |
| S4 | system | Should `identity`/`instructions` be required or optional? |
| S5 | system | Document `description` field in system spec Agent shape |
| S7 | system | Channels importing Core directly — refactor or accept? |
