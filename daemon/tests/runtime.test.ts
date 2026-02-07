import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRuntime } from "../src/core/runtime.js";
import type { Engine, EngineOptions, EngineResult } from "../src/core/engine/index.js";

// Mock the logger
vi.mock("../src/core/logger.js", () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockEngine(): Engine & { calls: Array<{ message: string; options: EngineOptions; sessionId?: string }> } {
  const mock: Engine & { calls: Array<{ message: string; options: EngineOptions; sessionId?: string }> } = {
    calls: [],
    async run(message, options, sessionId, callbacks, abortController): Promise<EngineResult> {
      mock.calls.push({ message, options, sessionId });
      return { text: "response", sessionId: "sess-123" };
    },
  };
  return mock;
}

describe("Runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes message and options to engine", async () => {
    const mockEngine = createMockEngine();
    const rt = createRuntime(mockEngine);

    await rt.run(
      "Hello",
      { cwd: "/test", systemPrompt: "Be helpful", model: "sonnet" },
      "standard"
    );

    expect(mockEngine.calls).toHaveLength(1);
    expect(mockEngine.calls[0]?.message).toBe("Hello");
    expect(mockEngine.calls[0]?.options.cwd).toBe("/test");
    expect(mockEngine.calls[0]?.options.systemPrompt).toBe("Be helpful");
    expect(mockEngine.calls[0]?.options.model).toBe("sonnet");
  });

  it("merges security options into engine options", async () => {
    const mockEngine = createMockEngine();
    const rt = createRuntime(mockEngine);

    await rt.run("Hello", { cwd: "/test" }, "standard");

    // Security options should be present (exact values tested in security.test.ts)
    expect(mockEngine.calls[0]?.options.permissionMode).toBeDefined();
  });

  it("forwards sessionId to engine", async () => {
    const mockEngine = createMockEngine();
    const rt = createRuntime(mockEngine);

    await rt.run("Hello", {}, "standard", "sess-existing");

    expect(mockEngine.calls[0]?.sessionId).toBe("sess-existing");
  });

  it("forwards callbacks to engine", async () => {
    const mockEngine = createMockEngine();
    const runSpy = vi.spyOn(mockEngine, "run");
    const rt = createRuntime(mockEngine);
    const callbacks = { onToolUse: vi.fn() };

    await rt.run("Hello", {}, "standard", undefined, callbacks);

    expect(runSpy).toHaveBeenCalledWith(
      "Hello",
      expect.any(Object),
      undefined,
      callbacks,
      undefined
    );
  });

  it("forwards abortController to engine", async () => {
    const mockEngine = createMockEngine();
    const runSpy = vi.spyOn(mockEngine, "run");
    const rt = createRuntime(mockEngine);
    const abortController = new AbortController();

    await rt.run("Hello", {}, "standard", undefined, undefined, abortController);

    expect(runSpy).toHaveBeenCalledWith(
      "Hello",
      expect.any(Object),
      undefined,
      undefined,
      abortController
    );
  });

  it("returns engine result", async () => {
    const mockEngine = createMockEngine();
    const rt = createRuntime(mockEngine);

    const result = await rt.run("Hello", {}, "standard");

    expect(result.text).toBe("response");
    expect(result.sessionId).toBe("sess-123");
  });

  it("requires security level parameter", async () => {
    const mockEngine = createMockEngine();
    const rt = createRuntime(mockEngine);

    // TypeScript enforces this, but we verify the call works with each level
    await rt.run("Hello", {}, "sandbox");
    await rt.run("Hello", {}, "standard");
    await rt.run("Hello", {}, "unrestricted");

    expect(mockEngine.calls).toHaveLength(3);
  });
});
