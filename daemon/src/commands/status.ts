import fs from "fs";
import path from "path";
import { resolveWorkspace } from "../workspace.js";
import { detectAuth } from "../auth.js";

export function run() {
  const workspaceDir = resolveWorkspace();
  const exists = fs.existsSync(workspaceDir);

  console.log("\n-- Nova Status --\n");
  console.log(`Workspace:  ${workspaceDir}${exists ? "" : " (not found)"}`);

  if (!exists) {
    console.log("\nRun 'nova init' to set up your workspace.\n");
    return;
  }

  // Auth
  const auth = detectAuth(workspaceDir);
  if (auth.method === "claude-code") {
    console.log("Auth:       Claude Code (subscription)");
  } else if (auth.method === "api-key") {
    console.log(`Auth:       Anthropic API key (${auth.detail})`);
  } else {
    console.log("Auth:       Not configured");
  }

  // Channels
  const hasTelegram = fs.existsSync(path.join(workspaceDir, "telegram.json"));
  const hasApi = fs.existsSync(path.join(workspaceDir, "api.json"));
  const channels: string[] = [];
  if (hasTelegram) channels.push("Telegram");
  if (hasApi) {
    try {
      const apiConfig = JSON.parse(fs.readFileSync(path.join(workspaceDir, "api.json"), "utf-8"));
      channels.push(`HTTP API (port ${apiConfig.port})`);
    } catch {
      channels.push("HTTP API");
    }
  }
  console.log(`Channels:   ${channels.length > 0 ? channels.join(", ") : "None"}`);

  // Agents
  const agentsDir = path.join(workspaceDir, "agents");
  if (fs.existsSync(agentsDir)) {
    const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    const agentNames: string[] = [];
    let totalTriggers = 0;
    let totalThreads = 0;

    for (const dir of agentDirs) {
      const configPath = path.join(agentsDir, dir.name, "agent.json");
      if (!fs.existsSync(configPath)) continue;

      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        agentNames.push(config.name || dir.name);
      } catch {
        agentNames.push(dir.name);
      }

      // Count triggers
      const triggersPath = path.join(agentsDir, dir.name, "triggers.json");
      if (fs.existsSync(triggersPath)) {
        try {
          const triggers = JSON.parse(fs.readFileSync(triggersPath, "utf-8"));
          totalTriggers += Array.isArray(triggers) ? triggers.length : 0;
        } catch {
          // ignore
        }
      }

      // Count threads
      const threadsDir = path.join(agentsDir, dir.name, "threads");
      if (fs.existsSync(threadsDir)) {
        const threadFiles = fs.readdirSync(threadsDir).filter((f) => f.endsWith(".jsonl"));
        totalThreads += threadFiles.length;
      }
    }

    console.log(`Agents:     ${agentNames.length > 0 ? agentNames.join(", ") : "None"}`);
    console.log(`Threads:    ${totalThreads}`);
    console.log(`Triggers:   ${totalTriggers}`);
  } else {
    console.log("Agents:     None");
  }

  console.log();
}
