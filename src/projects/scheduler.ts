import cron from "node-cron";
import fs from "fs";
import path from "path";
import { Config, createThread } from "#core/index.js";
import { runThread } from "#daemon/runner.js";
import { log } from "#daemon/logger.js";
import { loadProjects } from "./storage.js";
import { getProjectReviewPrompt } from "./prompts.js";

export interface ProjectScheduler {
  projectReview: cron.ScheduledTask;
  stop: () => void;
}

// Lock to prevent concurrent runs
let isRunning = false;
let lastRunStarted: Date | null = null;

export function getProjectReviewStatus(): { isRunning: boolean; lastRunStarted: Date | null } {
  return { isRunning, lastRunStarted };
}

export function startProjectScheduler(): ProjectScheduler {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Run project reviews every 2 hours during working hours (8, 10, 12, 14, 16, 18, 20)
  const projectReview = cron.schedule("0 8-20/2 * * 1-6", () => {
    runProjectReviews();
  }, { timezone });

  log.info("projects", "scheduler started (project reviews: every 2h 8-20, Mon-Sat)");

  return {
    projectReview,
    stop: () => {
      projectReview.stop();
    },
  };
}

export async function runProjectReviews(): Promise<{ started: boolean; reason?: string }> {
  // Check if already running
  if (isRunning) {
    log.info("projects", "project review already in progress, skipping");
    return { started: false, reason: "already_running" };
  }

  isRunning = true;
  lastRunStarted = new Date();

  try {
    const projects = loadProjects(Config.workspaceDir);
    const activeProjects = projects.filter((p) => p.status === "active");

    if (activeProjects.length === 0) {
      log.info("projects", "no active projects to review");
      isRunning = false;
      return { started: true, reason: "no_active_projects" };
    }

    log.info("projects", `reviewing ${activeProjects.length} active project(s)`);

    const reviewPromises: Promise<void>[] = [];

    for (const project of activeProjects) {
      const agentDir = path.join(Config.workspaceDir, "agents", project.lead);

      if (!fs.existsSync(agentDir)) {
        log.warn("projects", `lead agent directory not found for ${project.lead}, skipping project ${project.id}`);
        continue;
      }

      const threadId = createThread(agentDir, "system");
      const prompt = getProjectReviewPrompt(project.title);

      const reviewPromise = runThread(agentDir, threadId, prompt)
        .then(() => log.info("projects", `project review completed for "${project.title}" (lead: ${project.lead})`))
        .catch((err) => log.error("projects", `project review failed for "${project.title}":`, err));

      reviewPromises.push(reviewPromise);
    }

    // Wait for all reviews to complete, then release lock
    Promise.all(reviewPromises).finally(() => {
      isRunning = false;
      log.info("projects", "all project reviews completed");
    });

    return { started: true };
  } catch (err) {
    isRunning = false;
    throw err;
  }
}
