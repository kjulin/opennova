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

export function startProjectScheduler(): ProjectScheduler {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Run project reviews every hour during working hours (8-20)
  const projectReview = cron.schedule("0 8-20 * * 1-6", () => {
    runProjectReviews();
  }, { timezone });

  log.info("projects", "scheduler started (project reviews: hourly 8-20, Mon-Sat)");

  return {
    projectReview,
    stop: () => {
      projectReview.stop();
    },
  };
}

async function runProjectReviews() {
  const projects = loadProjects(Config.workspaceDir);
  const activeProjects = projects.filter((p) => p.status === "active");

  if (activeProjects.length === 0) {
    log.info("projects", "no active projects to review");
    return;
  }

  log.info("projects", `reviewing ${activeProjects.length} active project(s)`);

  for (const project of activeProjects) {
    const agentDir = path.join(Config.workspaceDir, "agents", project.lead);

    if (!fs.existsSync(agentDir)) {
      log.warn("projects", `lead agent directory not found for ${project.lead}, skipping project ${project.id}`);
      continue;
    }

    const threadId = createThread(agentDir, "system");
    const prompt = getProjectReviewPrompt(project.title);

    runThread(agentDir, threadId, prompt)
      .then(() => log.info("projects", `project review completed for "${project.title}" (lead: ${project.lead})`))
      .catch((err) => log.error("projects", `project review failed for "${project.title}":`, err));
  }
}
