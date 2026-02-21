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

export function createMemoryMcpServer(): McpSdkServerConfigWithInstance {
  const memoriesPath = path.join(Config.workspaceDir, "memories.json");

  return createSdkMcpServer({
    name: "memory",
    tools: [
      tool(
        "save_memory",
        "Save a short global fact visible to all agents (max 200 chars). Use for cross-agent facts only: user's name, timezone, preferences. NOT for notes, meeting details, or task status — use files or instructions for those.",
        {
          memory: z.string().describe("The memory text to save"),
        },
        async (args) => {
          if (args.memory.length > 200) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Memory too long (${args.memory.length} chars, max 200). Memories are for short cross-agent facts like "User's name is Klaus". For longer content, use files or agent instructions instead.`,
                },
              ],
              isError: true,
            };
          }
          const memories = loadMemories(memoriesPath);
          if (memories.includes(args.memory)) {
            return {
              content: [{ type: "text" as const, text: "Memory already exists" }],
            };
          }
          memories.push(args.memory);
          saveMemories(memoriesPath, memories);
          return {
            content: [
              { type: "text" as const, text: `Saved memory: ${args.memory}` },
            ],
          };
        },
      ),
      tool(
        "list_memories",
        "List saved global memories",
        {},
        async () => {
          const memories = loadMemories(memoriesPath);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(memories, null, 2) },
            ],
          };
        },
      ),
      tool(
        "delete_memory",
        "Delete a memory by exact text",
        {
          memory: z.string().describe("The exact memory text to delete"),
        },
        async (args) => {
          const memories = loadMemories(memoriesPath);
          const index = memories.indexOf(args.memory);
          if (index === -1) {
            return {
              content: [{ type: "text" as const, text: "Memory not found" }],
              isError: true,
            };
          }
          memories.splice(index, 1);
          saveMemories(memoriesPath, memories);
          return {
            content: [
              { type: "text" as const, text: `Deleted memory: ${args.memory}` },
            ],
          };
        },
      ),
    ],
  });
}
