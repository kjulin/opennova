import fs from "fs";
import os from "os";
import path from "path";
import { Config } from "./config.js";
import { SettingsSchema, type SecurityLevel, type Settings } from "./schemas.js";

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
  security?: SecurityLevel;
  subagents?: Record<string, SubagentConfig>;
}

import type { ChannelType } from "./threads.js";

const SECURITY_INSTRUCTIONS: Record<SecurityLevel, string> = {
  sandbox: `
<Security>
Your security level is "sandbox". You can chat and search the web, but you have NO access to the local file system or shell. Do not attempt to read, write, or edit files, and do not try to run commands.

If the user asks you to do something that requires file access or running commands, explain that your current security level does not allow it. They can change it with:
  nova agent <agent-id> security standard    (for file access)
  nova agent <agent-id> security unrestricted (for full access including shell)
Or change the global default:
  nova config set settings.defaultSecurity <level>
</Security>`,
  standard: `
<Security>
Your security level is "standard". You can read and write files within your working directory and search the web, but you CANNOT run shell commands or access files outside your working directory.

If the user asks you to run a command, build a project, or access files outside your working directory, explain that your current security level does not allow it. They can change it with:
  nova agent <agent-id> security unrestricted
Or change the global default:
  nova config set settings.defaultSecurity unrestricted
</Security>

<FileSystem>
You have a working directory on the local file system. Only read and write files within this directory.
There may already be existing files — check before creating new ones.
Do NOT access files outside your working directory.
</FileSystem>`,
  unrestricted: `
<Security>
Your security level is "unrestricted". You have full access to the file system and can run shell commands.
</Security>

<FileSystem>
You have a working directory on the local file system. Use it to read and write files as needed.
There may already be existing files — check before creating new ones.
</FileSystem>`,
};

const GENERAL_INSTRUCTIONS = `
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

export function buildSystemPrompt(agent: AgentConfig, agentDir: string, channel: ChannelType, security: SecurityLevel): string {
  const memories = buildMemoryPrompt(agentDir);
  return `<Role>\n${agent.role}\n</Role>\n${SECURITY_INSTRUCTIONS[security]}\n${GENERAL_INSTRUCTIONS}\n${FORMATTING_INSTRUCTIONS[channel]}${memories}`;
}

export function getAgentCwd(agent: AgentConfig): string {
  if (!agent.cwd) return path.join(Config.workspaceDir, "agents", agent.id);
  if (agent.cwd.startsWith("~")) return path.join(os.homedir(), agent.cwd.slice(1));
  if (path.isAbsolute(agent.cwd)) return agent.cwd;
  return path.join(Config.workspaceDir, agent.cwd);
}

export function loadSettings(): Settings {
  const settingsPath = path.join(Config.workspaceDir, "settings.json");
  if (!fs.existsSync(settingsPath)) return { defaultSecurity: "standard" };
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const result = SettingsSchema.safeParse(raw);
    if (result.success) return result.data;
    console.warn(`[settings] invalid settings.json: ${result.error.message}`);
    return { defaultSecurity: "standard" };
  } catch {
    return { defaultSecurity: "standard" };
  }
}

export function resolveSecurityLevel(agent: AgentConfig): SecurityLevel {
  if (agent.security) return agent.security;
  return loadSettings().defaultSecurity;
}

