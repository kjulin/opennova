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

const MAX_DEPTH = 3;

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

export function createAskAgentMcpServer(
  caller: AgentConfig,
  depth: number = 0,
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
          return ok(JSON.stringify(entries, null, 2));
        },
      ),

      tool(
        "ask_agent",
        "Send a message to another agent and get their response. Each call runs a full agent invocation, so use sparingly for tasks that need specialist knowledge.",
        {
          agent: z.string().describe("Target agent ID"),
          message: z.string().describe("The message to send to the agent"),
        },
        async (args) => {
          if (args.agent === caller.id) {
            return err("You cannot ask yourself. Use your own knowledge or ask a different agent.");
          }

          if (depth >= MAX_DEPTH) {
            return err(`Delegation depth limit reached (max ${MAX_DEPTH}). Cannot delegate further.`);
          }

          const wildcard = allowed.includes("*");
          if (!wildcard && !allowed.includes(args.agent)) {
            return err(`Not allowed to contact agent "${args.agent}". Allowed agents: ${allowed.join(", ")}`);
          }

          const agents = loadAgents();
          const target = agents.get(args.agent);
          if (!target) {
            return err(`Agent not found: ${args.agent}`);
          }

          const targetDir = path.join(Config.workspaceDir, "agents", target.id);
          const threadId = createThread(targetDir, "internal");
          const prompt = `[Message from agent "${caller.name}" (${caller.id})]\n\n${args.message}`;

          log.info("ask-agent", `${caller.id} → ${target.id} (depth ${depth}): ${args.message.slice(0, 100)}`);

          try {
            const result = await runThread(targetDir, threadId, prompt, undefined, undefined, depth + 1);
            return ok(result.text);
          } catch (e) {
            log.error("ask-agent", `${caller.id} → ${target.id} failed:`, e);
            return err(`Agent "${target.name}" encountered an error: ${(e as Error).message}`);
          }
        },
      ),
    ],
  });
}
