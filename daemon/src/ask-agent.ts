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
