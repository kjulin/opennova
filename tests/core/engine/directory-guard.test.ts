import { describe, it, expect } from "vitest";
import type { SyncHookJSONOutput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { createDirectoryGuard } from "#core/engine/directory-guard.js";

const CWD = "/home/user/project";

/** Build a minimal PreToolUse hook input. */
function hookInput(tool: string, input: Record<string, unknown>): PreToolUseHookInput {
  return {
    session_id: "test",
    transcript_path: "/tmp/transcript",
    cwd: CWD,
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: input,
    tool_use_id: "tu_test",
  };
}

/** Call the guard hook and return the result. */
async function call(
  guard: ReturnType<typeof createDirectoryGuard>,
  tool: string,
  input: Record<string, unknown>,
): Promise<SyncHookJSONOutput> {
  const hook = guard.hooks[0];
  return hook(hookInput(tool, input), "tu_test", { signal: AbortSignal.abort() }) as Promise<SyncHookJSONOutput>;
}

/** Check if the result represents an allow. */
function isAllow(result: SyncHookJSONOutput): boolean {
  return result.continue === true && !result.hookSpecificOutput;
}

/** Check if the result represents a deny. */
function isDeny(result: SyncHookJSONOutput): boolean {
  const output = result.hookSpecificOutput;
  return (
    output !== undefined &&
    "permissionDecision" in output &&
    output.permissionDecision === "deny"
  );
}

/** Extract the deny message from a result. */
function denyMessage(result: SyncHookJSONOutput): string | undefined {
  const output = result.hookSpecificOutput;
  if (output && "permissionDecisionReason" in output) {
    return output.permissionDecisionReason;
  }
  return undefined;
}

describe("createDirectoryGuard", () => {
  describe("controlled trust", () => {
    const guard = createDirectoryGuard("controlled", CWD, ["/shared/data"]);

    it("allows Read inside cwd", async () => {
      expect(isAllow(await call(guard, "Read", { file_path: "/home/user/project/src/index.ts" }))).toBe(true);
    });

    it("allows Read inside additional directory", async () => {
      expect(isAllow(await call(guard, "Read", { file_path: "/shared/data/config.json" }))).toBe(true);
    });

    it("allows Read of cwd itself", async () => {
      expect(isAllow(await call(guard, "Read", { file_path: CWD }))).toBe(true);
    });

    it("denies Read outside allowed directories", async () => {
      const result = await call(guard, "Read", { file_path: "/etc/passwd" });
      expect(isDeny(result)).toBe(true);
      expect(denyMessage(result)).toBe("Access denied: /etc/passwd is outside allowed directories");
    });

    it("denies paths that share a prefix but aren't inside the directory", async () => {
      const result = await call(guard, "Read", { file_path: "/home/user/project-other/file.txt" });
      expect(isDeny(result)).toBe(true);
      expect(denyMessage(result)).toBe("Access denied: /home/user/project-other/file.txt is outside allowed directories");
    });

    it("denies traversal via ../", async () => {
      const result = await call(guard, "Read", { file_path: "/home/user/project/../../../etc/passwd" });
      expect(isDeny(result)).toBe(true);
      expect(denyMessage(result)).toBe("Access denied: /etc/passwd is outside allowed directories");
    });

    it("resolves relative paths against cwd", async () => {
      expect(isAllow(await call(guard, "Read", { file_path: "src/index.ts" }))).toBe(true);
    });

    it("denies relative path that escapes cwd", async () => {
      const result = await call(guard, "Read", { file_path: "../../etc/shadow" });
      expect(isDeny(result)).toBe(true);
      expect(denyMessage(result)).toContain("is outside allowed directories");
    });
  });

  describe("file tool variants", () => {
    const guard = createDirectoryGuard("controlled", CWD, []);

    it("checks Write via file_path", async () => {
      expect(isDeny(await call(guard, "Write", { file_path: "/etc/hosts" }))).toBe(true);
    });

    it("checks Edit via file_path", async () => {
      expect(isDeny(await call(guard, "Edit", { file_path: "/etc/hosts" }))).toBe(true);
    });

    it("checks NotebookEdit via notebook_path", async () => {
      expect(isDeny(await call(guard, "NotebookEdit", { notebook_path: "/etc/notebook.ipynb" }))).toBe(true);
    });

    it("checks Glob via path", async () => {
      expect(isDeny(await call(guard, "Glob", { path: "/etc", pattern: "*.conf" }))).toBe(true);
    });

    it("checks Grep via path", async () => {
      expect(isDeny(await call(guard, "Grep", { path: "/etc", pattern: "root" }))).toBe(true);
    });

    it("allows Glob without path (defaults to cwd in SDK)", async () => {
      expect(isAllow(await call(guard, "Glob", { pattern: "*.ts" }))).toBe(true);
    });

    it("allows Grep without path (defaults to cwd in SDK)", async () => {
      expect(isAllow(await call(guard, "Grep", { pattern: "TODO" }))).toBe(true);
    });
  });

  describe("non-file tools", () => {
    const guard = createDirectoryGuard("controlled", CWD, []);

    it("allows Bash", async () => {
      expect(isAllow(await call(guard, "Bash", { command: "rm -rf /" }))).toBe(true);
    });

    it("allows WebSearch", async () => {
      expect(isAllow(await call(guard, "WebSearch", { query: "test" }))).toBe(true);
    });

    it("allows Task", async () => {
      expect(isAllow(await call(guard, "Task", { prompt: "do something" }))).toBe(true);
    });

    it("allows MCP tools", async () => {
      expect(isAllow(await call(guard, "mcp__memory__store", { key: "val" }))).toBe(true);
    });
  });

  describe("sandbox trust", () => {
    const guard = createDirectoryGuard("sandbox", CWD, []);

    it("enforces directory boundaries the same as controlled", async () => {
      expect(isDeny(await call(guard, "Read", { file_path: "/etc/passwd" }))).toBe(true);
      expect(isAllow(await call(guard, "Read", { file_path: `${CWD}/file.txt` }))).toBe(true);
    });
  });

  describe("unrestricted trust", () => {
    const guard = createDirectoryGuard("unrestricted", CWD, []);

    it("allows file reads anywhere", async () => {
      expect(isAllow(await call(guard, "Read", { file_path: "/etc/passwd" }))).toBe(true);
    });

    it("allows writes anywhere", async () => {
      expect(isAllow(await call(guard, "Write", { file_path: "/tmp/anything" }))).toBe(true);
    });

    it("allows non-file tools", async () => {
      expect(isAllow(await call(guard, "Bash", { command: "echo hi" }))).toBe(true);
    });
  });
});
