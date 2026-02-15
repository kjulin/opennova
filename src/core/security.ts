import type { SecurityLevel } from "./schemas.js";
export type { SecurityLevel } from "./schemas.js";
import { log } from "./logger.js";

// Tools available in standard mode — everything except Bash.
// MCP wildcards pre-approve all tools exposed by each server.
const STANDARD_ALLOWED_TOOLS = [
  "Skill", "Read", "Write", "Edit", "Glob", "Grep",
  "WebSearch", "WebFetch", "Task", "NotebookEdit",
  "mcp__memory__*", "mcp__triggers__*", "mcp__agents__*", "mcp__ask-agent__*", "mcp__usage__*", "mcp__suggest-edit__*", "mcp__self__*", "mcp__file-send__*", "mcp__transcription__*",
];

/**
 * Map a security level to Claude Agent SDK query options.
 *
 * - sandbox:      dontAsk — only web search and subtasks allowed.
 * - standard:     dontAsk — file tools, web, MCP tools; Bash blocked.
 * - unrestricted: bypassPermissions — all tools, no restrictions.
 */
export function securityOptions(level: SecurityLevel = "standard"): Record<string, unknown> {
  const opts = buildOptions(level);
  log.info("security", `level=${level} permissionMode=${opts.permissionMode} allowedTools=${(opts.allowedTools as string[])?.join(",") ?? "all"} disallowedTools=${(opts.disallowedTools as string[])?.join(",") ?? "none"}`);
  return opts;
}

function buildOptions(level: SecurityLevel): Record<string, unknown> {
  switch (level) {
    case "sandbox":
      return {
        permissionMode: "dontAsk",
        allowedTools: ["Skill", "WebSearch", "WebFetch", "Task", "mcp__memory__*", "mcp__agents__*", "mcp__triggers__*", "mcp__usage__*", "mcp__suggest-edit__*"],
      };
    case "standard":
      return {
        permissionMode: "dontAsk",
        disallowedTools: ["Bash"],
        allowedTools: STANDARD_ALLOWED_TOOLS,
      };
    case "unrestricted":
      return {
        allowDangerouslySkipPermissions: true,
        permissionMode: "bypassPermissions",
      };
  }
}
