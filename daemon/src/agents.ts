import fs from "fs";
import os from "os";
import path from "path";
import { Config } from "./config.js";

export interface SubagentConfig {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: "sonnet" | "opus" | "haiku";
  maxTurns?: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  cwd?: string;
  subagents?: Record<string, SubagentConfig>;
}

import type { ChannelType } from "./threads.js";

const GENERAL_INSTRUCTIONS = `
<FileSystem>
You have a working directory on the local file system. Use it to read and write files as needed.
There may already be existing files — check before creating new ones.
</FileSystem>

<StatusNarration>
Before using tools, write a brief one-sentence message telling the user what you are about to do.
For example: "Let me check your calendar for tomorrow." or "I'll look that up for you."
Keep it short and natural. Do not narrate every single tool call — just the key steps.
</StatusNarration>`;

const FORMATTING_INSTRUCTIONS: Record<ChannelType, string> = {
  telegram: `
<Formatting>
You are communicating via Telegram. Format your responses using Telegram's Markdown syntax:

- *bold* for emphasis
- _italic_ for subtle emphasis
- \`inline code\` for code references
- \`\`\`
code block
\`\`\` for code blocks

Do NOT escape special characters. Just write naturally.
Keep messages concise. Use bullet points and short paragraphs. Avoid walls of text.
</Formatting>`,
  api: `
<Formatting>
Format your responses using standard Markdown syntax:

- **bold** for emphasis
- *italic* for subtle emphasis
- \`inline code\` for code references
- Fenced code blocks with language tags

Keep messages concise. Use bullet points and short paragraphs.
</Formatting>`,
};

export function loadAgents(): Map<string, AgentConfig> {
  const agentsDir = path.join(Config.workspaceDir, "agents");
  const agents = new Map<string, AgentConfig>();

  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(agentsDir, entry.name, "agent.json");
    if (!fs.existsSync(configPath)) continue;
    try {
      const config: AgentConfig = { ...JSON.parse(fs.readFileSync(configPath, "utf-8")), id: entry.name };
      agents.set(config.id, config);
    } catch (err) {
      console.error(`[agents] failed to load agent ${entry.name}:`, err);
    }
  }

  return agents;
}

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

export function buildSystemPrompt(agent: AgentConfig, agentDir: string, channel: ChannelType): string {
  const memories = buildMemoryPrompt(agentDir);
  return `<Role>\n${agent.role}\n</Role>\n${GENERAL_INSTRUCTIONS}\n${FORMATTING_INSTRUCTIONS[channel]}${memories}`;
}

export function getAgentCwd(agent: AgentConfig): string {
  if (!agent.cwd) return path.join(Config.workspaceDir, "agents", agent.id);
  if (agent.cwd.startsWith("~")) return path.join(os.homedir(), agent.cwd.slice(1));
  if (path.isAbsolute(agent.cwd)) return agent.cwd;
  return path.join(Config.workspaceDir, agent.cwd);
}

