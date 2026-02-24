import path from "node:path";
import type { HookCallbackMatcher, PreToolUseHookInput, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { TrustLevel } from "../schemas.js";
import { log } from "../logger.js";

/** Tools that carry a file path we need to validate. */
const FILE_PATH_TOOLS: Record<string, string> = {
  Read: "file_path",
  Write: "file_path",
  Edit: "file_path",
  NotebookEdit: "notebook_path",
  Glob: "path",
  Grep: "path",
};

/**
 * Creates a PreToolUse hook that enforces directory boundaries.
 *
 * This must be a hook (not `canUseTool`) because the SDK auto-allows tools
 * listed in `allowedTools` before `canUseTool` is ever called. PreToolUse
 * hooks run first and can deny regardless of `allowedTools`.
 *
 * - `unrestricted` trust → all tools allowed unconditionally.
 * - `sandbox` / `controlled` → file-bearing tools (Read, Write, Edit, Glob,
 *   Grep, NotebookEdit) are checked against the allowed directories list.
 *   All other tools pass through.
 *
 * @param trust - The agent trust level.
 * @param cwd - The agent working directory (already absolute).
 * @param directories - Additional allowed directories (already absolute).
 */
export function createDirectoryGuard(trust: TrustLevel, cwd: string, directories: string[]): HookCallbackMatcher {
  const allowedDirs = [cwd, ...directories];

  return {
    hooks: [
      async (input): Promise<SyncHookJSONOutput> => {
        const hookInput = input as PreToolUseHookInput;
        const toolName = hookInput.tool_name;
        const toolInput = hookInput.tool_input as Record<string, unknown>;

        // Unrestricted agents have no directory restrictions.
        if (trust === "unrestricted") {
          log.debug("directory-guard", `allow ${toolName} (unrestricted trust)`);
          return { continue: true };
        }

        const pathKey = FILE_PATH_TOOLS[toolName];
        if (!pathKey) {
          // Not a file tool — allow unconditionally.
          log.debug("directory-guard", `allow ${toolName} (not a file tool)`);
          return { continue: true };
        }

        const rawPath = toolInput[pathKey];
        if (rawPath == null || rawPath === "") {
          // Glob/Grep without an explicit path default to cwd inside the SDK.
          log.debug("directory-guard", `allow ${toolName} (no path specified, defaults to cwd)`);
          return { continue: true };
        }

        const resolved = path.resolve(cwd, String(rawPath));

        for (const dir of allowedDirs) {
          if (resolved === dir || resolved.startsWith(dir + path.sep)) {
            log.debug("directory-guard", `allow ${toolName} ${resolved} (within ${dir})`);
            return { continue: true };
          }
        }

        log.debug("directory-guard", `deny ${toolName} ${resolved} (outside allowed directories: ${allowedDirs.join(", ")})`);
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny",
            permissionDecisionReason: `Access denied: ${resolved} is outside allowed directories`,
          },
        };
      },
    ],
  };
}
