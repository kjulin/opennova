import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { resolveWorkspace } from "../workspace.js";

export async function run() {
  const workspaceDir = resolveWorkspace();

  if (!fs.existsSync(workspaceDir)) {
    console.log(`No workspace found at ${workspaceDir}. Nothing to remove.`);
    return;
  }

  // Summarize what will be deleted
  console.log("\n-- Nova Uninstall --\n");
  console.log(`Workspace: ${workspaceDir}\n`);
  console.log("This will permanently delete:");

  const agentsDir = path.join(workspaceDir, "agents");
  let agentCount = 0;
  let threadCount = 0;

  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      agentCount++;
      const threadsDir = path.join(agentsDir, entry.name, "threads");
      if (fs.existsSync(threadsDir)) {
        threadCount += fs.readdirSync(threadsDir).filter((f) => f.endsWith(".jsonl")).length;
      }
    }
  }

  console.log(`  - ${agentCount} agent(s) and their configurations`);
  console.log(`  - ${threadCount} conversation thread(s)`);
  console.log("  - All memories, triggers, and channel configs");
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type "yes" to confirm: ')).trim();
  rl.close();

  if (answer !== "yes") {
    console.log("Cancelled.");
    return;
  }

  fs.rmSync(workspaceDir, { recursive: true });
  console.log(`\nRemoved ${workspaceDir}`);
  console.log("\nTo also remove the CLI, run:");
  console.log("  npm uninstall -g opennova\n");
}
