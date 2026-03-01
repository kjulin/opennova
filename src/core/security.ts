import { log } from "./logger.js";

// Standard tools available to all agents.
// MCP wildcards pre-approve all tools exposed by each server.
const STANDARD_ALLOWED_TOOLS = [
  "Skill", "Read", "Write", "Edit", "Glob", "Grep",
  "WebSearch", "WebFetch", "NotebookEdit",
  "mcp__memory__*", "mcp__history__*", "mcp__triggers__*", "mcp__agents__*", "mcp__agent-management__*", "mcp__suggest-edit__*", "mcp__self__*", "mcp__media__*", "mcp__tasks__*", "mcp__notes__*", "mcp__notify-user__*", "mcp__secrets__*",
];

const STANDARD_DISALLOWED_TOOLS = ["Task", "TaskOutput"];

/**
 * Return fixed SDK permission options for all agents.
 *
 * All agents use `dontAsk` with a standard set of whitelisted tools.
 * Directory guards still enforce file-access boundaries.
 */
export function permissionOptions(extra?: {
  allowedTools?: string[];
  disallowedTools?: string[];
}): Record<string, unknown> {
  const allowedTools = [...STANDARD_ALLOWED_TOOLS];
  if (extra?.allowedTools?.length) {
    allowedTools.push(...extra.allowedTools);
  }
  const disallowedTools = [...STANDARD_DISALLOWED_TOOLS];
  if (extra?.disallowedTools?.length) {
    disallowedTools.push(...extra.disallowedTools);
  }
  const opts: Record<string, unknown> = {
    permissionMode: "dontAsk",
    disallowedTools,
    allowedTools,
  };
  log.info("security", `permissionMode=dontAsk allowedTools=${allowedTools.join(",")}`);
  return opts;
}
