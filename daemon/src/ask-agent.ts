import path from "path";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { Config } from "./config.js";
import { loadAgents, type AgentConfig } from "./agents.js";
import { createThread } from "./threads.js";
import { runThread } from "./runner.js";
import { log } from "./logger.js";

export function createAskAgentMcpServer(
  caller: AgentConfig,
): McpSdkServerConfigWithInstance {
  const allowed = caller.allowedAgents ?? [];

  return createSdkMcpServer({
    name: "ask-agent",
    tools: [
      tool(
        "list_available_agents",
        "List the agents you can delegate tasks to, with their descriptions.",
        {},
        async () => {
          const agents = loadAgents();
          const wildcard = allowed.includes("*");
          const entries: { id: string; name: string; description: string }[] = [];
          for (const a of agents.values()) {
            if (a.id === caller.id) continue;
            if (!wildcard && !allowed.includes(a.id)) continue;
            entries.push({ id: a.id, name: a.name, description: a.description ?? "" });
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(entries, null, 2) }],
          };
        },
      ),

      tool(
        "ask_agent",
        "Send a message to another agent and get their response. Use this to delegate tasks or ask questions to specialist agents.",
        {
          agent: z.string().describe("Target agent ID"),
          message: z.string().describe("The message to send to the agent"),
        },
        async (args) => {
          const wildcard = allowed.includes("*");
          if (!wildcard && !allowed.includes(args.agent)) {
            return {
              content: [{ type: "text" as const, text: `Not allowed to contact agent "${args.agent}". Allowed agents: ${allowed.join(", ")}` }],
              isError: true as const,
            };
          }

          const agents = loadAgents();
          const target = agents.get(args.agent);
          if (!target) {
            return {
              content: [{ type: "text" as const, text: `Agent not found: ${args.agent}` }],
              isError: true as const,
            };
          }

          const targetDir = path.join(Config.workspaceDir, "agents", target.id);
          const threadId = createThread(targetDir, "internal");
          const prompt = `[Message from agent "${caller.name}" (${caller.id})]\n\n${args.message}`;

          log.info("ask-agent", `${caller.id} → ${target.id}: ${args.message.slice(0, 100)}`);

          try {
            const result = await runThread(targetDir, threadId, prompt);
            return {
              content: [{ type: "text" as const, text: result.text }],
            };
          } catch (err) {
            log.error("ask-agent", `${caller.id} → ${target.id} failed:`, err);
            return {
              content: [{ type: "text" as const, text: `Agent "${target.name}" encountered an error: ${(err as Error).message}` }],
              isError: true as const,
            };
          }
        },
      ),
    ],
  });
}
