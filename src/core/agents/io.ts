import fs from "fs";
import path from "path";
import { Config } from "../config.js";
import { log } from "../logger.js";
import {
  VALID_AGENT_ID,
  AgentJsonSchema,
  type AgentJson,
  type AgentJsonInput,
  type AgentConfig,
} from "../schemas.js";

export function agentsDir(): string {
  return path.join(Config.workspaceDir, "agents");
}

export function agentDir(id: string): string {
  return path.join(agentsDir(), id);
}

function agentStoreDir(): string {
  return path.join(Config.workspaceDir, "agent-store");
}

function agentStorePath(id: string): string {
  return path.join(agentStoreDir(), `${id}.json`);
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
 * Read and validate an agent config from agent-store/{id}.json.
 */
export function readAgentJson(id: string): AgentJson | null {
  const configPath = agentStorePath(id);
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const result = AgentJsonSchema.safeParse(raw);
    if (!result.success) {
      log.error("agents", `invalid config for "${id}": ${result.error.message}`);
      return null;
    }
    result.data.id = id;
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Validate and write an agent config to agent-store/{id}.json.
 * Also ensures the runtime directory agents/{id}/ exists.
 */
export function writeAgentJson(id: string, data: AgentJsonInput): void {
  const storeDir = agentStoreDir();
  if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir, { recursive: true });

  const toWrite = { ...data, id };
  AgentJsonSchema.parse(toWrite);
  fs.writeFileSync(agentStorePath(id), JSON.stringify(toWrite, null, 2) + "\n");

  // Ensure runtime directory exists
  const runtimeDir = agentDir(id);
  if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir, { recursive: true });
}

/**
 * Delete an agent's config file from agent-store/.
 */
export function deleteAgentJson(id: string): void {
  const configPath = agentStorePath(id);
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
}

/**
 * Read an agent and return a full AgentConfig (with id guaranteed).
 */
export function loadAgentConfig(id: string): AgentConfig | null {
  const json = readAgentJson(id);
  if (!json) return null;
  return json as AgentConfig;
}

/**
 * Migrate agent.json files from agents/{id}/agent.json to agent-store/{id}.json.
 * Runs once when agent-store/ doesn't exist yet but agents/ has config files.
 */
function migrateToAgentStore(): void {
  const storeDir = agentStoreDir();
  if (fs.existsSync(storeDir)) return;

  const agentsDirectory = agentsDir();
  if (!fs.existsSync(agentsDirectory)) return;

  // Check if any agent.json files exist in the old location
  const entries = fs.readdirSync(agentsDirectory, { withFileTypes: true });
  const agentDirs = entries.filter((e) => e.isDirectory());
  const hasOldConfigs = agentDirs.some((e) =>
    fs.existsSync(path.join(agentsDirectory, e.name, "agent.json")),
  );
  if (!hasOldConfigs) return;

  log.info("agents", "migrating agent configs to agent-store/");
  fs.mkdirSync(storeDir, { recursive: true });

  for (const entry of agentDirs) {
    const oldPath = path.join(agentsDirectory, entry.name, "agent.json");
    if (!fs.existsSync(oldPath)) continue;
    try {
      const content = fs.readFileSync(oldPath, "utf-8");
      const parsed = JSON.parse(content);
      // Ensure id is set
      parsed.id = entry.name;
      fs.writeFileSync(
        path.join(storeDir, `${entry.name}.json`),
        JSON.stringify(parsed, null, 2) + "\n",
      );
      fs.unlinkSync(oldPath);
      log.info("agents", `migrated ${entry.name}`);
    } catch (e) {
      log.error("agents", `failed to migrate ${entry.name}: ${(e as Error).message}`);
    }
  }
}

/**
 * Scan agent-store/ for config files and load all valid agents.
 */
export function loadAllAgents(): Map<string, AgentConfig> {
  migrateToAgentStore();

  const storeDir = agentStoreDir();
  const agents = new Map<string, AgentConfig>();

  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true });
  }

  for (const entry of fs.readdirSync(storeDir)) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5); // strip .json
    const config = loadAgentConfig(id);
    if (config) agents.set(id, config);
  }

  return agents;
}
