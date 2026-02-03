# Nova

An AI agent daemon powered by Claude. Run persistent AI agents with Telegram, cron triggers, and memory.

## Prerequisites

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (recommended), or an Anthropic API key

## Installation

```bash
npm install -g opennova
```

Or run directly with npx:

```bash
npx opennova init
```

## Quick Start

1. Run the setup wizard:

```bash
nova init
```

This walks you through authentication, Telegram, and creates the default agents.

2. Start the daemon:

```bash
nova daemon
```

## Authentication

Nova uses the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk), which works by running Claude Code under the hood. There are two ways to authenticate:

### Claude Code (recommended)

If you have [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated, Nova will use it automatically. This is the recommended approach — it uses your existing Anthropic subscription with no extra cost beyond your plan.

### Anthropic API Key

If you don't have Claude Code, you can provide an `ANTHROPIC_API_KEY` during `nova init` or set it as an environment variable. Note that API key usage is **billed per token**, which is significantly more expensive than using Claude Code with an Anthropic subscription.

```bash
# Via environment variable
export ANTHROPIC_API_KEY="sk-ant-..."
nova daemon

# Or configure during init
nova init
```

## Security Levels

Nova has three security levels that control what tools agents can use. Each level maps to specific [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) permission options. Set a global default during `nova init` or override per-agent in `agent.json`.

| Level | SDK Permission Mode | Allowed Tools | Blocked Tools |
|-------|-------------------|---------------|---------------|
| `sandbox` | `dontAsk` | WebSearch, WebFetch, Task | Everything else (file access, shell, MCP tools) |
| `standard` | `dontAsk` | **File:** Read, Write, Edit, Glob, Grep · **Web:** WebSearch, WebFetch · **Other:** Task, NotebookEdit · **MCP:** memory, triggers, agents (via `mcp__*__*` wildcards) | Bash |
| `unrestricted` | `bypassPermissions` | All tools including Bash | None |

How the SDK permission modes work:

- **`dontAsk`** — tools not listed in `allowedTools` are silently denied. The agent is never prompted for confirmation. This is used by both `sandbox` and `standard` to enforce a strict allowlist.
- **`bypassPermissions`** — all tools are available without confirmation. Used by `unrestricted` together with `allowDangerouslySkipPermissions`.

The exact configuration is in [`src/security.ts`](src/security.ts).

### Global default

Set during `nova init` and stored in `~/.nova/settings.json`:

```json
{
  "defaultSecurity": "standard"
}
```

Or change it with:

```bash
nova config set defaultSecurity standard
```

### Per-agent override

Add a `security` field to any agent's `agent.json`:

```json
{
  "name": "Deploy Bot",
  "role": "...",
  "security": "unrestricted"
}
```

Agents without a `security` field use the global default.

### Security principle

Changing an agent's security level always requires terminal access — agents cannot escalate their own permissions or those of other agents. The built-in agent-builder runs in sandbox mode and manages agents through controlled MCP tools that cannot set the `security` field. Only the `nova agent <id> security <level>` CLI command can change security levels.

### What you should know

- **Data flows through third parties.** All conversations go through Anthropic's API (via Claude Agent SDK). Telegram bot messages are not end-to-end encrypted — Telegram's E2E encryption only applies to "secret chats," which bots cannot use. If an agent reads sensitive files, that content is sent to these services.
- **Unrestricted agents can do anything you can.** An agent with `unrestricted` security has full shell access running as your OS user. There is no confirmation step or undo for destructive actions.
- **Cron triggers run autonomously.** Scheduled triggers execute prompts without human approval. Combined with `unrestricted` security, an agent can run shell commands on a timer with no one watching.
- **Local processes can influence agent behavior.** Any software running as your OS user can modify files in the workspace (`~/.nova/`), including agent configurations, triggers, and memories. OpenNova amplifies the impact of local compromise — a modified trigger on an unrestricted agent becomes an intelligent, persistent executor.

## CLI Reference

### `nova init`

Interactive setup wizard. Detects authentication, configures Telegram, and creates your workspace with default agents. Can be re-run to reconfigure.

### `nova daemon`

Start the daemon. Data is stored in `~/.nova`. Override with the `NOVA_WORKSPACE` environment variable for development/testing.

### `nova config list`

Show current configuration values.

### `nova config get <key>`

Get a specific config value. Keys use dot notation: `telegram.token`, `telegram.chatId`, `settings.defaultSecurity`.

### `nova config set <key> <value>`

Set a config value. Numbers and booleans are coerced automatically.

```bash
nova config set telegram.token "123:ABC..."
nova config set settings.defaultSecurity standard
```

### `nova agent`

List all agents:

```bash
nova agent
```

Show details for a specific agent:

```bash
nova agent nova
```

Set an agent's security level (overrides the global default):

```bash
nova agent nova security unrestricted
```

### `nova status`

Show workspace path, authentication method, configured channels, agents, and trigger/thread counts.

### `nova backup`

Back up the workspace to `~/.nova_backup`. Only one backup is kept — each run replaces the previous one.

### `nova restore`

Restore the workspace from `~/.nova_backup`. Asks for confirmation before replacing the current workspace.

### `nova uninstall`

Remove the Nova workspace and all data (agents, threads, memories, triggers, channel configs). Asks for confirmation before deleting. Also offers to remove the backup if one exists. Prints instructions to remove the CLI package.

### `nova --version`

Show the installed version.

## Workspace Layout

```
~/.nova/
├── settings.json             # Global settings (security level)
├── telegram.json             # Telegram channel config (optional)
├── env.json                  # Stored API key (optional)
├── memories.json             # Global memories
└── agents/
    └── <agent-id>/
        ├── agent.json        # Agent config
        ├── memories.json     # Agent-scoped memories
        ├── triggers.json     # Cron triggers
        └── threads/
            └── <thread-id>.jsonl
```

## Agents

Each agent lives in its own directory under `agents/` with an `agent.json` config file:

```json
{
  "name": "Nova",
  "role": "You are a helpful assistant."
}
```

Optional fields:

- `cwd` — Working directory for the agent (supports `~` and relative paths)
- `subagents` — Array of delegated sub-agents for specialized tasks

Two default agents are included:

- **nova** — A general-purpose assistant
- **agent-builder** — Creates and edits other agents via conversation

## Channels

### Telegram

Connects a Telegram bot to your agents. Configure during `nova init` or manually:

```bash
nova config set telegram.token "<bot-token>"
nova config set telegram.chatId "<your-chat-id>"
```

Bot commands:

- `/agent` — List agents or switch to a different one (`/agent <name>`)
- `/new` — Start a new conversation thread

## Triggers

Agents can have cron-based triggers that run on a schedule. Triggers are managed through the agent's MCP tools during conversation:

- `create_trigger` — Create a new cron trigger
- `list_triggers` — List existing triggers
- `update_trigger` — Update a trigger
- `remove_trigger` — Remove a trigger

Triggers use standard 5-field cron expressions and create a new thread each time they fire.

## Memory

Agents have access to a persistent memory system with two scopes:

- **Agent memory** — Scoped to a single agent (`agents/<id>/memories.json`)
- **Global memory** — Shared across all agents (`memories.json` in workspace root)

Memory is managed through MCP tools during conversation: `save_memory`, `list_memories`, `delete_memory`.

## Uninstalling

To completely remove Nova:

```bash
nova uninstall           # Removes workspace (~/.nova) and all data
npm uninstall -g opennova  # Removes the CLI
```

## Troubleshooting

### "No authentication found"

Nova needs either Claude Code or an Anthropic API key. Run `nova status` to check your current auth configuration. Run `nova init` to set it up.

### "No channels configured"

The daemon starts but can't receive messages without at least one channel. Run `nova init` to configure Telegram.

### Daemon starts but agent doesn't respond

Check the terminal output for errors. Common causes:
- Expired or invalid Telegram bot token
- Wrong chat ID for Telegram
- Claude Code not authenticated (run `claude` to log in)

## License

MIT
