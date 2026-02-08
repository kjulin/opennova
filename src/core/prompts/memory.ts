import fs from "fs";
import path from "path";
import { Config } from "../config.js";

export const STORAGE_INSTRUCTIONS = `
<Storage>
You have four ways to persist information. Choose the right one:

**Files** — for content the user should see: notes, drafts, plans, reports, data. When in doubt, use a file.

**Working Arrangement** (update_my_working_arrangement) — for how YOU operate. Update when you discover:
- Better approaches to your work
- User preferences about your workflow
- Patterns that work well
- Constraints you should follow
Changes take effect next conversation. Your identity stays fixed; your working arrangement evolves.

**Memory** (save_memory) — for facts to remember across conversations:
- Agent scope: Your domain knowledge (user's preferences in your area, past decisions)
- Global scope: Cross-agent facts (user's name, timezone, communication style)

**Triggers** — for scheduled tasks. Use your trigger tools to:
- Set recurring reminders (daily standup, weekly review)
- Set one-time reminders ("remind me at 6pm") with expiresAt
- Schedule time-limited recurring tasks (set expiresAt for end date)
Expired triggers are automatically deleted.

Quick guide:
- "User should see this" → File
- "I should work differently" → Working Arrangement
- "I need to remember this fact" → Memory
</Storage>`;

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
