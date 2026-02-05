import fs from "fs";
import os from "os";
import path from "path";
import { Config } from "./config.js";
import { SettingsSchema, type SecurityLevel, type Settings } from "./schemas.js";
import { log } from "./logger.js";

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
  description?: string;
  role: string;
  cwd?: string;
  directories?: string[];
  allowedAgents?: string[];
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
Your security level is "standard". You can read and write files within your allowed directories and search the web, but you CANNOT run shell commands or access files outside your allowed directories.

If the user asks you to run a command, build a project, or access files outside your allowed directories, explain that your current security level does not allow it. They can change it with:
  nova agent <agent-id> security unrestricted
Or change the global default:
  nova config set settings.defaultSecurity unrestricted
</Security>`,
  unrestricted: `
<Security>
Your security level is "unrestricted". You have full access to the file system and can run shell commands.
</Security>`,
};

const GENERAL_INSTRUCTIONS = `
<StatusNarration>
Before using tools, write a brief one-sentence message telling the user what you are about to do.
For example: "Let me check your calendar for tomorrow." or "I'll look that up for you."
Keep it short and natural. Do not narrate every single tool call — just the key steps.
</StatusNarration>`;

const MEMORY_INSTRUCTIONS = `
<Memory>
You have three ways to persist information:

Files — for anything the user might want to read, edit, or reference later: notes, plans, research, lists, reports, structured data. If in doubt, use a file. Use your working directory.

Agent memory (save_memory with scope "agent") — for things you need to remember but the user doesn't need to see as files: their preferences relevant to your domain, past decisions, recurring patterns, corrections they gave you, and important context for future conversations.

Global memory (save_memory with scope "global") — for cross-agent knowledge any agent should know: the user's name, general preferences, timezone, communication style, and important facts about them.

Save a memory when the user tells you something worth remembering, makes a decision, corrects you, or states a preference. Don't store transient details, information already in files, or verbatim conversation logs. Update or delete memories when they become outdated.
</Memory>`;

const FORMATTING_INSTRUCTIONS: Record<string, string> = {
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
      log.error("agents", `failed to load agent ${entry.name}:`, err);
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

function buildContextBlock(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const local = now.toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" });
  return `\n<Context>\nCurrent time: ${local} (${tz})\n</Context>`;
}

function buildDirectoriesBlock(cwd: string, directories: string[], security: SecurityLevel): string {
  if (security === "sandbox") return "";

  const lines: string[] = [
    `Your working directory is: ${cwd}`,
    "There may already be existing files — check before creating new ones.",
  ];

  if (directories.length > 0) {
    lines.push("");
    lines.push("You also have access to these additional directories:");
    for (const dir of directories) {
      lines.push(`- ${dir}`);
    }
  }

  if (security === "standard") {
    lines.push("");
    if (directories.length > 0) {
      lines.push("Only read and write files within your working directory and the additional directories listed above.");
      lines.push("Do NOT access files outside these directories.");
    } else {
      lines.push("Only read and write files within your working directory.");
      lines.push("Do NOT access files outside your working directory.");
    }
  }

  return `\n<Directories>\n${lines.join("\n")}\n</Directories>`;
}

export function buildSystemPrompt(agent: AgentConfig, agentDir: string, channel: ChannelType, security: SecurityLevel): string {
  const memories = buildMemoryPrompt(agentDir);
  const cwd = getAgentCwd(agent);
  const directories = getAgentDirectories(agent);
  const dirBlock = buildDirectoriesBlock(cwd, directories, security);
  const baseChannel = channel.startsWith("telegram") ? "telegram" : channel;
  const formatting = FORMATTING_INSTRUCTIONS[baseChannel] ?? "";
  const memoryInstructions = security !== "sandbox" ? MEMORY_INSTRUCTIONS : "";
  return `<Role>\n${agent.role}\n</Role>\n${SECURITY_INSTRUCTIONS[security]}${dirBlock}\n${GENERAL_INSTRUCTIONS}${memoryInstructions}\n${formatting}${buildContextBlock()}${memories}`;
}

function resolveDirectory(rawPath: string): string {
  if (rawPath.startsWith("~")) return path.join(os.homedir(), rawPath.slice(1));
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.join(Config.workspaceDir, rawPath);
}

export function getAgentCwd(agent: AgentConfig): string {
  const cwd = agent.cwd
    ? resolveDirectory(agent.cwd)
    : path.join(Config.workspaceDir, "agents", agent.id);
  fs.mkdirSync(cwd, { recursive: true });
  return cwd;
}

export function getAgentDirectories(agent: AgentConfig): string[] {
  if (!agent.directories || agent.directories.length === 0) return [];
  const cwd = getAgentCwd(agent);
  const dirs: string[] = [];
  for (const dir of agent.directories) {
    const resolved = resolveDirectory(dir);
    if (resolved !== cwd) {
      fs.mkdirSync(resolved, { recursive: true });
      dirs.push(resolved);
    }
  }
  return dirs;
}

export function loadSettings(): Settings {
  const settingsPath = path.join(Config.workspaceDir, "settings.json");
  if (!fs.existsSync(settingsPath)) return { defaultSecurity: "standard" };
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const result = SettingsSchema.safeParse(raw);
    if (result.success) return result.data;
    log.warn("agents", `invalid settings.json: ${result.error.message}`);
    return { defaultSecurity: "standard" };
  } catch {
    return { defaultSecurity: "standard" };
  }
}

export function resolveSecurityLevel(agent: AgentConfig): SecurityLevel {
  if (agent.security) return agent.security;
  return loadSettings().defaultSecurity;
}

