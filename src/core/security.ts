import type { TrustLevel } from "./schemas.js";
export type { TrustLevel } from "./schemas.js";
import { log } from "./logger.js";

// Tools available in controlled mode — everything except Bash.
// MCP wildcards pre-approve all tools exposed by each server.
const STANDARD_ALLOWED_TOOLS = [
  "Skill", "Read", "Write", "Edit", "Glob", "Grep",
  "WebSearch", "WebFetch", "Task", "TaskOutput", "NotebookEdit",
  "mcp__memory__*", "mcp__history__*", "mcp__triggers__*", "mcp__agents__*", "mcp__agent-management__*", "mcp__suggest-edit__*", "mcp__self__*", "mcp__media__*", "mcp__tasks__*", "mcp__notes__*", "mcp__notify-user__*", "mcp__secrets__*",
];

/**
 * Map a trust level to Claude Agent SDK query options.
 *
 * - sandbox:      dontAsk — only web search and subtasks allowed.
 * - controlled:   dontAsk — file tools, web, MCP tools; Bash blocked.
 * - unrestricted: bypassPermissions — all tools, no restrictions.
 */
export function trustOptions(level: TrustLevel = "controlled", extraAllowedTools?: string[]): Record<string, unknown> {
  const opts = buildOptions(level);
  if (extraAllowedTools?.length && opts.allowedTools) {
    (opts.allowedTools as string[]).push(...extraAllowedTools);
  }
  log.info("security", `level=${level} permissionMode=${opts.permissionMode} allowedTools=${(opts.allowedTools as string[])?.join(",") ?? "all"} disallowedTools=${(opts.disallowedTools as string[])?.join(",") ?? "none"}`);
  return opts;
}

function buildOptions(level: TrustLevel): Record<string, unknown> {
  switch (level) {
    case "sandbox":
      return {
        permissionMode: "dontAsk",
        allowedTools: ["Skill", "WebSearch", "WebFetch", "Task", "TaskOutput", "mcp__memory__*", "mcp__history__*", "mcp__agents__*", "mcp__agent-management__*", "mcp__triggers__*", "mcp__suggest-edit__*", "mcp__tasks__*", "mcp__notes__*", "mcp__notify-user__*"],
      };
    case "controlled":
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
