import { CronExpressionParser } from "cron-parser";
import {
  threadStore,
  runAgent,
  triggerStore,
  createTriggerMcpServer,
} from "#core/index.js";
import { log } from "./logger.js";
import { agentDir } from "#core/agents/index.js";
import { getDeliveryCallbacks } from "./channels.js";

export function startTriggerScheduler() {
  function tick() {
    log.debug("trigger", "scheduler tick");

    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const allTriggers = triggerStore.list();

    for (const trigger of allTriggers) {
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
          log.debug("trigger", `${trigger.agentId}/${trigger.id} initializing lastRun (first seen)`);
          triggerStore.update(trigger.id, { lastRun: new Date().toISOString() });
          continue;
        }

        const lastRunTime = new Date(trigger.lastRun).getTime();

        if (prevTime > lastRunTime) {
          log.debug("trigger", `${trigger.agentId}/${trigger.id} cron="${trigger.cron}" tz=${tz} prev=${new Date(prevTime).toISOString()} lastRun=${trigger.lastRun ?? "never"}`);
          triggerStore.update(trigger.id, { lastRun: new Date().toISOString() });

          const agentId = trigger.agentId;
          const threadId = threadStore.create(agentId);

          log.info("trigger", `firing for agent ${agentId} thread ${threadId}: "${trigger.prompt}"`);

          const callbacks = getDeliveryCallbacks(agentId);

          runAgent(agentDir(agentId), threadId, trigger.prompt, callbacks, {
            triggers: createTriggerMcpServer(agentId),
          }, undefined, undefined, { background: true, source: "trigger", triggerId: trigger.id })
            .then(() => {
              log.info("trigger", `completed for agent ${agentId} thread ${threadId}`);
            })
            .catch((err) => {
              log.error("trigger", `error for agent ${agentId}:`, err);
            });
        }
      } catch (err) {
        log.error("trigger", `cron error for agent ${trigger.agentId} trigger ${trigger.id}:`, err);
      }
    }
  }

  log.info("trigger", "scheduler started (60s interval)");
  tick();
  return setInterval(tick, 60_000);
}
