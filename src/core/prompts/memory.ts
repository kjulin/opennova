import fs from "fs";
import path from "path";
import { Config } from "../config.js";

export const MEMORY_INSTRUCTIONS = `
<Memory>
You have three ways to persist information:

Files — for anything the user might want to read, edit, or reference later: notes, plans, research, lists, reports, structured data. If in doubt, use a file. Use your working directory.

Agent memory (save_memory with scope "agent") — for things you need to remember but the user doesn't need to see as files: their preferences relevant to your domain, past decisions, recurring patterns, corrections they gave you, and important context for future conversations.

Global memory (save_memory with scope "global") — for cross-agent knowledge any agent should know: the user's name, general preferences, timezone, communication style, and important facts about them.

Save a memory when the user tells you something worth remembering, makes a decision, corrects you, or states a preference. Don't store transient details, information already in files, or verbatim conversation logs. Update or delete memories when they become outdated.
</Memory>`;

export function buildMemoryPrompt(agentDir: string): string {
  const agentMemoriesPath = path.join(agentDir, "memories.json");
  const globalMemoriesPath = path.join(Config.workspaceDir, "memories.json");

  const agentMemories: string[] = fs.existsSync(agentMemoriesPath)
    ? JSON.parse(fs.readFileSync(agentMemoriesPath, "utf-8"))
    : [];
  const globalMemories: string[] = fs.existsSync(globalMemoriesPath)
    ? JSON.parse(fs.readFileSync(globalMemoriesPath, "utf-8"))
    : [];

  if (agentMemories.length === 0 && globalMemories.length === 0) return "";

  const sections: string[] = [];
  if (agentMemories.length > 0) {
    sections.push(`Agent memories:\n${agentMemories.map((m) => `- ${m}`).join("\n")}`);
  }
  if (globalMemories.length > 0) {
    sections.push(`Global memories:\n${globalMemories.map((m) => `- ${m}`).join("\n")}`);
  }

  return `\n<Memories>\n${sections.join("\n\n")}\n</Memories>`;
}
