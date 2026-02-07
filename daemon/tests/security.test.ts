import { describe, it, expect, vi } from "vitest";
import { securityOptions } from "../src/core/security.js";

// Mock the logger
vi.mock("../src/core/logger.js", () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("securityOptions", () => {
  describe("sandbox", () => {
    it("uses dontAsk permission mode", () => {
      const opts = securityOptions("sandbox");
      expect(opts.permissionMode).toBe("dontAsk");
    });

    it("allows web search and fetch", () => {
      const opts = securityOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("WebSearch");
      expect(allowed).toContain("WebFetch");
    });

    it("allows Task for subtasks", () => {
      const opts = securityOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("Task");
    });

    it("allows MCP memory tools", () => {
      const opts = securityOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("mcp__memory__*");
    });

    it("does not allow file operations", () => {
      const opts = securityOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).not.toContain("Read");
      expect(allowed).not.toContain("Write");
      expect(allowed).not.toContain("Edit");
      expect(allowed).not.toContain("Glob");
      expect(allowed).not.toContain("Grep");
    });

    it("does not allow Bash", () => {
      const opts = securityOptions("sandbox");
      const allowed = opts.allowedTools as string[];
      expect(allowed).not.toContain("Bash");
    });

    it("does not bypass permissions", () => {
      const opts = securityOptions("sandbox");
      expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
    });
  });

  describe("standard", () => {
    it("uses dontAsk permission mode", () => {
      const opts = securityOptions("standard");
      expect(opts.permissionMode).toBe("dontAsk");
    });

    it("allows file operations", () => {
      const opts = securityOptions("standard");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("Read");
      expect(allowed).toContain("Write");
      expect(allowed).toContain("Edit");
      expect(allowed).toContain("Glob");
      expect(allowed).toContain("Grep");
    });

    it("allows web tools", () => {
      const opts = securityOptions("standard");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("WebSearch");
      expect(allowed).toContain("WebFetch");
    });

    it("allows Task and NotebookEdit", () => {
      const opts = securityOptions("standard");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("Task");
      expect(allowed).toContain("NotebookEdit");
    });

    it("allows MCP tools via wildcards", () => {
      const opts = securityOptions("standard");
      const allowed = opts.allowedTools as string[];
      expect(allowed).toContain("mcp__memory__*");
      expect(allowed).toContain("mcp__triggers__*");
      expect(allowed).toContain("mcp__agents__*");
      expect(allowed).toContain("mcp__ask-agent__*");
      expect(allowed).toContain("mcp__usage__*");
    });

    it("explicitly disallows Bash", () => {
      const opts = securityOptions("standard");
      const disallowed = opts.disallowedTools as string[];
      expect(disallowed).toContain("Bash");
    });

    it("does not bypass permissions", () => {
      const opts = securityOptions("standard");
      expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
    });
  });

  describe("unrestricted", () => {
    it("uses bypassPermissions mode", () => {
      const opts = securityOptions("unrestricted");
      expect(opts.permissionMode).toBe("bypassPermissions");
    });

    it("enables dangerous skip permissions", () => {
      const opts = securityOptions("unrestricted");
      expect(opts.allowDangerouslySkipPermissions).toBe(true);
    });

    it("does not restrict tools", () => {
      const opts = securityOptions("unrestricted");
      expect(opts.allowedTools).toBeUndefined();
      expect(opts.disallowedTools).toBeUndefined();
    });
  });

  describe("default", () => {
    it("defaults to standard when not specified", () => {
      const opts = securityOptions();
      expect(opts.permissionMode).toBe("dontAsk");
      const disallowed = opts.disallowedTools as string[];
      expect(disallowed).toContain("Bash");
    });
  });
});
