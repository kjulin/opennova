import fs from "fs";
import os from "os";
import path from "path";
import { Config } from "../config.js";
import { agentStore } from "./singleton.js";
import type { AgentConfig } from "../schemas.js";

export type { AgentJson, AgentJsonInput, AgentConfig } from "../schemas.js";

export function loadAgents(): Map<string, AgentConfig> {
  return agentStore.list();
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
