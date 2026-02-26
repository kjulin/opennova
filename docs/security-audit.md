# Security Audit — Pre-publish Review

Conducted 2025-02-02 before making the repository public and publishing to npm.

## Threat Model

OpenNova is a single-user daemon that runs on the user's own machine. The trust boundary is **terminal access** — anyone who can access the terminal where the daemon runs has full control. The Telegram channel is locked to a single chat ID configured during setup.

The primary risks are:
1. Agents exceeding their intended access level (privilege escalation)
2. Sensitive data leaking through logs, config commands, or file permissions
3. Data flowing through third-party services (Anthropic API, Telegram)
4. Autonomous execution without human oversight (cron triggers)

## Issues Found and Fixed

### 1. Agent-builder could escalate agent permissions

**Severity: HIGH** — Fixed

The agent-builder agent had `standard` security with `cwd: "agents"`, giving it direct file system access to every agent's `agent.json`. It could write `"security": "unrestricted"` to any agent — a privilege escalation that didn't require terminal access.

**Fix:** Agent-builder now runs in `sandbox` mode (no file/shell access) and manages agents through a controlled MCP server (`agent-management.ts`) that:
- Never accepts a `security` field — security levels can only be changed via CLI
- Prevents modification or deletion of protected agents (`nova`, `agent-builder`)
- Validates agent IDs against `/^[a-z0-9][a-z0-9-]*$/`
- Constructs all file paths server-side from the workspace directory

The `agent-writer` subagent was removed entirely.

### 2. `nova config get` leaked sensitive values

**Severity: HIGH** — Fixed

`nova config get telegram.token` printed the full bot token to stdout without masking. The `config list` command correctly masked sensitive keys, but `config get` bypassed this.

**Fix:** The `get` subcommand now applies the same masking logic as `list`, using the shared `SENSITIVE_KEYS` set.

### 3. `telegram.json` written with world-readable permissions

**Severity: MEDIUM** — Fixed

`telegram.json` contains the Telegram bot token but was written with default file permissions (0o644) in both `init.ts` and `telegram.ts`.

**Fix:** Both write sites now use `{ mode: 0o600 }`.

### 4. Full user prompts logged to console

**Severity: MEDIUM** — Fixed

`claude.ts` logged the complete user prompt in every execution: `running with prompt: "${prompt}"`. This could expose sensitive information in terminal scrollback or log files.

**Fix:** The prompt was removed from the log line entirely. Only security level and session ID are logged.

### 5. Error objects logged without sanitization

**Severity: LOW** — Fixed

Several locations dumped full error objects to console:
- `claude.ts` — `JSON.stringify(message, null, 2)` on SDK errors
- `telegram.ts` — `console.error("claude error:", err)`

Full error objects can contain stack traces with file paths, API responses, or other sensitive context.

**Fix:** Changed to log `err.message` / error summary only.

### 6. Source maps published to npm

**Severity: LOW** — Fixed

`tsconfig.json` had `sourceMap: true` and `declarationMap: true`, causing `.js.map` and `.d.ts.map` files to ship in the npm package. While not a direct security risk, this added unnecessary bloat and revealed source structure.

**Fix:** Disabled both options. Declaration files (`.d.ts`) still ship for TypeScript consumers.

## Inherent Risks (Documented, Not Fixable)

These are inherent to the architecture and documented in the Security sections of both READMEs.

### Data flows through third-party services

All conversations go through Anthropic's API via the Claude Agent SDK. Telegram bot messages are not end-to-end encrypted — Telegram's E2E encryption only applies to "secret chats," which bots cannot use. If an agent reads sensitive files, that content transits through these services.

**Mitigation:** Documented in README. Users should not run agents on machines with data they aren't prepared to expose.

### Unrestricted agents have full OS-level access

An agent with `unrestricted` security has full shell access running as the daemon's OS user. There is no confirmation step for destructive actions. A misinterpreted prompt could lead to data loss or system modification.

**Mitigation:** Security levels give users explicit control. The default is `standard` (no shell). Users must consciously opt into `unrestricted` via CLI.

### Cron triggers execute autonomously

Scheduled triggers run prompts without human approval. Combined with `unrestricted` security, this means an agent can run shell commands on a timer with no one watching.

**Mitigation:** Documented in README. Triggers are managed per-agent and can be disabled. Users should be cautious combining triggers with `unrestricted` security.

### Local processes can influence agent behavior

Any software running as the same OS user can modify workspace files (`~/.nova/`), including agent configurations, triggers, and memories. OpenNova amplifies the impact of local compromise — a modified trigger on an unrestricted agent becomes an intelligent, persistent executor.

**Mitigation:** Documented in README. This is inherent to any user-space daemon. File permissions on the workspace directory provide standard OS-level protection.

### No audit trail

When agents execute tools (shell commands, file operations), there is no persistent audit log beyond the conversation thread. If an agent does something destructive, reconstructing what happened may be difficult.

**Mitigation:** None currently. Could be addressed in a future release with structured action logging.

## npm Publishing Safety

- Root `package.json` is marked `"private": true` — prevents accidental publishing of the monorepo root
- The daemon's `"files"` field includes only `dist/` and `workspace-template/` — no source code, config files, or secrets
- Workspace template contains no sensitive data — only agent role definitions
- No postinstall or lifecycle scripts that execute code on the user's machine (only `prepublishOnly: "npm run build"`)
- Dependencies are all well-known packages: `@anthropic-ai/claude-agent-sdk`, `grammy`, `cron-parser`, `zod`
- `.gitignore` covers `node_modules/`, `dist/`, `.env*`, `*.log`, and IDE files

## Security Architecture Summary

```
Terminal access (trusted)
  |
  |-- nova init          -> configures auth, channels, security level
  |-- nova agent ... security <level>  -> sets agent permissions
  |-- nova config set    -> modifies config files
  |-- Direct file editing -> full control over ~/.nova/
  |
Telegram (untrusted input, authenticated by chatId)
  |
  |-- Chat messages -> dispatched to active agent
  |-- Commands (/agent, /new, /help) -> handled by daemon
  |
Agent execution (constrained by security level)
  |
  |-- sandbox:      WebSearch, WebFetch only
  |-- standard:     Files within CWD, web — no shell
  |-- unrestricted: Everything including shell
  |
  |-- MCP tools (memory, triggers, agent-management)
  |   are server-side controlled — agents use them
  |   but cannot bypass their constraints
  |
Cron triggers (autonomous, no human approval)
  |
  |-- Executes prompt on agent with agent's security level
  |-- No confirmation step
```

### Key invariant

**Privilege escalation requires terminal access.** No agent, regardless of its security level, can change its own permissions or those of other agents. The agent-builder is sandboxed and uses MCP tools that enforce this boundary server-side.
