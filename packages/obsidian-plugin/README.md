# Nova Cowork - Obsidian Plugin

Integrate Nova cowork mode with Obsidian for AI-assisted editing.

## Features

- **Sidebar panel** showing Nova messages and status
- **Edit suggestions** with diff preview and Apply/Reject buttons
- **Real-time connection** to Nova daemon via WebSocket

## Requirements

- Nova daemon running (`nova daemon`)
- WebSocket server enabled (port 3737 by default)

## Installation

### Manual Installation

1. Build the plugin:
   ```bash
   cd packages/obsidian-plugin
   npm install
   npm run build
   ```

2. Copy to Obsidian plugins folder:
   ```bash
   mkdir -p ~/.obsidian/plugins/nova-cowork
   cp main.js manifest.json styles.css ~/.obsidian/plugins/nova-cowork/
   ```

3. Enable the plugin in Obsidian settings

### Development

```bash
cd packages/obsidian-plugin
npm install
npm run dev  # Watch mode
```

## Usage

1. Start Nova daemon: `nova daemon`
2. Open Obsidian
3. Click the brain icon in the sidebar, or run "Open Nova Cowork panel" command
4. The plugin will auto-connect to the daemon

## Commands

- **Open Nova Cowork panel** - Show the sidebar
- **Connect to Nova daemon** - Manual connect
- **Disconnect from Nova daemon** - Manual disconnect

## Settings

- **WebSocket Port** - Port for daemon connection (default: 3737)
- **Auto-connect** - Connect automatically on Obsidian start
