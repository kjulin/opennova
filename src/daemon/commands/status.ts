import fs from "fs";
import path from "path";
import { resolveWorkspace } from "../workspace.js";
import { detectAuth } from "../auth.js";
import { readPidFile, isRunning } from "./utils.js";

export function run() {
  const workspaceDir = resolveWorkspace();
  const exists = fs.existsSync(workspaceDir);

  console.log(`Workspace:  ${workspaceDir}${exists ? "" : " (not found)"}`);

  if (!exists) {
    console.log("\nRun 'nova init' to set up your workspace.\n");
    return;
  }

  // Auth
  const auth = detectAuth();
  if (auth.method === "claude-code") {
    console.log("Auth:       Claude Code (subscription)");
  } else if (auth.method === "api-key") {
    console.log(`Auth:       Anthropic API key (${auth.detail})`);
  } else {
    console.log("Auth:       Not configured");
  }

  // Daemon
  const pidInfo = readPidFile();
  if (pidInfo && isRunning(pidInfo.pid)) {
    console.log(`Daemon:     Running (pid ${pidInfo.pid}, port ${pidInfo.port})`);
  } else if (pidInfo) {
    console.log("Daemon:     Not running (stale PID file)");
  } else {
    console.log("Daemon:     Not running");
  }

  // Telegram
  const telegramPath = path.join(workspaceDir, "telegram.json");
  let telegramStatus = "Not configured";
  if (fs.existsSync(telegramPath)) {
    try {
      const tg = JSON.parse(fs.readFileSync(telegramPath, "utf-8"));
      if (tg.token && tg.chatId) {
        const token = tg.token as string;
        const masked = `${token.slice(0, 4)}...${token.slice(-3)}`;
        telegramStatus = `Paired (bot: ${masked}, chat: ${tg.chatId})`;
      } else if (tg.token) {
        telegramStatus = "Bot configured, not paired";
      }
    } catch {
      // ignore parse errors
    }
  }
  console.log(`Telegram:   ${telegramStatus}`);

  // Agents
  const agentStoreDir = path.join(workspaceDir, "agent-store");
  let agentCount = 0;
  if (fs.existsSync(agentStoreDir)) {
    agentCount = fs.readdirSync(agentStoreDir).filter((f) => f.endsWith(".json")).length;
  }
  console.log(`Agents:     ${agentCount}`);
}
