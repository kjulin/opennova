import path from "path";
import { Config } from "#core/config.js";
import { loadTasks, updateTask } from "./storage.js";
import { runThread } from "#daemon/runner.js";
import { log } from "#daemon/logger.js";

const TASK_WORK_PROMPT = `Check your current task status and take appropriate action:

1. Review the task details in the <Task> block above
2. Check your progress against the steps
3. If steps are not defined, create a plan with update_steps
4. Work on the next incomplete step
5. Update step status as you make progress
6. If you need user input, set status to "waiting" and explain what you need
7. If complete, use complete_task to finish

Focus on making concrete progress. Be thorough but efficient.`;

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
      // Skip tasks without a thread (shouldn't happen, but defensive)
      if (!task.threadId) {
        log.warn("tasks", `task ${task.id} has no thread, skipping`);
        continue;
      }

      const agentDir = path.join(workspaceDir, "agents", task.owner);

      inFlightTasks.add(task.id);
      log.info("tasks", `invoking agent ${task.owner} for task ${task.id} (${task.title})`);

      try {
        await runThread(agentDir, task.threadId, TASK_WORK_PROMPT);
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
