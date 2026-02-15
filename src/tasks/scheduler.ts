import path from "path";
import cron from "node-cron";
import { Config } from "#core/config.js";
import { createThread } from "#core/threads.js";
import { loadTasks, updateTask } from "./storage.js";
import { TASK_WORK_PROMPT } from "./prompts.js";
import { runThread } from "#daemon/runner.js";
import { log } from "#daemon/logger.js";

// Track in-flight task invocations to avoid double-invoking
const inFlightTasks = new Set<string>();

export function startTaskScheduler() {
  const workspaceDir = Config.workspaceDir;

  async function tick() {
    log.info("tasks", "scheduler tick");

    const tasks = loadTasks(workspaceDir);
    const agentTasks = tasks.filter(t => t.owner !== "user" && !inFlightTasks.has(t.id));

    if (agentTasks.length === 0) {
      log.info("tasks", "no agent tasks to process");
      return;
    }

    log.info("tasks", `processing ${agentTasks.length} task(s)`);

    for (const task of agentTasks) {
      const agentDir = path.join(workspaceDir, "agents", task.owner);
      let threadId = task.threadId;

      // Create thread if missing (shouldn't happen, but recover gracefully)
      if (!threadId) {
        log.warn("tasks", `task ${task.id} has no thread, creating one`);
        threadId = createThread(agentDir, "telegram", { taskId: task.id });
        updateTask(workspaceDir, task.id, { threadId });
      }

      inFlightTasks.add(task.id);
      log.info("tasks", `invoking agent ${task.owner} for task ${task.id} (${task.title})`);

      try {
        await runThread(agentDir, threadId, TASK_WORK_PROMPT);
        log.info("tasks", `task ${task.id} invocation completed`);
      } catch (err) {
        log.error("tasks", `task ${task.id} invocation failed:`, err);
      } finally {
        inFlightTasks.delete(task.id);
      }
    }
  }

  // Run every hour at minute 0
  const job = cron.schedule("0 * * * *", () => {
    tick().catch(err => {
      log.error("tasks", "scheduler tick failed:", err);
    });
  });

  log.info("tasks", "scheduler started (hourly at :00)");

  return {
    stop: () => {
      job.stop();
      log.info("tasks", "scheduler stopped");
    },
    // Expose for manual triggering (e.g., testing)
    tick,
  };
}

export function isTaskInFlight(taskId: string): boolean {
  return inFlightTasks.has(taskId);
}
