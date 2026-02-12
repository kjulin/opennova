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
- Domain-specific knowledge you need to remember
Changes take effect next conversation. Your identity stays fixed; your working arrangement evolves.

**Memory** (save_memory) — for facts that ALL agents should know:
- User's name, timezone, communication preferences
- Cross-agent decisions or context
- NOT for agent-specific knowledge (use working arrangement for that)

**Triggers** — for recurring scheduled tasks (managed via agent-builder).

Quick guide:
- "User should see this" → File
- "I should work differently" → Working Arrangement
- "All agents should know this" → Memory
- "I need to remember this for my domain" → Working Arrangement
</Storage>`;

export function buildMemoryPrompt(): string {
  const memoriesPath = path.join(Config.workspaceDir, "memories.json");

  const memories: string[] = fs.existsSync(memoriesPath)
    ? JSON.parse(fs.readFileSync(memoriesPath, "utf-8"))
    : [];

  if (memories.length === 0) return "";

  return `\n<Memories>\n${memories.map((m) => `- ${m}`).join("\n")}\n</Memories>`;
}
