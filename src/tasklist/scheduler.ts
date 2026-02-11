import cron from "node-cron";
import fs from "fs";
import path from "path";
import { Config, createThread } from "#core/index.js";
import { runThread } from "#daemon/runner.js";
import { log } from "#daemon/logger.js";
import { TASKLIST_CHECK_PROMPT } from "./prompts.js";

export function startTasklistScheduler(): cron.ScheduledTask {
  // Hourly from 5am-11pm, Mon-Sat, in system timezone
  const task = cron.schedule("0 5-23 * * 1-6", () => {
    runTasklistCheck();
  }, {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  log.info("tasklist", "scheduler started (hourly 5am-11pm, Mon-Sat)");
  return task;
}

function runTasklistCheck() {
  const agentsDir = path.join(Config.workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return;

  log.info("tasklist", "running scheduled check for all agents");

  for (const agentId of fs.readdirSync(agentsDir)) {
    const agentDir = path.join(agentsDir, agentId);
    if (!fs.statSync(agentDir).isDirectory()) continue;

    const threadId = createThread(agentDir, "system");
    runThread(agentDir, threadId, TASKLIST_CHECK_PROMPT)
      .then(() => log.info("tasklist", `check completed for ${agentId}`))
      .catch((err) => log.error("tasklist", `check failed for ${agentId}:`, err));
  }
}
