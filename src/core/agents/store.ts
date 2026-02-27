import fs from "fs";
import type { AgentConfig, AgentJson } from "../schemas.js";
import {
  agentDir,
  validateAgentId,
  readAgentJson,
  writeAgentJson,
  loadAgentConfig,
  loadAllAgents,
} from "./io.js";

export interface AgentStore {
  list(): Map<string, AgentConfig>;
  get(id: string): AgentConfig | null;
  getJson(id: string): AgentJson | null;
  create(id: string, config: AgentJson): void;
  update(id: string, partial: Partial<AgentJson>): void;
  delete(id: string): void;
}

export class FilesystemAgentStore implements AgentStore {
  list(): Map<string, AgentConfig> {
    return loadAllAgents();
  }

  get(id: string): AgentConfig | null {
    return loadAgentConfig(id);
  }

  getJson(id: string): AgentJson | null {
    return readAgentJson(id);
  }

  create(id: string, config: AgentJson): void {
    const error = validateAgentId(id);
    if (error) throw new Error(error);
    if (readAgentJson(id)) {
      throw new Error(`Agent "${id}" already exists`);
    }
    writeAgentJson(id, config);
  }

  update(id: string, partial: Partial<AgentJson>): void {
    const existing = readAgentJson(id);
    if (!existing) throw new Error(`Agent not found: ${id}`);
    const merged = { ...existing, ...partial };
    writeAgentJson(id, merged);
  }

  delete(id: string): void {
    const dir = agentDir(id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  }
}
