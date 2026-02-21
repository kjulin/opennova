import fs from "fs";
import os from "os";
import path from "path";
import { Config } from "./config.js";
import type { Model } from "./models.js";
import { SettingsSchema, type TrustLevel, type Settings } from "./schemas.js";
import { log } from "./logger.js";

export interface SubagentConfig {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: Model;
  maxTurns?: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  role?: string; // Legacy - kept for backwards compatibility
  identity?: string; // Who: expertise, personality, methodology
  instructions?: string; // How: files, rhythm, focus, constraints
  directories?: string[];
  allowedAgents?: string[];
  trust?: TrustLevel;
  subagents?: Record<string, SubagentConfig>;
  capabilities?: string[];
  model?: Model;
}

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

function resolveDirectory(rawPath: string): string {
  if (rawPath.startsWith("~")) return path.join(os.homedir(), rawPath.slice(1));
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.join(Config.workspaceDir, rawPath);
}

export function getAgentCwd(agent: AgentConfig): string {
  const cwd = path.join(Config.workspaceDir, "agents", agent.id);
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
  if (!fs.existsSync(settingsPath)) return { defaultTrust: "default" };
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const result = SettingsSchema.safeParse(raw);
    if (result.success) return result.data;
    log.warn("agents", `invalid settings.json: ${result.error.message}`);
    return { defaultTrust: "default" };
  } catch {
    return { defaultTrust: "default" };
  }
}

export function resolveTrustLevel(agent: AgentConfig): TrustLevel {
  if (agent.trust) return agent.trust;
  return loadSettings().defaultTrust;
}

/**
 * Get the effective role text for an agent.
 * Returns identity (preferred) or legacy role field.
 */
export function getAgentRole(agent: AgentConfig): string {
  return agent.identity ?? agent.role ?? "";
}
