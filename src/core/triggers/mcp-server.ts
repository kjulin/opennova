import { randomBytes } from "crypto";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { loadTriggers, saveTriggers } from "./storage.js";
import type { Trigger } from "./schema.js";

export function createTriggerMcpServer(
  agentDir: string,
  channel: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "triggers",
    tools: [
      tool(
        "list_triggers",
        "List your scheduled triggers. Shows all active triggers with their cron schedule, prompt, and expiry (if set).",
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
        `Create a scheduled trigger. Uses 5-field cron syntax (minute hour day-of-month month day-of-week).

For recurring triggers: just set cron and prompt.
For one-time triggers: set expiresAt to just after the scheduled time (trigger auto-deletes after expiry).
For time-limited recurring: set expiresAt to when the trigger should stop.

Write times in the user's local timezone. When the user says "9am" and they are in Europe/Helsinki, use cron "0 9 * * *" and tz "Europe/Helsinki".`,
        {
          cron: z.string().describe("Cron expression (5-field, in the timezone specified by tz)"),
          tz: z.string().describe("IANA timezone, e.g. Europe/Helsinki, America/New_York"),
          prompt: z.string().describe("What to do when the trigger fires"),
          expiresAt: z.string().optional().describe("ISO datetime when trigger expires and is auto-deleted. For one-time triggers, set to just after the scheduled time."),
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
            ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
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
        "Update an existing trigger by ID. You can change the schedule, prompt, or expiry.",
        {
          id: z.string().describe("Trigger ID"),
          cron: z.string().optional().describe("New cron expression"),
          tz: z.string().optional().describe("New timezone"),
          prompt: z.string().optional().describe("New prompt"),
          expiresAt: z.string().optional().describe("New expiry datetime (ISO format), or empty string to remove expiry"),
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
          if (args.expiresAt !== undefined) {
            if (args.expiresAt === "") {
              delete trigger.expiresAt;
            } else {
              trigger.expiresAt = args.expiresAt;
            }
          }

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
        "Remove a trigger by ID. The trigger will no longer fire.",
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
