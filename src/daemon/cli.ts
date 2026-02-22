#!/usr/bin/env node

import fs from "fs";
import path from "path";

// Handle --version / -v before anything else
const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  const pkgPath = path.resolve(import.meta.dirname, "..", "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  console.log(`nova ${pkg.version}`);
  process.exit(0);
}

const command = arg;

switch (command) {
  case "daemon": {
    const { run } = await import("./commands/daemon.js");
    await run();
    break;
  }
  case "init": {
    const { run } = await import("./commands/init.js");
    await run();
    break;
  }
  case "config": {
    const { run } = await import("./commands/config.js");
    run();
    break;
  }
  case "status": {
    const { run } = await import("./commands/status.js");
    run();
    break;
  }
  case "backup": {
    const { run } = await import("./commands/backup.js");
    run();
    break;
  }
  case "restore": {
    const { run } = await import("./commands/restore.js");
    await run();
    break;
  }
  case "uninstall": {
    const { run } = await import("./commands/uninstall.js");
    await run();
    break;
  }
  case "agent": {
    const { run } = await import("./commands/agent.js");
    await run();
    break;
  }
  case "skills": {
    const { run } = await import("./commands/skills.js");
    await run();
    break;
  }
  case "usage": {
    const { run } = await import("./commands/usage.js");
    run();
    break;
  }
  case "secrets": {
    const { run } = await import("./commands/secrets.js");
    await run();
    break;
  }
  case "tailscale": {
    const { run } = await import("./commands/tailscale.js");
    await run();
    break;
  }
  case "transcription": {
    const os = await import("os");
    const { Config } = await import("#core/index.js");
    Config.workspaceDir = path.join(os.homedir(), ".nova");

    const subcommand = process.argv[3];
    const { transcriptionSetup, transcriptionStatus, transcriptionModels } = await import("./commands/transcription.js");

    if (subcommand === "setup") {
      const model = process.argv[4];
      await transcriptionSetup(model);
    } else if (subcommand === "status") {
      await transcriptionStatus();
    } else if (subcommand === "models") {
      transcriptionModels();
    } else {
      console.log("Usage: nova transcription <command>\n");
      console.log("Commands:");
      console.log("  setup [model]   Set up transcription (default: large-v3)");
      console.log("  status          Show transcription status");
      console.log("  models          List available models");
    }
    break;
  }
  default:
    console.log("Usage: nova <command>\n");
    console.log("Commands:");
    console.log("  init                          Set up nova workspace (interactive)");
    console.log("  daemon                        Start the daemon");
    console.log("  config list                   Show all configuration");
    console.log("  config get <key>              Get a config value");
    console.log("  config set <key> <value>      Set a config value");
    console.log("  agent                         List agents");
    console.log("  agent <id>                    Show agent details");
    console.log("  agent <id> trust <level>      Set agent trust level");
    console.log("  agent <id> telegram           Set up a dedicated Telegram bot");
    console.log("  agent <id> telegram remove    Remove agent's dedicated bot");
    console.log("  skills list [--agent <id>]              List skills (all or per-agent)");
    console.log("  skills link <name> --agent <id|all>     Activate a library skill for agent(s)");
    console.log("  skills unlink <name> --agent <id|all>   Deactivate a skill for agent(s)");
    console.log("  skills delete <name>                    Delete a skill from the library");
    console.log("  secrets set <name>                Set a secret (prompts for value)");
    console.log("  secrets get <name>                Get a secret value");
    console.log("  secrets list                      List secret names");
    console.log("  secrets delete <name>             Delete a secret");
    console.log("  status                        Show workspace and configuration status");
    console.log("  usage [--today|--week|--month] Show current period usage by agent");
    console.log("  usage weekly                  Show week-by-week usage");
    console.log("  usage monthly                 Show month-by-month usage");
    console.log("  tailscale setup               Set up Tailscale HTTPS for Mini App");
    console.log("  transcription setup [model]   Set up local voice transcription");
    console.log("  transcription status          Show transcription status");
    console.log("  transcription models          List available Whisper models");
    console.log("  backup                        Back up workspace");
    console.log("  restore                       Restore workspace from backup");
    console.log("  uninstall                     Remove workspace and data");
    console.log();
    console.log("Flags:");
    console.log("  --version, -v                 Show version");
    process.exit(command ? 1 : 0);
}
