import path from "path";
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
    const tasks = loadTasks(workspaceDir);
    const agentTasks = tasks.filter(t => t.owner !== "user" && !inFlightTasks.has(t.id));

    if (agentTasks.length === 0) {
      log.debug("tasks", "scheduler tick: no agent tasks to process");
      return;
    }

    log.info("tasks", `scheduler tick: processing ${agentTasks.length} task(s)`);

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

  // Run hourly (3600000ms)
  const HOUR_MS = 60 * 60 * 1000;

  log.info("tasks", "scheduler started (hourly)");

  // Don't run immediately on startup - wait for first hour
  const interval = setInterval(() => {
    tick().catch(err => {
      log.error("tasks", "scheduler tick failed:", err);
    });
  }, HOUR_MS);

  return {
    stop: () => {
      clearInterval(interval);
      log.info("tasks", "scheduler stopped");
    },
    // Expose for manual triggering (e.g., testing)
    tick,
  };
}

export function isTaskInFlight(taskId: string): boolean {
  return inFlightTasks.has(taskId);
}
