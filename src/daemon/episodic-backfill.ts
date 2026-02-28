import cron from "node-cron";
import { backfillAgent, isModelAvailable } from "#core/episodic/index.js";
import { loadAllAgents } from "#core/agents/io.js";
import { log } from "./logger.js";

async function runBackfill() {
  if (!isModelAvailable()) {
    log.info("episodic", "backfill skipped — embedding model not available");
    return;
  }

  const agents = loadAllAgents();
  let totalEmbedded = 0;
  let totalCleaned = 0;

  for (const [agentId] of agents) {
    try {
      const { embedded, cleaned } = await backfillAgent(agentId);
      totalEmbedded += embedded;
      totalCleaned += cleaned;
    } catch (err) {
      log.error("episodic", `backfill failed for agent ${agentId}:`, err);
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
