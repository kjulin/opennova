import fs from "fs";
import path from "path";
import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { Config } from "./config.js";

function loadMemories(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function saveMemories(filePath: string, memories: string[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(memories, null, 2));
}

export function createMemoryMcpServer(
  agentDir: string,
): McpSdkServerConfigWithInstance {
  const agentMemoriesPath = path.join(agentDir, "memories.json");
  const globalMemoriesPath = path.join(Config.workspaceDir, "memories.json");

  function getPath(scope: "agent" | "global"): string {
    return scope === "global" ? globalMemoriesPath : agentMemoriesPath;
  }

  return createSdkMcpServer({
    name: "memory",
    tools: [
      tool(
        "save_memory",
        "Save a new memory. Use agent scope for agent-specific preferences, global scope for facts that apply across all agents.",
        {
          memory: z.string().describe("The memory text to save"),
          scope: z
            .enum(["agent", "global"])
            .optional()
            .default("agent")
            .describe("Where to store the memory"),
        },
        async (args) => {
          const filePath = getPath(args.scope);
          const memories = loadMemories(filePath);
          if (memories.includes(args.memory)) {
            return {
              content: [{ type: "text" as const, text: "Memory already exists" }],
            };
          }
          memories.push(args.memory);
          saveMemories(filePath, memories);
          return {
            content: [
              { type: "text" as const, text: `Saved ${args.scope} memory: ${args.memory}` },
            ],
          };
        },
      ),
      tool(
        "list_memories",
        "List saved memories",
        {
          scope: z
            .enum(["agent", "global", "all"])
            .optional()
            .default("all")
            .describe("Which memories to list"),
        },
        async (args) => {
          const result: Record<string, string[]> = {};
          if (args.scope === "agent" || args.scope === "all") {
            result.agent = loadMemories(agentMemoriesPath);
          }
          if (args.scope === "global" || args.scope === "all") {
            result.global = loadMemories(globalMemoriesPath);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result, null, 2) },
            ],
          };
        },
      ),
      tool(
        "delete_memory",
        "Delete a memory by exact text",
        {
          memory: z.string().describe("The exact memory text to delete"),
          scope: z
            .enum(["agent", "global"])
            .optional()
            .default("agent")
            .describe("Which scope to delete from"),
        },
        async (args) => {
          const filePath = getPath(args.scope);
          const memories = loadMemories(filePath);
          const index = memories.indexOf(args.memory);
          if (index === -1) {
            return {
              content: [{ type: "text" as const, text: "Memory not found" }],
              isError: true,
            };
          }
          memories.splice(index, 1);
          saveMemories(filePath, memories);
          return {
            content: [
              { type: "text" as const, text: `Deleted ${args.scope} memory: ${args.memory}` },
            ],
          };
        },
      ),
    ],
  });
}
