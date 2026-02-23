# Spec vs Implementation — Discrepancy Map

Status of each spec alignment as of 2026-02-23.

## Engine (`specs/engine.md`)

**No significant discrepancies.** Implementation matches spec cleanly.

## Agent Runner (`specs/agent-runner.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| R1 | First parameter | `agentId: string` | `agentDir: string` (extracts id internally) |
| R2 | Override field name | `background?: boolean` | `silent?: boolean` |
| R3 | Extra override field | not in spec | `systemPromptSuffix?: string` |
| R4 | Callback names | `onResponse`, `onError` | `onThreadResponse`, `onThreadError` |
| R5 | Extra parameter | not in spec | `extraMcpServers?: Record<string, McpServerConfig>` |
| R6 | No `resolveInjections()` | separate function | inline conditional in runner |

## Agent Model (`specs/agent-model.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| A1 | Legacy `role` field | not in spec (only `identity`) | `role?: string` still in AgentConfig |
| A2 | Protected agents | "all agents are equal" | `PROTECTED_AGENTS = new Set(["nova", "agent-builder"])` |

## Threads (`specs/threads.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| T1 | Manifest `agentId` | required field | optional (`agentId?: string`) |

## System Prompt Assembly (`specs/system-prompt-assembly.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| P1 | Builder params | no `trust` param | takes `trust: TrustLevel` as 3rd param |
| P2 | Extra section | not in spec | `<Security>` block based on trust level |
| P3 | Extra section | not in spec | `<Communication>` block (one question at a time) |
| P4 | Single assembler violated | builder is sole assembler | runner appends Task, Background, and systemPromptSuffix after builder returns |
| P5 | Builder options | `options?: { task?, silent? }` | no options param — runner injects these post-assembly |

## Capabilities (`specs/capabilities.md`)

| # | Discrepancy | Spec | Implementation |
|---|---|---|---|
| C1 | ResolverContext `manifest` | included in context | not in context |
| C2 | ResolverContext `agent` | required field | optional (`agent?`) |
| C3 | No `resolveInjections()` | separate function | inline in runner (same as R6) |

## Skills (`specs/skills.md`)

**No significant discrepancies.** Implementation matches spec cleanly.

## Refactoring Plan

Small incremental steps, each a single PR:

### Step 1: Rename `silent` → `background` in RunAgentOverrides
- **Resolves:** R2
- **Risk:** Low — pure rename

### Step 2: Rename `onThreadResponse` → `onResponse`, `onThreadError` → `onError`
- **Resolves:** R4
- **Risk:** Low — pure rename

### Step 3: Make `buildSystemPrompt()` the single assembler
- **Resolves:** P4, P5
- **Risk:** Medium — changes prompt assembly flow

### Step 4: Decide on `<Security>` and `<Communication>` sections
- **Resolves:** P1, P2, P3
- **Risk:** Needs design decision — update spec or remove sections

### Step 5: Extract `resolveInjections()` as a separate function
- **Resolves:** R6, C3
- **Risk:** Low — pure extraction

### Step 6: Clean up ResolverContext shape
- **Resolves:** C1, C2
- **Risk:** Low — additive type change

### Step 7: Remove legacy `role` field from AgentConfig
- **Resolves:** A1
- **Risk:** Medium — needs migration path for existing agents

### Step 8: Remove `PROTECTED_AGENTS` guard
- **Resolves:** A2
- **Risk:** Medium — users could accidentally delete default agents

### Step 9: Make `agentId` required in ThreadManifest
- **Resolves:** T1
- **Risk:** Low — already populated in practice

### Step 10: Evaluate `extraMcpServers` and `systemPromptSuffix`
- **Resolves:** R3, R5
- **Risk:** Needs design decision — update spec or remove from implementation
