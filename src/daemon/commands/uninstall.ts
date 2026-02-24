import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline/promises";
import { execFileSync } from "child_process";
import { resolveWorkspace, resolveBackupDir, workspaceSummary } from "../workspace.js";

export async function run() {
  const workspaceDir = resolveWorkspace();
  const backupDir = resolveBackupDir();

  if (!fs.existsSync(workspaceDir) && !fs.existsSync(backupDir)) {
    console.log(`No workspace found at ${workspaceDir}. Nothing to remove.`);
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Remove workspace
  if (fs.existsSync(workspaceDir)) {
    console.log("\n-- Nova Uninstall --\n");
    console.log(`Workspace: ${workspaceDir}\n`);
    console.log("This will permanently delete:");

    const summary = workspaceSummary(workspaceDir);
    console.log(`  - ${summary.agents} agent(s) and their configurations`);
    console.log(`  - ${summary.threads} conversation thread(s)`);
    console.log("  - All memories, triggers, and channel configs");
    console.log();

    const answer = (await rl.question('Type "yes" to confirm: ')).trim();
    if (answer !== "yes") {
      rl.close();
      console.log("Cancelled.");
      return;
    }

    // Stop daemon and remove service configuration before deleting workspace
    if (process.platform === "darwin") {
      const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", "dev.opennova.daemon.plist");
      try { execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" }); } catch {}
      if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
      console.log("  Daemon stopped and LaunchAgent removed.");
    } else if (process.platform === "linux") {
      try { execFileSync("systemctl", ["stop", "opennova-daemon"], { stdio: "ignore" }); } catch {}
      try { execFileSync("systemctl", ["disable", "opennova-daemon"], { stdio: "ignore" }); } catch {}
      const servicePath = "/etc/systemd/system/opennova-daemon.service";
      if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath);
      try { execFileSync("systemctl", ["daemon-reload"]); } catch {}
      console.log("  Daemon stopped and service removed.");
    }

    fs.rmSync(workspaceDir, { recursive: true });
    console.log(`\nRemoved ${workspaceDir}`);
  }

  // Remove backup if it exists
  if (fs.existsSync(backupDir)) {
    const removeBackup = (await rl.question(`\nAlso remove backup at ${backupDir}? (yes/no): `)).trim();
    if (removeBackup === "yes") {
      fs.rmSync(backupDir, { recursive: true });
      console.log(`Removed ${backupDir}`);
    }
  }

  rl.close();

  console.log("\nTo also remove the CLI, run:");
  console.log("  npm uninstall -g opennova\n");
}
