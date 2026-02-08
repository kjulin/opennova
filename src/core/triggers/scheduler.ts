import fs from "fs";
import path from "path";
import { CronExpressionParser } from "cron-parser";
import { Config } from "../config.js";
import { createThread } from "../threads.js";
import { log } from "../logger.js";
import { loadTriggers, saveTriggers } from "./storage.js";
import { createTriggerMcpServer } from "./mcp-server.js";
import type { Trigger } from "./schema.js";

// This will be set by the daemon when it initializes
type RunThreadFn = (
  agentDir: string,
  threadId: string,
  message: string,
  callbacks?: unknown,
  extraMcpServers?: Record<string, unknown>,
  askAgentDepth?: number,
  abortController?: AbortController,
  overrides?: unknown,
) => Promise<{ text: string }>;

let runThreadFn: RunThreadFn | null = null;

export function setRunThreadFn(fn: RunThreadFn): void {
  runThreadFn = fn;
}

export function startTriggerScheduler(): NodeJS.Timeout {
  const agentsDir = path.join(Config.workspaceDir, "agents");

  function tick() {
    if (!fs.existsSync(agentsDir)) return;
    if (!runThreadFn) {
      log.warn("trigger", "scheduler tick skipped: runThread not initialized");
      return;
    }

    log.debug("trigger", "scheduler tick");

    const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();

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
      const activeTriggers: Trigger[] = [];

      for (const trigger of triggers) {
        // Check if trigger has expired
        if (trigger.expiresAt) {
          const expiryTime = new Date(trigger.expiresAt).getTime();
          if (now.getTime() > expiryTime) {
            log.info("trigger", `${agentId}/${trigger.id} expired, removing`);
            changed = true;
            continue; // Don't add to activeTriggers
          }
        }

        activeTriggers.push(trigger);

        try {
          const tz = trigger.tz ?? systemTz;
          const expr = CronExpressionParser.parse(trigger.cron, {
            currentDate: now,
            tz,
          });
          const prev = expr.prev();
          const prevTime = prev.getTime();
          const lastRunTime = new Date(trigger.lastRun).getTime();

          if (prevTime > lastRunTime) {
            log.debug("trigger", `${agentId}/${trigger.id} cron="${trigger.cron}" tz=${tz} prev=${new Date(prevTime).toISOString()} lastRun=${trigger.lastRun}`);
            trigger.lastRun = now.toISOString();
            changed = true;

            const threadId = createThread(agentDir, trigger.channel);

            log.info("trigger", `firing for agent ${agentId} thread ${threadId}: "${trigger.prompt.slice(0, 50)}..."`);

            runThreadFn(agentDir, threadId, trigger.prompt, undefined, {
              triggers: createTriggerMcpServer(agentDir, trigger.channel),
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
        saveTriggers(agentDir, activeTriggers);
      }
    }
  }

  log.info("trigger", "scheduler started (60s interval)");
  tick();
  return setInterval(tick, 60_000);
}
