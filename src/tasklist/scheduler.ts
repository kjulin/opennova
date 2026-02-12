import cron from "node-cron";
import fs from "fs";
import path from "path";
import { Config, createThread } from "#core/index.js";
import { runThread } from "#daemon/runner.js";
import { log } from "#daemon/logger.js";
import { loadTasks, updateTask } from "./storage.js";
import { TASKLIST_CHECK_PROMPT } from "./prompts.js";

export interface TasklistScheduler {
  taskRunner: cron.ScheduledTask;
  taskCheck: cron.ScheduledTask;
  stop: () => void;
}

export function startTasklistScheduler(): TasklistScheduler {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Even hours (6, 8, 10, 12, 14, 16, 18, 20, 22): Run assigned tasks
  const taskRunner = cron.schedule("0 6-22/2 * * 1-6", () => {
    runAssignedTasks();
  }, { timezone });

  // Odd hours (5, 7, 9, 11, 13, 15, 17, 19, 21, 23): Agents check their tasklist
  const taskCheck = cron.schedule("0 5-23/2 * * 1-6", () => {
    runTasklistCheck();
  }, { timezone });

  log.info("tasklist", "scheduler started (task runner: even hours 6-22, task check: odd hours 5-23, Mon-Sat)");

  return {
    taskRunner,
    taskCheck,
    stop: () => {
      taskRunner.stop();
      taskCheck.stop();
    },
  };
}

async function runAssignedTasks() {
  const tasks = loadTasks(Config.workspaceDir);

  // Get tasks assigned to agents (not user) with status "open"
  const agentTasks = tasks.filter(
    (t) => t.assignee !== "user" && t.status === "open"
  );

  if (agentTasks.length === 0) {
    log.info("tasklist", "no agent tasks to run");
    return;
  }

  log.info("tasklist", `running ${agentTasks.length} agent task(s) sequentially`);

  for (const task of agentTasks) {
    const agentDir = path.join(Config.workspaceDir, "agents", task.assignee);

    if (!fs.existsSync(agentDir)) {
      log.warn("tasklist", `agent directory not found for ${task.assignee}, marking task failed`);
      updateTask(Config.workspaceDir, task.id, { status: "failed" });
      continue;
    }

    try {
      // Create thread and mark task as in_progress
      const threadId = createThread(agentDir, "system");
      updateTask(Config.workspaceDir, task.id, {
        status: "in_progress",
        threadId
      });

      log.info("tasklist", `starting task ${task.id} for ${task.assignee} (thread: ${threadId})`);

      // Run agent and wait for completion
      await runThread(agentDir, threadId, `Complete task ${task.id}`);

      log.info("tasklist", `task ${task.id} completed for ${task.assignee}`);
    } catch (err) {
      log.error("tasklist", `task ${task.id} failed for ${task.assignee}:`, err);
      updateTask(Config.workspaceDir, task.id, { status: "failed" });
    }
  }
}

function runTasklistCheck() {
  const agentsDir = path.join(Config.workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return;

  log.info("tasklist", "running scheduled tasklist check for all agents");

  for (const agentId of fs.readdirSync(agentsDir)) {
    const agentDir = path.join(agentsDir, agentId);
    if (!fs.statSync(agentDir).isDirectory()) continue;

    const threadId = createThread(agentDir, "system");
    runThread(agentDir, threadId, TASKLIST_CHECK_PROMPT)
      .then(() => log.info("tasklist", `tasklist check completed for ${agentId}`))
      .catch((err) => log.error("tasklist", `tasklist check failed for ${agentId}:`, err));
  }
}
