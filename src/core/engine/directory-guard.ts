import path from "node:path";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { TrustLevel } from "../schemas.js";

export type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

/** Tools that carry a file path we need to validate. */
const FILE_PATH_TOOLS: Record<string, string> = {
  Read: "file_path",
  Write: "file_path",
  Edit: "file_path",
  NotebookEdit: "notebook_path",
  Glob: "path",
  Grep: "path",
};

const ALLOW: PermissionResult = { behavior: "allow" };

/**
 * Creates a `canUseTool` callback that enforces directory boundaries.
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
export function createDirectoryGuard(trust: TrustLevel, cwd: string, directories: string[]): CanUseTool {
  const allowedDirs = [cwd, ...directories];

  return async (toolName, input) => {
    // Unrestricted agents have no directory restrictions.
    if (trust === "unrestricted") {
      return ALLOW;
    }

    const pathKey = FILE_PATH_TOOLS[toolName];
    if (!pathKey) {
      // Not a file tool — allow unconditionally.
      return ALLOW;
    }

    const rawPath = input[pathKey];
    if (rawPath == null || rawPath === "") {
      // Glob/Grep without an explicit path default to cwd inside the SDK.
      return ALLOW;
    }

    const resolved = path.resolve(cwd, String(rawPath));

    for (const dir of allowedDirs) {
      if (resolved === dir || resolved.startsWith(dir + path.sep)) {
        return ALLOW;
      }
    }

    return {
      behavior: "deny" as const,
      message: `Access denied: ${resolved} is outside allowed directories`,
    };
  };
}
