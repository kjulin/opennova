import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { buildMemoryIndexBlock } from "#core/prompts/agent.js";

describe("buildMemoryIndexBlock", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty string when no agentDir provided", () => {
    expect(buildMemoryIndexBlock()).toBe("");
  });

  it("returns empty string when no memory.md exists", () => {
    expect(buildMemoryIndexBlock(tmpDir)).toBe("");
  });

  it("returns empty string when memory.md is empty", () => {
    fs.writeFileSync(path.join(tmpDir, "memory.md"), "");
    expect(buildMemoryIndexBlock(tmpDir)).toBe("");
  });

  it("returns AgentMemory block with content", () => {
    const content = "# My Notes\n- fact one\n- fact two";
    fs.writeFileSync(path.join(tmpDir, "memory.md"), content);
    const result = buildMemoryIndexBlock(tmpDir);
    expect(result).toContain("<AgentMemory>");
    expect(result).toContain("# My Notes");
    expect(result).toContain("- fact one");
    expect(result).toContain("</AgentMemory>");
    expect(result).not.toContain("Truncated");
  });

  it("truncates at 200 lines and adds comment", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(tmpDir, "memory.md"), lines.join("\n"));
    const result = buildMemoryIndexBlock(tmpDir);
    expect(result).toContain("<AgentMemory>");
    expect(result).toContain("line 1");
    expect(result).toContain("line 200");
    expect(result).not.toContain("line 201");
    expect(result).toContain("Truncated: showing 200 of 250 lines");
    expect(result).toContain("</AgentMemory>");
  });

  it("does not truncate exactly 200 lines", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(tmpDir, "memory.md"), lines.join("\n"));
    const result = buildMemoryIndexBlock(tmpDir);
    expect(result).toContain("line 200");
    expect(result).not.toContain("Truncated");
  });
});
