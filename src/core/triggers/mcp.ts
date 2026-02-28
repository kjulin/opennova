import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { triggerStore } from "./singleton.js";

export function createTriggerMcpServer(
  agentId: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "triggers",
    tools: [
      tool(
        "list_triggers",
        "List this agent's own cron triggers. You can only see and manage your own triggers, not those of other agents.",
        {},
        async () => {
          const triggers = triggerStore.list(agentId);
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
        },
        async (args) => {
          try {
            const trigger = triggerStore.create(agentId, {
              cron: args.cron,
              tz: args.tz,
              prompt: args.prompt,
            });
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(trigger, null, 2) },
              ],
            };
          } catch (e) {
            return {
              content: [{ type: "text" as const, text: (e as Error).message }],
              isError: true,
            };
          }
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
        },
        async (args) => {
          try {
            const trigger = triggerStore.update(args.id, {
              ...(args.cron !== undefined && { cron: args.cron }),
              ...(args.tz !== undefined && { tz: args.tz }),
              ...(args.prompt !== undefined && { prompt: args.prompt }),
            });
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(trigger, null, 2) },
              ],
            };
          } catch (e) {
            return {
              content: [{ type: "text" as const, text: (e as Error).message }],
              isError: true,
            };
          }
        },
      ),
      tool(
        "remove_trigger",
        "Remove one of this agent's triggers by ID.",
        {
          id: z.string().describe("Trigger ID to remove"),
        },
        async (args) => {
          triggerStore.delete(args.id);
          return {
            content: [{ type: "text" as const, text: `Trigger ${args.id} removed` }],
          };
        },
      ),
    ],
  });
}
