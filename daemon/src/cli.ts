#!/usr/bin/env node

import fs from "fs";
import path from "path";

// Handle --version / -v before anything else
const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  const pkgPath = path.resolve(import.meta.dirname, "..", "package.json");
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
  default:
    console.log("Usage: nova <command>\n");
    console.log("Commands:");
    console.log("  init                          Set up nova workspace (interactive)");
    console.log("  daemon                        Start the daemon");
    console.log("  config list                   Show all configuration");
    console.log("  config get <key>              Get a config value");
    console.log("  config set <key> <value>      Set a config value");
    console.log("  status                        Show workspace and configuration status");
    console.log("  backup                        Back up workspace");
    console.log("  restore                       Restore workspace from backup");
    console.log("  uninstall                     Remove workspace and data");
    console.log();
    console.log("Flags:");
    console.log("  --version, -v                 Show version");
    process.exit(command ? 1 : 0);
}
