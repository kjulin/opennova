# OpenNova

An open-source AI agent daemon powered by Claude. Run persistent AI agents that you can talk to over Telegram, HTTP API, and cron-triggered schedules — with built-in memory and multi-agent delegation.

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
nova status                        Show workspace and configuration status
nova backup                        Back up workspace
nova restore                       Restore workspace from backup
nova uninstall                     Remove workspace and data
nova --version                     Show version
```

## Documentation

See [daemon/README.md](./daemon/README.md) for full documentation covering agents, channels, triggers, memory, and the HTTP API.

## License

MIT
