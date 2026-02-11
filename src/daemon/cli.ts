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
  case "usage": {
    const { run } = await import("./commands/usage.js");
    run();
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
  case "chat": {
    const os = await import("os");
    const { Config, setLogger } = await import("#core/index.js");
    const workspaceDir = path.join(os.homedir(), ".nova");
    Config.workspaceDir = workspaceDir;

    // File-only logger for TUI (no console output)
    const logsDir = path.join(workspaceDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const logStream = fs.createWriteStream(path.join(logsDir, "tui.log"), { flags: "a" });
    const writeLog = (level: string, tag: string, msg: string, args: unknown[]) => {
      const ts = new Date().toISOString();
      const extra = args.length > 0 ? " " + args.map(String).join(" ") : "";
      logStream.write(`${ts} ${level.toUpperCase().padEnd(5)} [${tag}] ${msg}${extra}\n`);
    };
    setLogger({
      debug(tag, msg, ...args) { writeLog("debug", tag, msg, args); },
      info(tag, msg, ...args) { writeLog("info", tag, msg, args); },
      warn(tag, msg, ...args) { writeLog("warn", tag, msg, args); },
      error(tag, msg, ...args) { writeLog("error", tag, msg, args); },
    });

    // Redirect console and stderr to log file
    const writeToLog = (data: string) => logStream.write(data + "\n");
    console.log = (...args) => writeToLog(args.map(String).join(" "));
    console.info = (...args) => writeToLog(args.map(String).join(" "));
    console.warn = (...args) => writeToLog("[WARN] " + args.map(String).join(" "));
    console.error = (...args) => writeToLog("[ERROR] " + args.map(String).join(" "));
    console.debug = (...args) => writeToLog("[DEBUG] " + args.map(String).join(" "));

    // Redirect stderr to log file
    process.stderr.write = (chunk: Uint8Array | string) => {
      logStream.write(chunk);
      return true;
    };

    // Catch unhandled errors
    process.on("uncaughtException", (err) => {
      logStream.write(`[UNCAUGHT] ${err.stack ?? err.message}\n`);
    });
    process.on("unhandledRejection", (reason) => {
      logStream.write(`[UNHANDLED] ${reason}\n`);
    });

    const agentId = process.argv[3];
    const { run } = await import("#tui/index.js");
    run({ agentId });
    break;
  }
  default:
    console.log("Usage: nova <command>\n");
    console.log("Commands:");
    console.log("  chat [agent]                  Start interactive chat (default: nova)");
    console.log("  init                          Set up nova workspace (interactive)");
    console.log("  daemon                        Start the daemon");
    console.log("  config list                   Show all configuration");
    console.log("  config get <key>              Get a config value");
    console.log("  config set <key> <value>      Set a config value");
    console.log("  agent                         List agents");
    console.log("  agent <id>                    Show agent details");
    console.log("  agent <id> security <level>   Set agent security level");
    console.log("  agent <id> telegram           Set up a dedicated Telegram bot");
    console.log("  agent <id> telegram remove    Remove agent's dedicated bot");
    console.log("  status                        Show workspace and configuration status");
    console.log("  usage [--today|--week|--month] Show current period usage by agent");
    console.log("  usage weekly                  Show week-by-week usage");
    console.log("  usage monthly                 Show month-by-month usage");
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
