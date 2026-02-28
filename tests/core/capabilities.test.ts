import { describe, it, expect, vi } from "vitest";

// Mock all MCP server creators
vi.mock("#core/memory.js", () => ({
  createMemoryMcpServer: vi.fn(() => ({ type: "sdk", name: "memory" })),
}));

vi.mock("#core/episodic/index.js", () => ({
  createHistoryMcpServer: vi.fn(() => ({ type: "sdk", name: "history" })),
}));

vi.mock("#tasks/index.js", () => ({
  createTasksMcpServer: vi.fn(() => ({ type: "sdk", name: "tasks" })),
}));

vi.mock("#notes/index.js", () => ({
  createNotesMcpServer: vi.fn(() => ({ type: "sdk", name: "notes" })),
}));

vi.mock("#core/agent-management.js", () => ({
  createSelfManagementMcpServer: vi.fn(() => ({ type: "sdk", name: "self" })),
  createAgentManagementMcpServer: vi.fn(() => ({ type: "sdk", name: "agent-management" })),
}));

vi.mock("#core/media/mcp.js", () => ({
  createMediaMcpServer: vi.fn(() => ({ type: "sdk", name: "media" })),
}));

vi.mock("#core/secrets.js", () => ({
  createSecretsMcpServer: vi.fn(() => ({ type: "sdk", name: "secrets" })),
}));

vi.mock("#core/ask-agent.js", () => ({
  createAgentsMcpServer: vi.fn(() => ({ type: "sdk", name: "agents" })),
}));

vi.mock("#core/triggers/index.js", () => ({
  createTriggerMcpServer: vi.fn(() => ({ type: "sdk", name: "triggers" })),
}));

import { resolveCapabilities, capabilityToolPatterns, KNOWN_CAPABILITIES, type ResolverContext } from "#core/capabilities.js";

function makeCtx(overrides?: Partial<ResolverContext>): ResolverContext {
  return {
    agentId: "test-agent",
    agentDir: "/agents/test-agent",
    workspaceDir: "/workspace",
    threadId: "thread-1",
    channel: "test",
    directories: [],
    callbacks: {},
    ...overrides,
  };
}

describe("resolveCapabilities", () => {
  it("returns empty for undefined capabilities", () => {
    expect(resolveCapabilities(undefined, makeCtx())).toEqual({});
  });

  it("returns empty for empty capabilities array", () => {
    expect(resolveCapabilities([], makeCtx())).toEqual({});
  });

  it("throws for unknown capability", () => {
    expect(() => resolveCapabilities(["nonexistent"], makeCtx())).toThrow(
      'Unknown capability: "nonexistent"'
    );
  });

  it("resolves known capabilities to servers", () => {
    const servers = resolveCapabilities(["memory", "tasks"], makeCtx());
    expect(Object.keys(servers)).toEqual(["memory", "tasks"]);
    expect(servers.memory).toBeDefined();
    expect(servers.tasks).toBeDefined();
  });

  it("resolves browser capability as stdio config", () => {
    const servers = resolveCapabilities(["browser"], makeCtx());
    expect(servers.browser).toEqual({
      type: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"],
    });
  });

  it("skips agents capability when runAgentFn is not set", () => {
    const servers = resolveCapabilities(["agents"], makeCtx({
      agent: { id: "test", name: "Test", trust: "controlled" } as any,
    }));
    expect(servers.agents).toBeUndefined();
  });

  it("includes agents capability when runAgentFn is set", () => {
    const servers = resolveCapabilities(["agents"], makeCtx({
      agent: { id: "test", name: "Test", trust: "controlled" } as any,
      runAgentFn: vi.fn(),
    }));
    expect(servers.agents).toBeDefined();
  });
});

describe("capabilityToolPatterns", () => {
  it("returns empty for undefined", () => {
    expect(capabilityToolPatterns(undefined)).toEqual([]);
  });

  it("returns wildcard patterns", () => {
    expect(capabilityToolPatterns(["memory", "browser"])).toEqual([
      "mcp__memory__*",
      "mcp__browser__*",
    ]);
  });
});

describe("KNOWN_CAPABILITIES", () => {
  it("includes all expected capabilities", () => {
    const expected = ["memory", "history", "tasks", "notes", "self", "media", "secrets", "agents", "agent-management", "triggers", "browser"];
    for (const cap of expected) {
      expect(KNOWN_CAPABILITIES).toContain(cap);
    }
  });
});
