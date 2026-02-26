import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { log } from "./logger.js";

export type AuthMethod = "claude-code" | "api-key" | "none";

export interface AuthInfo {
  method: AuthMethod;
  detail?: string;
}

/**
 * Check if the `claude` binary is available on PATH.
 */
export function hasClaudeCode(): boolean {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    execFileSync(cmd, ["claude"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a stored API key from the workspace env.json file.
 */
export function getStoredApiKey(workspaceDir: string): string | undefined {
  const envPath = path.join(workspaceDir, "env.json");
  if (!fs.existsSync(envPath)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(envPath, "utf-8"));
    return data.anthropicApiKey || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a stored API token from the workspace env.json file.
 */
export function getStoredApiToken(workspaceDir: string): string | undefined {
  const envPath = path.join(workspaceDir, "env.json");
  if (!fs.existsSync(envPath)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(envPath, "utf-8"));
    return data.apiToken || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Store an API token in the workspace env.json file.
 */
export function storeApiToken(workspaceDir: string, token: string): void {
  const envPath = path.join(workspaceDir, "env.json");
  let data: Record<string, unknown> = {};
  if (fs.existsSync(envPath)) {
    try {
      data = JSON.parse(fs.readFileSync(envPath, "utf-8"));
    } catch {
      // ignore parse errors, overwrite
    }
  }
  data.apiToken = token;
  fs.writeFileSync(envPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Store an API key in the workspace env.json file.
 */
export function storeApiKey(workspaceDir: string, apiKey: string): void {
  const envPath = path.join(workspaceDir, "env.json");
  let data: Record<string, unknown> = {};
  if (fs.existsSync(envPath)) {
    try {
      data = JSON.parse(fs.readFileSync(envPath, "utf-8"));
    } catch {
      // ignore parse errors, overwrite
    }
  }
  data.anthropicApiKey = apiKey;
  fs.writeFileSync(envPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Detect the available authentication method.
 * Priority: 1) ANTHROPIC_API_KEY env var  2) Claude Code on PATH  3) Stored API key  4) None
 */
export function detectAuth(workspaceDir?: string): AuthInfo {
  if (process.env.ANTHROPIC_API_KEY) {
    return { method: "api-key", detail: "ANTHROPIC_API_KEY environment variable" };
  }

  if (hasClaudeCode()) {
    return { method: "claude-code", detail: "Claude Code installation" };
  }

  if (workspaceDir) {
    const storedKey = getStoredApiKey(workspaceDir);
    if (storedKey) {
      return { method: "api-key", detail: "stored API key" };
    }
  }

  return { method: "none" };
}

/**
 * Ensure auth is available. If a stored API key exists, load it into the environment.
 * Exits with an error message if no auth method is found.
 */
export function ensureAuth(workspaceDir: string): AuthInfo {
  // If env var already set, use it
  if (process.env.ANTHROPIC_API_KEY) {
    return { method: "api-key", detail: "ANTHROPIC_API_KEY environment variable" };
  }

  // Try loading stored API key into environment
  const storedKey = getStoredApiKey(workspaceDir);
  if (storedKey) {
    process.env.ANTHROPIC_API_KEY = storedKey;
    return { method: "api-key", detail: "stored API key" };
  }

  // Check for Claude Code
  if (hasClaudeCode()) {
    return { method: "claude-code", detail: "Claude Code installation" };
  }

  log.error("auth", "no authentication found. Nova needs one of:");
  log.error("auth", "  1. Claude Code installed and authenticated (recommended)");
  log.error("auth", "     Install: https://docs.anthropic.com/en/docs/claude-code");
  log.error("auth", "  2. ANTHROPIC_API_KEY environment variable");
  log.error("auth", "  3. API key configured via 'nova init'");
  process.exit(1);
}
