import { describe, it, expect, vi, beforeEach } from "vitest";
import { createThreadRunner } from "../src/core/thread-runner.js";
import type { Runtime } from "../src/core/runtime.js";
import type { EngineResult } from "../src/core/engine/index.js";

// Mock all dependencies
vi.mock("../src/core/logger.js", () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/core/threads.js", () => ({
  threadPath: vi.fn((agentDir, threadId) => `${agentDir}/threads/${threadId}.jsonl`),
  loadManifest: vi.fn(() => ({ channel: "test", sessionId: "sess-123" })),
  saveManifest: vi.fn(),
  loadMessages: vi.fn(() => []),
  appendMessage: vi.fn(),
  withThreadLock: vi.fn((threadId, fn) => fn()),
}));

vi.mock("../src/core/agents.js", () => ({
  loadAgents: vi.fn(() => new Map([
    ["test-agent", { name: "Test Agent", role: "Test role" }],
  ])),
  buildSystemPrompt: vi.fn(() => "System prompt"),
  getAgentCwd: vi.fn(() => "/test/cwd"),
  getAgentDirectories: vi.fn(() => []),
  resolveSecurityLevel: vi.fn(() => "standard"),
}));

vi.mock("../src/core/memory.js", () => ({
  createMemoryMcpServer: vi.fn(() => ({})),
}));

vi.mock("../src/core/agent-management.js", () => ({
  createAgentManagementMcpServer: vi.fn(() => ({})),
}));

vi.mock("../src/core/ask-agent.js", () => ({
  createAskAgentMcpServer: vi.fn(() => ({})),
}));

vi.mock("../src/core/usage.js", () => ({
  appendUsage: vi.fn(),
  createUsageMcpServer: vi.fn(() => ({})),
}));

vi.mock("../src/core/claude.js", () => ({
  generateThreadTitle: vi.fn(() => Promise.resolve(null)),
}));

import { appendMessage, saveManifest } from "../src/core/threads.js";
import { appendUsage } from "../src/core/usage.js";

function createMockRuntime(): Runtime & { calls: Array<{ message: string; security: string }> } {
  const mock: Runtime & { calls: Array<{ message: string; security: string }> } = {
    calls: [],
    async run(message, options, security, sessionId, callbacks, abortController): Promise<EngineResult> {
      mock.calls.push({ message, security });
      return { text: "Response from runtime", sessionId: "sess-456" };
    },
  };
  return mock;
}

describe("ThreadRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends user message to thread", async () => {
    const mockRuntime = createMockRuntime();
    const runner = createThreadRunner(mockRuntime);

    await runner.runThread("/agents/test-agent", "thread-1", "Hello");

    expect(appendMessage).toHaveBeenCalledWith(
      "/agents/test-agent/threads/thread-1.jsonl",
      expect.objectContaining({
        role: "user",
        text: "Hello",
      })
    );
  });

  it("calls runtime with message and security level", async () => {
    const mockRuntime = createMockRuntime();
    const runner = createThreadRunner(mockRuntime);

    await runner.runThread("/agents/test-agent", "thread-1", "Hello");

    expect(mockRuntime.calls).toHaveLength(1);
    expect(mockRuntime.calls[0]?.message).toBe("Hello");
    expect(mockRuntime.calls[0]?.security).toBe("standard");
  });

  it("appends assistant message to thread", async () => {
    const mockRuntime = createMockRuntime();
    const runner = createThreadRunner(mockRuntime);

    await runner.runThread("/agents/test-agent", "thread-1", "Hello");

    expect(appendMessage).toHaveBeenCalledWith(
      "/agents/test-agent/threads/thread-1.jsonl",
      expect.objectContaining({
        role: "assistant",
        text: "Response from runtime",
      })
    );
  });

  it("saves manifest with updated sessionId", async () => {
    const mockRuntime = createMockRuntime();
    const runner = createThreadRunner(mockRuntime);

    await runner.runThread("/agents/test-agent", "thread-1", "Hello");

    expect(saveManifest).toHaveBeenCalledWith(
      "/agents/test-agent/threads/thread-1.jsonl",
      expect.objectContaining({
        sessionId: "sess-456",
      })
    );
  });

  it("fires onThreadResponse callback", async () => {
    const mockRuntime = createMockRuntime();
    const runner = createThreadRunner(mockRuntime);
    const onThreadResponse = vi.fn();

    await runner.runThread("/agents/test-agent", "thread-1", "Hello", { onThreadResponse });

    expect(onThreadResponse).toHaveBeenCalledWith(
      "test-agent",
      "thread-1",
      "test",
      "Response from runtime"
    );
  });

  it("records usage when present", async () => {
    const mockRuntime: Runtime = {
      async run() {
        return {
          text: "Response",
          sessionId: "sess-456",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            durationMs: 1000,
            turns: 2,
          },
        };
      },
    };
    const runner = createThreadRunner(mockRuntime);

    await runner.runThread("/agents/test-agent", "thread-1", "Hello");

    expect(appendUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "test-agent",
        threadId: "thread-1",
        inputTokens: 100,
        outputTokens: 50,
      })
    );
  });

  it("returns response text", async () => {
    const mockRuntime = createMockRuntime();
    const runner = createThreadRunner(mockRuntime);

    const result = await runner.runThread("/agents/test-agent", "thread-1", "Hello");

    expect(result.text).toBe("Response from runtime");
  });

  it("handles empty response", async () => {
    const mockRuntime: Runtime = {
      async run() {
        return { text: "" };
      },
    };
    const runner = createThreadRunner(mockRuntime);

    const result = await runner.runThread("/agents/test-agent", "thread-1", "Hello");

    expect(result.text).toBe("(empty response)");
  });

  it("throws for unknown agent", async () => {
    const mockRuntime = createMockRuntime();
    const runner = createThreadRunner(mockRuntime);

    await expect(
      runner.runThread("/agents/unknown-agent", "thread-1", "Hello")
    ).rejects.toThrow("Agent not found: unknown-agent");
  });

  it("handles abort gracefully", async () => {
    const abortController = new AbortController();
    const mockRuntime: Runtime = {
      async run() {
        abortController.abort();
        throw new Error("Aborted");
      },
    };
    const runner = createThreadRunner(mockRuntime);

    const result = await runner.runThread(
      "/agents/test-agent",
      "thread-1",
      "Hello",
      undefined,
      undefined,
      undefined,
      abortController
    );

    expect(result.text).toBe("");
    expect(appendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        role: "assistant",
        text: "(stopped by user)",
      })
    );
  });

  it("fires onThreadError callback on error", async () => {
    const mockRuntime: Runtime = {
      async run() {
        throw new Error("Runtime failed");
      },
    };
    const runner = createThreadRunner(mockRuntime);
    const onThreadError = vi.fn();

    await expect(
      runner.runThread("/agents/test-agent", "thread-1", "Hello", { onThreadError })
    ).rejects.toThrow("Runtime failed");

    expect(onThreadError).toHaveBeenCalledWith(
      "test-agent",
      "thread-1",
      "test",
      "Runtime failed"
    );
  });
});
