import { execFileSync } from "child_process";
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
 * Detect the available authentication method.
 * Priority: 1) ANTHROPIC_API_KEY env var  2) Claude Code on PATH  3) None
 */
export function detectAuth(): AuthInfo {
  if (process.env.ANTHROPIC_API_KEY) {
    return { method: "api-key", detail: "ANTHROPIC_API_KEY environment variable" };
  }

  if (hasClaudeCode()) {
    return { method: "claude-code", detail: "Claude Code installation" };
  }

  return { method: "none" };
}

/**
 * Ensure auth is available. Exits with an error message if no auth method is found.
 */
export function ensureAuth(): AuthInfo {
  if (process.env.ANTHROPIC_API_KEY) {
    return { method: "api-key", detail: "ANTHROPIC_API_KEY environment variable" };
  }

  if (hasClaudeCode()) {
    return { method: "claude-code", detail: "Claude Code installation" };
  }

  log.error("auth", "no authentication found. Nova needs one of:");
  log.error("auth", "  1. Claude Code installed and authenticated (recommended)");
  log.error("auth", "     Install: https://docs.anthropic.com/en/docs/claude-code");
  log.error("auth", "  2. ANTHROPIC_API_KEY environment variable");
  process.exit(1);
}
