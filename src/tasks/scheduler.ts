import path from "path";
import cron from "node-cron";
import { Config } from "#core/config.js";
import { createThread } from "#core/threads.js";
import { getTask, loadTasks, updateTask } from "./storage.js";
import { TASK_WORK_PROMPT } from "./prompts.js";
import { runAgent } from "#core/index.js";
import { log } from "#daemon/logger.js";

// Track in-flight task invocations to avoid double-invoking
const inFlightTasks = new Set<string>();

async function invokeTask(workspaceDir: string, taskId: string, owner: string, title: string, threadId: string) {
  inFlightTasks.add(taskId);
  log.info("tasks", `invoking agent ${owner} for task ${taskId} (${title})`);

  try {
    const agentDir = path.join(workspaceDir, "agents", owner);
    await runAgent(agentDir, threadId, TASK_WORK_PROMPT, undefined, undefined, undefined, undefined, { background: true });
    log.info("tasks", `task ${taskId} invocation completed`);
  } catch (err) {
    log.error("tasks", `task ${taskId} invocation failed:`, err);
  } finally {
    inFlightTasks.delete(taskId);
  }
}

/** Run a single task immediately. Returns an error string or null on success. */
export function runTaskNow(workspaceDir: string, taskId: string): string | null {
  const task = getTask(workspaceDir, taskId);
  if (!task) return "task not found";
  if (task.status !== "active") return "task is not active";
  if (task.owner === "user") return "user-owned task";
  if (inFlightTasks.has(taskId)) return "already running";

  let threadId = task.threadId;
  if (!threadId) {
    log.warn("tasks", `task ${taskId} has no thread, creating one`);
    const agentDir = path.join(workspaceDir, "agents", task.owner);
    threadId = createThread(agentDir, { taskId });
    updateTask(workspaceDir, taskId, { threadId });
  }

  // Fire and forget — caller gets immediate response
  invokeTask(workspaceDir, taskId, task.owner, task.title, threadId);
  return null;
}

export function startTaskScheduler() {
  const workspaceDir = Config.workspaceDir;

  async function tick() {
    log.info("tasks", "scheduler tick");

    const tasks = loadTasks(workspaceDir);
    const agentTasks = tasks.filter(t => t.status === "active" && t.owner !== "user" && !inFlightTasks.has(t.id));

    if (agentTasks.length === 0) {
      log.info("tasks", "no agent tasks to process");
      return;
    }

    log.info("tasks", `processing ${agentTasks.length} task(s)`);

    for (const task of agentTasks) {
      const agentDir = path.join(workspaceDir, "agents", task.owner);
      let threadId = task.threadId;

      if (!threadId) {
        log.warn("tasks", `task ${task.id} has no thread, creating one`);
        threadId = createThread(agentDir, { taskId: task.id });
        updateTask(workspaceDir, task.id, { threadId });
      }

      await invokeTask(workspaceDir, task.id, task.owner, task.title, threadId);
    }
  }

  // Run every hour between 6:00 and 21:59
  const job = cron.schedule("0 6-21 * * *", () => {
    tick().catch(err => {
      log.error("tasks", "scheduler tick failed:", err);
    });
  });

  log.info("tasks", "scheduler started (hourly, 06:00–22:00)");

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
