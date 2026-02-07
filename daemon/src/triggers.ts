import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  Config,
  TriggerSchema,
  safeParseJsonFile,
  createThread,
  type Trigger,
} from "./core/index.js";
import { runThread } from "./runner.js";
import { log } from "./logger.js";

export type { Trigger } from "./core/index.js";

export function loadTriggers(agentDir: string): Trigger[] {
  const filePath = path.join(agentDir, "triggers.json");
  if (!fs.existsSync(filePath)) return [];
  const raw = safeParseJsonFile(filePath, `triggers.json (${path.basename(agentDir)})`);
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    log.warn("trigger", `triggers.json is not an array for agent ${path.basename(agentDir)}`);
    return [];
  }
  const triggers: Trigger[] = [];
  for (const item of raw) {
    // Backfill channel for triggers created before channel ownership was enforced
    if (item && typeof item === "object" && !item.channel) item.channel = "telegram";
    const result = TriggerSchema.safeParse(item);
    if (result.success) {
      triggers.push(result.data);
    } else {
      log.warn("trigger", `skipping invalid trigger in ${path.basename(agentDir)}: ${result.error.message}`);
    }
  }
  return triggers;
}

export function saveTriggers(agentDir: string, triggers: Trigger[]) {
  fs.writeFileSync(
    path.join(agentDir, "triggers.json"),
    JSON.stringify(triggers, null, 2),
  );
}

export function createTriggerMcpServer(
  agentDir: string,
  channel: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "triggers",
    tools: [
      tool(
        "list_triggers",
        "List this agent's own cron triggers. You can only see and manage your own triggers, not those of other agents.",
        {},
        async () => {
          const triggers = loadTriggers(agentDir);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(triggers, null, 2) },
            ],
          };
        },
      ),
      tool(
        "create_trigger",
        "Create a new cron trigger for this agent. Uses standard 5-field cron syntax (minute hour day-of-month month day-of-week). Write cron times in the user's local timezone and pass their IANA timezone. When the user says \"9am\" and they are in Europe/Helsinki, use cron \"0 9 * * *\" and tz \"Europe/Helsinki\". Never convert to UTC yourself.",
        {
          cron: z.string().describe("Cron expression (5-field, in the timezone specified by tz)"),
          tz: z.string().describe("IANA timezone for the cron expression, e.g. Europe/Helsinki, America/New_York"),
          prompt: z.string().describe("Prompt to send when trigger fires"),
          enabled: z.boolean().optional().default(true).describe("Whether the trigger is enabled"),
        },
        async (args) => {
          try {
            CronExpressionParser.parse(args.cron);
          } catch {
            return {
              content: [{ type: "text" as const, text: `Invalid cron expression: ${args.cron}` }],
              isError: true,
            };
          }

          const triggers = loadTriggers(agentDir);
          const trigger: Trigger = {
            id: randomBytes(6).toString("hex"),
            channel,
            cron: args.cron,
            tz: args.tz,
            prompt: args.prompt,
            enabled: args.enabled,
            lastRun: new Date().toISOString(),
          };
          triggers.push(trigger);
          saveTriggers(agentDir, triggers);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(trigger, null, 2) },
            ],
          };
        },
      ),
      tool(
        "update_trigger",
        "Update one of this agent's triggers by ID. Write cron times in the user's local timezone and pass their IANA timezone. Never convert to UTC yourself.",
        {
          id: z.string().describe("Trigger ID"),
          cron: z.string().optional().describe("New cron expression (5-field, in the timezone specified by tz)"),
          tz: z.string().optional().describe("IANA timezone for the cron expression, e.g. Europe/Helsinki"),
          prompt: z.string().optional().describe("New prompt"),
          enabled: z.boolean().optional().describe("Enable or disable"),
        },
        async (args) => {
          const triggers = loadTriggers(agentDir);
          const trigger = triggers.find((t) => t.id === args.id);
          if (!trigger) {
            return {
              content: [{ type: "text" as const, text: `Trigger not found: ${args.id}` }],
              isError: true,
            };
          }

          if (args.cron !== undefined) {
            try {
              CronExpressionParser.parse(args.cron);
            } catch {
              return {
                content: [{ type: "text" as const, text: `Invalid cron expression: ${args.cron}` }],
                isError: true,
              };
            }
            trigger.cron = args.cron;
          }
          if (args.tz !== undefined) trigger.tz = args.tz;
          if (args.prompt !== undefined) trigger.prompt = args.prompt;
          if (args.enabled !== undefined) trigger.enabled = args.enabled;

          saveTriggers(agentDir, triggers);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(trigger, null, 2) },
            ],
          };
        },
      ),
      tool(
        "remove_trigger",
        "Remove one of this agent's triggers by ID.",
        {
          id: z.string().describe("Trigger ID to remove"),
        },
        async (args) => {
          const triggers = loadTriggers(agentDir);
          const index = triggers.findIndex((t) => t.id === args.id);
          if (index === -1) {
            return {
              content: [{ type: "text" as const, text: `Trigger not found: ${args.id}` }],
              isError: true,
            };
          }
          triggers.splice(index, 1);
          saveTriggers(agentDir, triggers);
          return {
            content: [{ type: "text" as const, text: `Trigger ${args.id} removed` }],
          };
        },
      ),
    ],
  });
}

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
        if (!trigger.enabled) continue;

        try {
          const tz = trigger.tz ?? systemTz;
          const expr = CronExpressionParser.parse(trigger.cron, {
            currentDate: new Date(),
            tz,
          });
          const prev = expr.prev();
          const prevTime = prev.getTime();
          const lastRunTime = trigger.lastRun
            ? new Date(trigger.lastRun).getTime()
            : 0;

          if (prevTime > lastRunTime) {
            log.debug("trigger", `${agentId}/${trigger.id} cron="${trigger.cron}" tz=${tz} prev=${new Date(prevTime).toISOString()} lastRun=${trigger.lastRun ?? "never"}`);
            trigger.lastRun = new Date().toISOString();
            changed = true;

            const threadId = createThread(agentDir, trigger.channel);

            log.info("trigger", `firing for agent ${agentId} thread ${threadId}: "${trigger.prompt}"`);

            runThread(agentDir, threadId, trigger.prompt, undefined, {
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
        saveTriggers(agentDir, triggers);
      }
    }
  }

  log.info("trigger", "scheduler started (60s interval)");
  tick();
  return setInterval(tick, 60_000);
}
