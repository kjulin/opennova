# OpenNova

> **⚠️ Experimental software.** OpenNova gives AI agents access to your computer — including the filesystem, shell, and network. It is intended for developers and power users who understand the risks. Use at your own risk, review the agent configurations, and do not run on machines with sensitive data you aren't prepared to expose.

An open-source AI agent daemon powered by Claude Agent SDK. Run persistent AI agents that you can talk to over Telegram, HTTP API, and cron-triggered schedules — with built-in memory and multi-agent delegation.

## Motivation

OpenNova is inspired by [OpenClaw](https://github.com/openclaw/openclaw) and borrows many of its ideas — persistent agents, Telegram integration, memory, and cron triggers. The main difference is a focus on simplicity and leveraging the user's existing Claude Code installation. Instead of requiring separate API key management, OpenNova uses your existing Claude Code subscription through the Agent SDK, keeping setup minimal and costs predictable.

## Features

- **Persistent agents** — Define agents with custom roles, working directories, and sub-agents
- **Telegram & HTTP API** — Chat with your agents through Telegram or integrate via REST API with SSE streaming
- **Cron triggers** — Schedule agents to run autonomously on a cron schedule
- **Memory** — Agents remember things across conversations (agent-scoped and global)
- **Sub-agents** — Agents can delegate tasks to specialized sub-agents
- **Claude Code integration** — Utilises your Claude Code installation and subscription

## Prerequisites

- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (recommended), or an Anthropic API key
- Device that can run your daemon 24/7 (desktop)

## Quick Start

```bash
npm install -g opennova
nova init
nova daemon
```

`nova init` walks you through configuring authentication and channels (Telegram, HTTP API, or both). `nova daemon` starts the agent daemon.

## CLI

```
nova init                          Set up workspace (interactive)
nova daemon                        Start the daemon
nova config list|get|set           Manage configuration
nova agent [<id>]                  List agents or show agent details
nova agent <id> security <level>   Set agent security level
nova status                        Show workspace and configuration status
nova backup                        Back up workspace
nova restore                       Restore workspace from backup
nova uninstall                     Remove workspace and data
nova --version                     Show version
```

## Security

Agent security is an area of active experimentation. Running AI agents as a persistent daemon with access to your computer is inherently risky — there is no established best practice for this yet. OpenNova takes a pragmatic approach: give the user explicit control over what each agent is allowed to do.

During `nova init`, you choose a default security level that applies to all agents. You can then override it per agent for more granular control.

| Level | Access |
|-------|--------|
| `sandbox` | Chat and web search only. No file or shell access. |
| `standard` | Read/write files within the agent's working directory. No shell commands. |
| `unrestricted` | Full access to the filesystem and shell. |

```bash
# Change the global default
nova config set settings.defaultSecurity standard

# Override for a specific agent
nova agent my-agent security unrestricted
```

These levels control which tools the Claude Agent SDK makes available to the agent. They are not a sandbox in the traditional security sense — they rely on the SDK's permission system and the agent following its system prompt. Treat this as a practical safety layer, not a security boundary.

See [daemon/README.md](./daemon/README.md) for full details.

## Documentation

See [daemon/README.md](./daemon/README.md) for full documentation covering agents, channels, triggers, memory, and the HTTP API.

## License

MIT
