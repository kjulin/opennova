import fs from "fs";
import readline from "readline/promises";
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
