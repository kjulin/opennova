import { describe, it, expect, vi } from "vitest";
import { permissionOptions } from "#core/security.js";

// Mock the logger
vi.mock("#core/logger.js", () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("permissionOptions", () => {
  it("uses dontAsk permission mode", () => {
    const opts = permissionOptions();
    expect(opts.permissionMode).toBe("dontAsk");
  });

  it("disallows Task and TaskOutput", () => {
    const opts = permissionOptions();
    const disallowed = opts.disallowedTools as string[];
    expect(disallowed).toContain("Task");
    expect(disallowed).toContain("TaskOutput");
  });

  it("allows standard file tools", () => {
    const opts = permissionOptions();
    const allowed = opts.allowedTools as string[];
    expect(allowed).toContain("Read");
    expect(allowed).toContain("Write");
    expect(allowed).toContain("Edit");
    expect(allowed).toContain("Glob");
    expect(allowed).toContain("Grep");
    expect(allowed).toContain("NotebookEdit");
  });

  it("allows Bash", () => {
    const opts = permissionOptions();
    const allowed = opts.allowedTools as string[];
    expect(allowed).toContain("Bash");
  });

  it("allows web tools", () => {
    const opts = permissionOptions();
    const allowed = opts.allowedTools as string[];
    expect(allowed).toContain("WebSearch");
    expect(allowed).toContain("WebFetch");
  });

  it("allows MCP tools via wildcards", () => {
    const opts = permissionOptions();
    const allowed = opts.allowedTools as string[];
    expect(allowed).toContain("mcp__memory__*");
    expect(allowed).toContain("mcp__triggers__*");
    expect(allowed).toContain("mcp__agents__*");
    expect(allowed).toContain("mcp__agent-management__*");
  });

  it("appends extra allowed tools", () => {
    const opts = permissionOptions(["mcp__custom__*"]);
    const allowed = opts.allowedTools as string[];
    expect(allowed).toContain("mcp__custom__*");
    expect(allowed).toContain("Bash");
  });

  it("does not bypass permissions", () => {
    const opts = permissionOptions();
    expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
  });
});
