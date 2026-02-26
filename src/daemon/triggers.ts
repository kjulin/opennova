import fs from "fs";
import path from "path";
import { CronExpressionParser } from "cron-parser";
import {
  Config,
  createThread,
  runAgent,
  createTriggerMcpServer,
} from "#core/index.js";
import { log } from "./logger.js";

// Re-export from core
export { loadTriggers, saveTriggers, createTriggerMcpServer } from "#core/triggers.js";
export type { Trigger } from "#core/triggers.js";

import { loadTriggers, saveTriggers } from "#core/triggers.js";
import type { Trigger } from "#core/triggers.js";

export function startTriggerScheduler() {
  const agentsDir = path.join(Config.workspaceDir, "agents");

  function tick() {
    if (!fs.existsSync(agentsDir)) return;
    log.debug("trigger", "scheduler tick");

    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const agentDir = path.join(agentsDir, entry.name);
      const agentId = entry.name;

      let triggers: Trigger[];
      try {
        triggers = loadTriggers(agentDir);
      } catch (err) {
        log.error("trigger", `failed to load triggers for agent ${agentId}:`, err);
        continue;
      }

      let changed = false;
      for (const trigger of triggers) {
        try {
          const tz = trigger.tz ?? systemTz;
          const expr = CronExpressionParser.parse(trigger.cron, {
            currentDate: new Date(),
            tz,
          });
          const prev = expr.prev();
          const prevTime = prev.getTime();
          // If lastRun is missing, initialize to now (don't fire on first tick)
          if (!trigger.lastRun) {
            log.debug("trigger", `${agentId}/${trigger.id} initializing lastRun (first seen)`);
            trigger.lastRun = new Date().toISOString();
            changed = true;
            continue;
          }

          const lastRunTime = new Date(trigger.lastRun).getTime();

          if (prevTime > lastRunTime) {
            log.debug("trigger", `${agentId}/${trigger.id} cron="${trigger.cron}" tz=${tz} prev=${new Date(prevTime).toISOString()} lastRun=${trigger.lastRun ?? "never"}`);
            trigger.lastRun = new Date().toISOString();
            changed = true;

            const threadId = createThread(agentDir);

            log.info("trigger", `firing for agent ${agentId} thread ${threadId}: "${trigger.prompt}"`);

            runAgent(agentDir, threadId, trigger.prompt, undefined, {
              triggers: createTriggerMcpServer(agentDir),
            }, undefined, undefined, { background: true, source: "trigger", triggerId: trigger.id })
              .then(() => {
                log.info("trigger", `completed for agent ${agentId} thread ${threadId}`);
              })
              .catch((err) => {
                log.error("trigger", `error for agent ${agentId}:`, err);
              });
          }
        } catch (err) {
          log.error("trigger", `cron error for agent ${agentId} trigger ${trigger.id}:`, err);
        }
      }

      if (changed) {
        saveTriggers(agentDir, triggers);
      }
    }
  }

  log.info("trigger", "scheduler started (60s interval)");
  tick();
  return setInterval(tick, 60_000);
}
