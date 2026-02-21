import { describe, it, expect, vi } from "vitest";
import { trustOptions } from "#core/security.js";

// Mock the logger
vi.mock("#core/logger.js", () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("trustOptions", () => {
  describe("sandbox", () => {
    it("uses dontAsk permission mode", () => {
      const opts = trustOptions("sandbox");
      expect(opts.permissionMode).toBe("dontAsk");
    });

    it("allows web search and fetch", () => {
      const opts = trustOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("WebSearch");
      expect(allowed).toContain("WebFetch");
    });

    it("allows Task for subtasks", () => {
      const opts = trustOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("Task");
    });

    it("allows MCP memory tools", () => {
      const opts = trustOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("mcp__memory__*");
    });

    it("does not allow file operations", () => {
      const opts = trustOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).not.toContain("Read");
      expect(allowed).not.toContain("Write");
      expect(allowed).not.toContain("Edit");
      expect(allowed).not.toContain("Glob");
      expect(allowed).not.toContain("Grep");
    });

    it("does not allow Bash", () => {
      const opts = trustOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).not.toContain("Bash");
    });

    it("does not bypass permissions", () => {
      const opts = trustOptions("sandbox");
      expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
    });
  });

  describe("default", () => {
    it("uses dontAsk permission mode", () => {
      const opts = trustOptions("default");
      expect(opts.permissionMode).toBe("dontAsk");
    });

    it("allows file operations", () => {
      const opts = trustOptions("default");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("Read");
      expect(allowed).toContain("Write");
      expect(allowed).toContain("Edit");
      expect(allowed).toContain("Glob");
      expect(allowed).toContain("Grep");
    });

    it("allows web tools", () => {
      const opts = trustOptions("default");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("WebSearch");
      expect(allowed).toContain("WebFetch");
    });

    it("allows Task and NotebookEdit", () => {
      const opts = trustOptions("default");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("Task");
      expect(allowed).toContain("NotebookEdit");
    });

    it("allows MCP tools via wildcards", () => {
      const opts = trustOptions("default");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("mcp__memory__*");
      expect(allowed).toContain("mcp__triggers__*");
      expect(allowed).toContain("mcp__agents__*");
      expect(allowed).toContain("mcp__ask-agent__*");
    });

    it("explicitly disallows Bash", () => {
      const opts = trustOptions("default");
      const disallowed = opts.disallowedTools as string[];
      expect(disallowed).toContain("Bash");
    });

    it("does not bypass permissions", () => {
      const opts = trustOptions("default");
      expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
    });
  });

  describe("unrestricted", () => {
    it("uses bypassPermissions mode", () => {
      const opts = trustOptions("unrestricted");
      expect(opts.permissionMode).toBe("bypassPermissions");
    });

    it("enables dangerous skip permissions", () => {
      const opts = trustOptions("unrestricted");
      expect(opts.allowDangerouslySkipPermissions).toBe(true);
    });

    it("does not restrict tools", () => {
      const opts = trustOptions("unrestricted");
      expect(opts.allowedTools).toBeUndefined();
      expect(opts.disallowedTools).toBeUndefined();
    });
  });

  describe("no argument", () => {
    it("defaults to default when not specified", () => {
      const opts = trustOptions();
      expect(opts.permissionMode).toBe("dontAsk");
      const disallowed = opts.disallowedTools as string[];
      expect(disallowed).toContain("Bash");
    });
  });
});
