import fs from "fs";
import { resolveWorkspace, resolveBackupDir, workspaceSummary } from "../workspace.js";

export function run() {
  const workspaceDir = resolveWorkspace();
  const backupDir = resolveBackupDir();

  if (!fs.existsSync(workspaceDir)) {
    console.error(`No workspace found at ${workspaceDir}. Nothing to back up.`);
    process.exit(1);
  }

  // Remove existing backup
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true });
  }

  // Copy workspace to backup
  fs.cpSync(workspaceDir, backupDir, { recursive: true });

  const summary = workspaceSummary(backupDir);
  console.log(`Backed up to ${backupDir}`);
  console.log(`  ${summary.agents} agent(s), ${summary.threads} thread(s)`);
}
