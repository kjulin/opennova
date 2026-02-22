import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClaudeEngine } from "#core/engine/claude.js";
import type { EngineCallbacks } from "#core/engine/types.js";

// Mock the SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// Mock the logger
vi.mock("#core/logger.js", () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { query } from "@anthropic-ai/claude-agent-sdk";

const mockQuery = vi.mocked(query);

describe("ClaudeEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls SDK with message and options", async () => {
    async function* mockGenerator() {
      yield {
        type: "result",
        subtype: "success",
        result: "Hello from Claude",
        session_id: "sess-123",
        total_cost_usd: 0.01,
        duration_ms: 100,
        num_turns: 1,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      };
    }
    mockQuery.mockReturnValue(mockGenerator());

    const engine = createClaudeEngine();
    const result = await engine.run("Hello", {
      cwd: "/test",
      systemPrompt: "You are helpful",
      model: "sonnet",
    }, "controlled");

    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "Hello",
      options: expect.objectContaining({
        cwd: "/test",
        systemPrompt: "You are helpful",
        model: "sonnet",
        settingSources: ["project"],
        // Trust "controlled" adds permissionMode, allowedTools, disallowedTools
        permissionMode: "dontAsk",
        disallowedTools: ["Bash"],
      }),
    });

    expect(result.text).toBe("Hello from Claude");
    expect(result.sessionId).toBe("sess-123");
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      costUsd: 0.01,
      durationMs: 100,
      turns: 1,
    });
  });

  it("resumes session when sessionId provided", async () => {
    async function* mockGenerator() {
      yield {
        type: "result",
        subtype: "success",
        result: "Resumed",
        session_id: "sess-123",
        total_cost_usd: 0.01,
        duration_ms: 50,
        num_turns: 1,
      };
    }
    mockQuery.mockReturnValue(mockGenerator());

    const engine = createClaudeEngine();
    await engine.run("Continue", {}, "controlled", "sess-123");

    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "Continue",
      options: expect.objectContaining({
        model: "opus",
        resume: "sess-123",
        settingSources: ["project"],
        permissionMode: "dontAsk",
      }),
    });
  });

  it("retries without session on resume failure", async () => {
    let callCount = 0;
    mockQuery.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Session expired");
      }
      async function* mockGenerator() {
        yield {
          type: "result",
          subtype: "success",
          result: "Fresh start",
          session_id: "sess-456",
          total_cost_usd: 0.01,
          duration_ms: 50,
          num_turns: 1,
        };
      }
      return mockGenerator();
    });

    const engine = createClaudeEngine();
    const result = await engine.run("Hello", {}, "controlled", "old-session");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("Fresh start");
  });

  it("fires onToolUse callback for tool use blocks", async () => {
    async function* mockGenerator() {
      yield {
        type: "assistant",
        message: {
          session_id: "sess-123",
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "/test.txt" } },
          ],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        result: "Done",
        session_id: "sess-123",
        total_cost_usd: 0.01,
        duration_ms: 100,
        num_turns: 1,
      };
    }
    mockQuery.mockReturnValue(mockGenerator());

    const callbacks: EngineCallbacks = {
      onToolUse: vi.fn(),
    };

    const engine = createClaudeEngine();
    await engine.run("Read file", {}, "controlled", undefined, callbacks);

    expect(callbacks.onToolUse).toHaveBeenCalledWith(
      "Read",
      { file_path: "/test.txt" },
      "Reading test.txt…"
    );
  });

  it("fires onAssistantMessage for text with tool use", async () => {
    async function* mockGenerator() {
      yield {
        type: "assistant",
        message: {
          session_id: "sess-123",
          content: [
            { type: "text", text: "Let me check that file" },
            { type: "tool_use", name: "Read", input: { file_path: "/test.txt" } },
          ],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        result: "Done",
        session_id: "sess-123",
        total_cost_usd: 0.01,
        duration_ms: 100,
        num_turns: 1,
      };
    }
    mockQuery.mockReturnValue(mockGenerator());

    const callbacks: EngineCallbacks = {
      onAssistantMessage: vi.fn(),
    };

    const engine = createClaudeEngine();
    await engine.run("Read file", {}, "controlled", undefined, callbacks);

    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith("Let me check that file");
  });

  it("applies trust level to SDK options", async () => {
    async function* mockGenerator() {
      yield {
        type: "result",
        subtype: "success",
        result: "OK",
        session_id: "sess-123",
        total_cost_usd: 0.01,
        duration_ms: 50,
        num_turns: 1,
      };
    }
    mockQuery.mockReturnValue(mockGenerator());

    const engine = createClaudeEngine();
    await engine.run("Hello", {}, "unrestricted");

    expect(mockQuery).toHaveBeenCalledWith({
      prompt: "Hello",
      options: expect.objectContaining({
        model: "opus",
        settingSources: ["project"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      }),
    });
  });

  it("derives MCP tool patterns from mcpServers", async () => {
    async function* mockGenerator() {
      yield {
        type: "result",
        subtype: "success",
        result: "OK",
        session_id: "sess-123",
        total_cost_usd: 0.01,
        duration_ms: 50,
        num_turns: 1,
      };
    }
    mockQuery.mockReturnValue(mockGenerator());

    const engine = createClaudeEngine();
    await engine.run("Hello", {
      mcpServers: {
        memory: {} as any,
        "custom-cap": {} as any,
      },
    }, "sandbox");

    const call = mockQuery.mock.calls[0]?.[0] as { options: { allowedTools?: string[] } };
    const allowedTools = call.options.allowedTools ?? [];
    expect(allowedTools).toContain("mcp__memory__*");
    expect(allowedTools).toContain("mcp__custom-cap__*");
  });

  it("returns empty text when aborted", async () => {
    const abortController = new AbortController();

    async function* mockGenerator() {
      abortController.abort();
      yield {
        type: "result",
        subtype: "success",
        result: "Partial",
        session_id: "sess-123",
        total_cost_usd: 0.01,
        duration_ms: 50,
        num_turns: 1,
      };
    }
    mockQuery.mockReturnValue(mockGenerator());

    const engine = createClaudeEngine();
    const result = await engine.run("Hello", {}, "controlled", undefined, undefined, abortController);

    expect(result.text).toBe("");
  });
});
