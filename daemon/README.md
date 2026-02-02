# Nova

An AI agent daemon powered by Claude. Run persistent AI agents with Telegram, HTTP API, cron triggers, and memory.

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

This walks you through authentication, channels (Telegram and/or HTTP API), and creates the default agents.

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

## CLI Reference

### `nova init`

Interactive setup wizard. Detects authentication, configures channels, and creates your workspace with default agents. Can be re-run to reconfigure channels.

### `nova daemon`

Start the daemon. Data is stored in `~/.nova`. Override with the `NOVA_WORKSPACE` environment variable for development/testing.

### `nova config list`

Show current configuration values.

### `nova config get <key>`

Get a specific config value. Keys use dot notation: `api.port`, `api.secret`, `telegram.token`, `telegram.chatId`.

### `nova config set <key> <value>`

Set a config value. Numbers and booleans are coerced automatically.

```bash
nova config set api.port 8080
nova config set telegram.token "123:ABC..."
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
├── api.json                  # API channel config (optional)
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

### HTTP API

Exposes a REST API for programmatic access. Configure during `nova init` or manually:

```bash
nova config set api.port 3000
nova config set api.secret "my-bearer-token"  # optional
```

When `secret` is set, all requests require `Authorization: Bearer <secret>`.

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/agents` | List all agents |
| `GET` | `/agents/:id/threads` | List API threads for an agent |
| `POST` | `/agents/:id/threads` | Create a new thread (returns 201) |
| `GET` | `/threads/:id` | Get thread details |
| `GET` | `/threads/:id/messages` | Get thread messages |
| `DELETE` | `/threads/:id` | Delete a thread |
| `POST` | `/threads/:id/messages` | Send message (SSE stream) |

#### Sending Messages (SSE)

```bash
curl -N -X POST http://localhost:3000/threads/<id>/messages \
  -H 'Content-Type: application/json' \
  -d '{"message":"Hello"}'
```

Response is `text/event-stream`:

```
event: status
data: {"text":"Searching the web..."}

event: done
data: {"text":"Here is the final response."}
```

- `status` — Intermediate progress (tool use, narration)
- `done` — Final assistant response
- `error` — Failure

#### Channel Ownership

Threads are scoped to the channel that created them. The API can read any thread but can only write to threads with `channel: "api"`. Posting to a thread owned by another channel returns `403`.

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

The daemon starts but can't receive messages without at least one channel. Run `nova init` to configure Telegram or HTTP API.

### Daemon starts but agent doesn't respond

Check the terminal output for errors. Common causes:
- Expired or invalid Telegram bot token
- Wrong chat ID for Telegram
- Claude Code not authenticated (run `claude` to log in)

## License

MIT
