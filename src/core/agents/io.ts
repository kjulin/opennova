import fs from "fs";
import path from "path";
import { Config } from "../config.js";
import { log } from "../logger.js";
import {
  VALID_AGENT_ID,
  AgentJsonSchema,
  type AgentJson,
  type AgentConfig,
} from "../schemas.js";

export function agentsDir(): string {
  return path.join(Config.workspaceDir, "agents");
}

export function agentDir(id: string): string {
  return path.join(agentsDir(), id);
}

/**
 * Validate an agent ID. Returns an error message string, or null if valid.
 */
export function validateAgentId(id: string): string | null {
  if (!VALID_AGENT_ID.test(id)) {
    return `Invalid agent ID: "${id}". Use lowercase letters, numbers, and hyphens.`;
  }
  return null;
}

/**
 * Read and validate an agent's agent.json. Returns null if missing or invalid.
 */
export function readAgentJson(id: string): AgentJson | null {
  const configPath = path.join(agentDir(id), "agent.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const result = AgentJsonSchema.safeParse(raw);
    if (!result.success) {
      log.error("agents", `invalid agent.json for "${id}": ${result.error.message}`);
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Validate and write an agent's agent.json.
 */
export function writeAgentJson(id: string, data: AgentJson): void {
  const dir = agentDir(id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Validate before writing
  AgentJsonSchema.parse(data);
  fs.writeFileSync(path.join(dir, "agent.json"), JSON.stringify(data, null, 2) + "\n");
}

/**
 * Read an agent and return a full AgentConfig (with id and defaulted trust).
 */
export function loadAgentConfig(id: string): AgentConfig | null {
  const json = readAgentJson(id);
  if (!json) return null;
  return { ...json, id, trust: json.trust ?? "sandbox" };
}

/**
 * Scan the agents directory and load all valid agents.
 */
export function loadAllAgents(): Map<string, AgentConfig> {
  const dir = agentsDir();
  const agents = new Map<string, AgentConfig>();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const config = loadAgentConfig(entry.name);
    if (config) agents.set(config.id, config);
  }

  return agents;
}
