import fs from "fs";
import path from "path";
import os from "os";
import { log } from "./logger.js";
const KNOWN_FILES = ["telegram", "settings"] as const;

export const SENSITIVE_KEYS = new Set(["telegram.token"]);

export function resolveWorkspace(): string {
  const ws = process.env.NOVA_WORKSPACE;
  if (ws) {
    return ws.startsWith("~") ? path.join(os.homedir(), ws.slice(1)) : ws;
  }
  return path.join(os.homedir(), ".nova");
}

export function resolveBackupDir(): string {
  return resolveWorkspace() + "_backup";
}

export function workspaceSummary(dir: string): { agents: number; threads: number } {
  let agents = 0;
  let threads = 0;
  const agentsDir = path.join(dir, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!fs.existsSync(path.join(agentsDir, entry.name, "agent.json"))) continue;
      agents++;
      const threadsDir = path.join(agentsDir, entry.name, "threads");
      if (fs.existsSync(threadsDir)) {
        threads += fs.readdirSync(threadsDir).filter((f) => f.endsWith(".jsonl")).length;
      }
    }
  }
  return { agents, threads };
}

function readConfigFile(workspaceDir: string, name: string): Record<string, unknown> | null {
  const filePath = path.join(workspaceDir, `${name}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    log.warn("config", `failed to parse ${name}.json: ${(err as Error).message}`);
    return null;
  }
}

function writeConfigFile(workspaceDir: string, name: string, data: Record<string, unknown>): void {
  fs.writeFileSync(path.join(workspaceDir, `${name}.json`), JSON.stringify(data, null, 2) + "\n");
}

function parseKey(key: string): { file: string; field: string } | null {
  const dot = key.indexOf(".");
  if (dot === -1) return null;
  const file = key.slice(0, dot);
  const field = key.slice(dot + 1);
  if (!KNOWN_FILES.includes(file as (typeof KNOWN_FILES)[number])) return null;
  if (!field) return null;
  return { file, field };
}

function coerce(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export function getConfigValue(workspaceDir: string, key: string): unknown {
  const parsed = parseKey(key);
  if (!parsed) return undefined;
  const data = readConfigFile(workspaceDir, parsed.file);
  if (!data) return undefined;
  return data[parsed.field];
}

export function setConfigValue(workspaceDir: string, key: string, value: string): void {
  const parsed = parseKey(key);
  if (!parsed) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid prefixes: ${KNOWN_FILES.join(", ")}`);
    process.exit(1);
  }
  const data = readConfigFile(workspaceDir, parsed.file) ?? {};
  data[parsed.field] = coerce(value);
  writeConfigFile(workspaceDir, parsed.file, data);
}

export function listConfig(workspaceDir: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of KNOWN_FILES) {
    const data = readConfigFile(workspaceDir, name);
    if (!data) continue;
    for (const [field, value] of Object.entries(data)) {
      const key = `${name}.${field}`;
      const display = SENSITIVE_KEYS.has(key) ? maskSecret(String(value)) : JSON.stringify(value);
      result[key] = display;
    }
  }
  return result;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

export type ConsoleAccess = "local" | "network";

/**
 * Get the console access mode from settings.
 * Defaults to "local" if not set.
 */
export function getConsoleAccess(): ConsoleAccess {
  const value = getConfigValue(resolveWorkspace(), "settings.consoleAccess");
  if (value === "network") return value;
  return "local";
}

/**
 * Get the public URL for this Nova instance (used for Telegram Web App links).
 * Returns null if no public URL is configured.
 */
export function getPublicUrl(): string | null {
  const url = getConfigValue(resolveWorkspace(), "settings.url");
  if (typeof url === "string" && url) return url.replace(/\/+$/, "");
  return null;
}
