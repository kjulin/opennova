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

// Lock to prevent concurrent runs per project
const runningProjects = new Set<string>();

export function getRunningProjects(): string[] {
  return Array.from(runningProjects);
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

export async function runProjectReview(projectId: string): Promise<{ started: boolean; reason?: string }> {
  // Check if this project is already running
  if (runningProjects.has(projectId)) {
    log.info("projects", `project ${projectId} review already in progress, skipping`);
    return { started: false, reason: "already_running" };
  }

  const projects = loadProjects(Config.workspaceDir);
  const project = projects.find((p) => p.id === projectId);

  if (!project) {
    return { started: false, reason: "not_found" };
  }

  if (project.status !== "active") {
    return { started: false, reason: "not_active" };
  }

  const agentDir = path.join(Config.workspaceDir, "agents", project.lead);

  if (!fs.existsSync(agentDir)) {
    log.warn("projects", `lead agent directory not found for ${project.lead}`);
    return { started: false, reason: "agent_not_found" };
  }

  runningProjects.add(projectId);

  const threadId = createThread(agentDir, "system");
  const prompt = getProjectReviewPrompt(project.title);

  runThread(agentDir, threadId, prompt)
    .then(() => log.info("projects", `project review completed for "${project.title}" (lead: ${project.lead})`))
    .catch((err) => log.error("projects", `project review failed for "${project.title}":`, err))
    .finally(() => runningProjects.delete(projectId));

  log.info("projects", `started review for "${project.title}" (lead: ${project.lead})`);
  return { started: true };
}

export async function runProjectReviews(): Promise<void> {
  const projects = loadProjects(Config.workspaceDir);
  const activeProjects = projects.filter((p) => p.status === "active");

  if (activeProjects.length === 0) {
    log.info("projects", "no active projects to review");
    return;
  }

  log.info("projects", `reviewing ${activeProjects.length} active project(s)`);

  for (const project of activeProjects) {
    await runProjectReview(project.id);
  }
}
