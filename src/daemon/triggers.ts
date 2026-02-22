import fs from "fs";
import path from "path";
import { CronExpressionParser } from "cron-parser";
import {
  Config,
  TelegramConfigSchema,
  safeParseJsonFile,
  createThread,
  type TelegramConfig,
} from "#core/index.js";
import { runAgent } from "./runner.js";
import { log } from "./logger.js";

// Re-export from core
export { loadTriggers, saveTriggers, createTriggerMcpServer } from "#core/triggers.js";
export type { Trigger } from "#core/triggers.js";

import { loadTriggers, saveTriggers, createTriggerMcpServer } from "#core/triggers.js";
import type { Trigger } from "#core/triggers.js";

function loadTelegramConfig(): TelegramConfig | null {
  const configPath = path.join(Config.workspaceDir, "telegram.json");
  if (!fs.existsSync(configPath)) return null;
  const raw = safeParseJsonFile(configPath, "telegram.json");
  if (!raw) return null;
  const result = TelegramConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function startTriggerScheduler() {
  const agentsDir = path.join(Config.workspaceDir, "agents");

  function tick() {
    if (!fs.existsSync(agentsDir)) return;
    log.debug("trigger", "scheduler tick");

    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const telegramConfig = loadTelegramConfig();

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

            // Check if agent has a dedicated bot for telegram channel
            let effectiveChannel = trigger.channel;
            if (trigger.channel === "telegram" && telegramConfig?.agentBots?.[agentId]) {
              effectiveChannel = `telegram:${agentId}`;
              log.debug("trigger", `${agentId}/${trigger.id} using dedicated bot channel ${effectiveChannel}`);
            }

            const threadId = createThread(agentDir, effectiveChannel);

            log.info("trigger", `firing for agent ${agentId} thread ${threadId}: "${trigger.prompt}"`);

            runAgent(agentDir, threadId, trigger.prompt, undefined, {
              triggers: createTriggerMcpServer(agentDir, effectiveChannel),
            })
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
