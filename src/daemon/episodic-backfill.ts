import fs from "fs";
import path from "path";
import cron from "node-cron";
import { Config } from "#core/config.js";
import { backfillAgent, isModelAvailable } from "#core/episodic/index.js";
import { log } from "./logger.js";

async function runBackfill() {
  if (!isModelAvailable()) {
    log.info("episodic", "backfill skipped — embedding model not available");
    return;
  }

  const agentsDir = path.join(Config.workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return;

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  let totalEmbedded = 0;
  let totalCleaned = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentDir = path.join(agentsDir, entry.name);

    try {
      const { embedded, cleaned } = await backfillAgent(agentDir);
      totalEmbedded += embedded;
      totalCleaned += cleaned;
    } catch (err) {
      log.error("episodic", `backfill failed for agent ${entry.name}:`, err);
    }
  }

  if (totalEmbedded > 0 || totalCleaned > 0) {
    log.info("episodic", `backfill complete: ${totalEmbedded} embedded, ${totalCleaned} cleaned`);
  } else {
    log.info("episodic", "backfill complete: nothing to do");
  }
}

/**
 * Start a nightly cron job that backfills embeddings for all agents.
 * Runs at 3:00 AM daily.
 */
export function startEpisodicBackfillScheduler() {
  const job = cron.schedule("0 3 * * *", () => {
    runBackfill().catch((err) => {
      log.error("episodic", "backfill scheduler failed:", err);
    });
  });

  log.info("episodic", "backfill scheduler started (daily at 03:00)");

  return {
    stop: () => {
      job.stop();
      log.info("episodic", "backfill scheduler stopped");
    },
    // Expose for manual triggering
    runBackfill,
  };
}
