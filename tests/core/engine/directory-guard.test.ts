import { describe, it, expect } from "vitest";
import { createDirectoryGuard } from "#core/engine/directory-guard.js";

const CWD = "/home/user/project";

// Helper: call the guard with a minimal options object.
function call(guard: Awaited<ReturnType<typeof createDirectoryGuard>>, tool: string, input: Record<string, unknown>) {
  return guard(tool, input, { signal: AbortSignal.abort() } as any);
}

describe("createDirectoryGuard", () => {
  describe("controlled trust", () => {
    const guard = createDirectoryGuard("controlled", CWD, ["/shared/data"]);

    it("allows Read inside cwd", async () => {
      const result = await call(guard, "Read", { file_path: "/home/user/project/src/index.ts" });
      expect(result).toEqual({ behavior: "allow" });
    });

    it("allows Read inside additional directory", async () => {
      const result = await call(guard, "Read", { file_path: "/shared/data/config.json" });
      expect(result).toEqual({ behavior: "allow" });
    });

    it("allows Read of cwd itself", async () => {
      const result = await call(guard, "Read", { file_path: CWD });
      expect(result).toEqual({ behavior: "allow" });
    });

    it("denies Read outside allowed directories", async () => {
      const result = await call(guard, "Read", { file_path: "/etc/passwd" });
      expect(result).toEqual({
        behavior: "deny",
        message: "Access denied: /etc/passwd is outside allowed directories",
      });
    });

    it("denies paths that share a prefix but aren't inside the directory", async () => {
      const result = await call(guard, "Read", { file_path: "/home/user/project-other/file.txt" });
      expect(result).toEqual({
        behavior: "deny",
        message: "Access denied: /home/user/project-other/file.txt is outside allowed directories",
      });
    });

    it("denies traversal via ../", async () => {
      const result = await call(guard, "Read", { file_path: "/home/user/project/../../../etc/passwd" });
      expect(result).toEqual({
        behavior: "deny",
        message: "Access denied: /etc/passwd is outside allowed directories",
      });
    });

    it("resolves relative paths against cwd", async () => {
      const result = await call(guard, "Read", { file_path: "src/index.ts" });
      expect(result).toEqual({ behavior: "allow" });
    });

    it("denies relative path that escapes cwd", async () => {
      const result = await call(guard, "Read", { file_path: "../../etc/shadow" });
      expect(result).toEqual({
        behavior: "deny",
        message: expect.stringContaining("is outside allowed directories"),
      });
    });
  });

  describe("file tool variants", () => {
    const guard = createDirectoryGuard("controlled", CWD, []);

    it("checks Write via file_path", async () => {
      const result = await call(guard, "Write", { file_path: "/etc/hosts" });
      expect(result.behavior).toBe("deny");
    });

    it("checks Edit via file_path", async () => {
      const result = await call(guard, "Edit", { file_path: "/etc/hosts" });
      expect(result.behavior).toBe("deny");
    });

    it("checks NotebookEdit via notebook_path", async () => {
      const result = await call(guard, "NotebookEdit", { notebook_path: "/etc/notebook.ipynb" });
      expect(result.behavior).toBe("deny");
    });

    it("checks Glob via path", async () => {
      const result = await call(guard, "Glob", { path: "/etc", pattern: "*.conf" });
      expect(result.behavior).toBe("deny");
    });

    it("checks Grep via path", async () => {
      const result = await call(guard, "Grep", { path: "/etc", pattern: "root" });
      expect(result.behavior).toBe("deny");
    });

    it("allows Glob without path (defaults to cwd in SDK)", async () => {
      const result = await call(guard, "Glob", { pattern: "*.ts" });
      expect(result).toEqual({ behavior: "allow" });
    });

    it("allows Grep without path (defaults to cwd in SDK)", async () => {
      const result = await call(guard, "Grep", { pattern: "TODO" });
      expect(result).toEqual({ behavior: "allow" });
    });
  });

  describe("non-file tools", () => {
    const guard = createDirectoryGuard("controlled", CWD, []);

    it("allows Bash", async () => {
      expect(await call(guard, "Bash", { command: "rm -rf /" })).toEqual({ behavior: "allow" });
    });

    it("allows WebSearch", async () => {
      expect(await call(guard, "WebSearch", { query: "test" })).toEqual({ behavior: "allow" });
    });

    it("allows Task", async () => {
      expect(await call(guard, "Task", { prompt: "do something" })).toEqual({ behavior: "allow" });
    });

    it("allows MCP tools", async () => {
      expect(await call(guard, "mcp__memory__store", { key: "val" })).toEqual({ behavior: "allow" });
    });
  });

  describe("sandbox trust", () => {
    const guard = createDirectoryGuard("sandbox", CWD, []);

    it("enforces directory boundaries the same as controlled", async () => {
      expect((await call(guard, "Read", { file_path: "/etc/passwd" })).behavior).toBe("deny");
      expect((await call(guard, "Read", { file_path: `${CWD}/file.txt` })).behavior).toBe("allow");
    });
  });

  describe("unrestricted trust", () => {
    const guard = createDirectoryGuard("unrestricted", CWD, []);

    it("allows file reads anywhere", async () => {
      expect(await call(guard, "Read", { file_path: "/etc/passwd" })).toEqual({ behavior: "allow" });
    });

    it("allows writes anywhere", async () => {
      expect(await call(guard, "Write", { file_path: "/tmp/anything" })).toEqual({ behavior: "allow" });
    });

    it("allows non-file tools", async () => {
      expect(await call(guard, "Bash", { command: "echo hi" })).toEqual({ behavior: "allow" });
    });
  });
});
