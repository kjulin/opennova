import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgentRunner } from "#core/agent-runner.js";
import type { Engine, EngineResult } from "#core/engine/index.js";

// Mock all dependencies
vi.mock("#core/logger.js", () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { mockThreadStore } = vi.hoisted(() => ({
  mockThreadStore: {
    get: vi.fn(() => ({ sessionId: "sess-123" })),
    withLock: vi.fn((_threadId: string, fn: () => unknown) => fn()),
    appendMessage: vi.fn(),
    appendEvent: vi.fn(),
    loadMessages: vi.fn(() => []),
    updateManifest: vi.fn(),
    create: vi.fn(),
    list: vi.fn(() => []),
    delete: vi.fn(),
    loadEvents: vi.fn(() => []),
    search: vi.fn(),
    backfill: vi.fn(),
  },
}));

vi.mock("#core/threads/index.js", () => ({
  threadStore: mockThreadStore,
}));

const testAgent = { id: "test-agent", name: "Test Agent", role: "Test role", trust: "controlled", model: "sonnet", capabilities: { memory: {} } };

vi.mock("#core/agents/index.js", () => ({
  agentStore: {
    get: vi.fn((id: string) => id === "test-agent" ? testAgent : null),
    list: vi.fn(() => new Map([["test-agent", testAgent]])),
  },
  loadAgents: vi.fn(() => new Map([["test-agent", testAgent]])),
  buildSystemPrompt: vi.fn(() => "System prompt"),
  getAgentCwd: vi.fn(() => "/test/cwd"),
  getAgentDirectories: vi.fn(() => []),
}));

vi.mock("#core/capabilities/index.js", () => ({
  capabilityRegistry: { resolve: vi.fn(() => ({})) },
  resolveInjections: vi.fn(() => ({})),
}));

vi.mock("#core/usage.js", () => ({
  appendUsage: vi.fn(),
  createUsageMcpServer: vi.fn(() => ({})),
}));

vi.mock("#core/engine/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("#core/engine/index.js")>();
  return {
    ...original,
    generateThreadTitle: vi.fn(() => Promise.resolve({ title: null })),
  };
});

import { appendUsage } from "#core/usage.js";

function createMockEngine(): Engine & { calls: Array<{ message: string; trust: string }> } {
  const mock: Engine & { calls: Array<{ message: string; trust: string }> } = {
    calls: [],
    async run(message, options, trust, sessionId, callbacks, abortController): Promise<EngineResult> {
      mock.calls.push({ message, trust });
      return { text: "Response from engine", sessionId: "sess-456" };
    },
  };
  return mock;
}

describe("AgentRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-setup default mock return values after clearAllMocks
    mockThreadStore.get.mockReturnValue({ sessionId: "sess-123" });
    mockThreadStore.withLock.mockImplementation((_threadId: string, fn: () => unknown) => fn());
    mockThreadStore.loadMessages.mockReturnValue([]);
  });

  it("appends user message to thread", async () => {
    const mockEngine = createMockEngine();
    const runner = createAgentRunner(mockEngine);

    await runner.runAgent("/agents/test-agent", "thread-1", "Hello");

    expect(mockThreadStore.appendMessage).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        role: "user",
        text: "Hello",
      })
    );
  });

  it("calls engine with message and trust level", async () => {
    const mockEngine = createMockEngine();
    const runner = createAgentRunner(mockEngine);

    await runner.runAgent("/agents/test-agent", "thread-1", "Hello");

    expect(mockEngine.calls).toHaveLength(1);
    expect(mockEngine.calls[0]?.message).toBe("Hello");
    expect(mockEngine.calls[0]?.trust).toBe("controlled");
  });

  it("appends assistant message to thread", async () => {
    const mockEngine = createMockEngine();
    const runner = createAgentRunner(mockEngine);

    await runner.runAgent("/agents/test-agent", "thread-1", "Hello");

    expect(mockThreadStore.appendMessage).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        role: "assistant",
        text: "Response from engine",
      })
    );
  });

  it("updates manifest with sessionId", async () => {
    const mockEngine = createMockEngine();
    const runner = createAgentRunner(mockEngine);

    await runner.runAgent("/agents/test-agent", "thread-1", "Hello");

    expect(mockThreadStore.updateManifest).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        sessionId: "sess-456",
      })
    );
  });

  it("fires onResponse callback", async () => {
    const mockEngine = createMockEngine();
    const runner = createAgentRunner(mockEngine);
    const onResponse = vi.fn();

    await runner.runAgent("/agents/test-agent", "thread-1", "Hello", { onResponse });

    expect(onResponse).toHaveBeenCalledWith(
      "test-agent",
      "thread-1",
      "Response from engine"
    );
  });

  it("records usage when present", async () => {
    const mockEngine: Engine = {
      async run() {
        return {
          text: "Response",
          sessionId: "sess-456",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            cacheCreationTokens: 5,
            costUsd: 0.01,
            durationMs: 1000,
            durationApiMs: 800,
            turns: 2,
            model: "opus",
          },
        };
      },
    };
    const runner = createAgentRunner(mockEngine);

    await runner.runAgent("/agents/test-agent", "thread-1", "Hello");

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
    const mockEngine = createMockEngine();
    const runner = createAgentRunner(mockEngine);

    const result = await runner.runAgent("/agents/test-agent", "thread-1", "Hello");

    expect(result.text).toBe("Response from engine");
  });

  it("handles empty response", async () => {
    const mockEngine: Engine = {
      async run() {
        return { text: "" };
      },
    };
    const runner = createAgentRunner(mockEngine);

    const result = await runner.runAgent("/agents/test-agent", "thread-1", "Hello");

    expect(result.text).toBe("(empty response)");
  });

  it("throws for unknown agent", async () => {
    const mockEngine = createMockEngine();
    const runner = createAgentRunner(mockEngine);

    await expect(
      runner.runAgent("/agents/unknown-agent", "thread-1", "Hello")
    ).rejects.toThrow("Agent not found: unknown-agent");
  });

  it("handles abort gracefully", async () => {
    const abortController = new AbortController();
    const mockEngine: Engine = {
      async run() {
        abortController.abort();
        throw new Error("Aborted");
      },
    };
    const runner = createAgentRunner(mockEngine);

    const result = await runner.runAgent(
      "/agents/test-agent",
      "thread-1",
      "Hello",
      undefined,
      undefined,
      undefined,
      abortController
    );

    expect(result.text).toBe("");
    expect(mockThreadStore.appendMessage).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        role: "assistant",
        text: "(stopped by user)",
      })
    );
  });

  it("fires onError callback on error", async () => {
    const mockEngine: Engine = {
      async run() {
        throw new Error("Engine failed");
      },
    };
    const runner = createAgentRunner(mockEngine);
    const onError = vi.fn();

    await expect(
      runner.runAgent("/agents/test-agent", "thread-1", "Hello", { onError })
    ).rejects.toThrow("Engine failed");

    expect(onError).toHaveBeenCalledWith(
      "test-agent",
      "thread-1",
      "Engine failed"
    );
  });
});
