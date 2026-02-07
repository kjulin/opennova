import fs from "fs";
import readline from "readline/promises";
import { resolveWorkspace, resolveBackupDir, workspaceSummary } from "../workspace.js";

export async function run() {
  const workspaceDir = resolveWorkspace();
  const backupDir = resolveBackupDir();

  if (!fs.existsSync(backupDir)) {
    console.error(`No backup found at ${backupDir}. Run 'nova backup' first.`);
    process.exit(1);
  }

  const summary = workspaceSummary(backupDir);
  console.log(`\nBackup found at ${backupDir}`);
  console.log(`  ${summary.agents} agent(s), ${summary.threads} thread(s)\n`);

  if (fs.existsSync(workspaceDir)) {
    console.log(`This will replace your current workspace at ${workspaceDir}.`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type "yes" to restore: ')).trim();
  rl.close();

  if (answer !== "yes") {
    console.log("Cancelled.");
    return;
  }

  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true });
  }

  fs.cpSync(backupDir, workspaceDir, { recursive: true });
  console.log(`\nRestored workspace from backup.`);
}
