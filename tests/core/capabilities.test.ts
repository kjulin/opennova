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

vi.mock("#core/agents/management.js", () => ({
  createSelfManagementMcpServer: vi.fn(() => ({ type: "sdk", name: "self" })),
  createAgentManagementMcpServer: vi.fn(() => ({ type: "sdk", name: "agent-management" })),
}));

vi.mock("#core/file-send.js", () => ({
  createFileSendMcpServer: vi.fn(() => ({ type: "sdk", name: "file-send" })),
}));

vi.mock("#core/audio/index.js", () => ({
  createAudioMcpServer: vi.fn(() => ({ type: "sdk", name: "audio" })),
}));

import { createAudioMcpServer } from "#core/audio/index.js";

vi.mock("#core/secrets.js", () => ({
  createSecretsMcpServer: vi.fn(() => ({ type: "sdk", name: "secrets" })),
}));

vi.mock("#core/agents/ask-agent.js", () => ({
  createAgentsMcpServer: vi.fn(() => ({ type: "sdk", name: "agents" })),
}));

vi.mock("#core/triggers/index.js", () => ({
  createTriggerMcpServer: vi.fn(() => ({ type: "sdk", name: "triggers" })),
}));

import { capabilityRegistry, type ResolverContext } from "#core/capabilities/index.js";
import { CapabilityRegistry } from "#core/capabilities/registry.js";
import { filterTools } from "#core/capabilities/tool-filter.js";

function makeCtx(overrides?: Partial<ResolverContext>): ResolverContext {
  return {
    agentId: "test-agent",
    agentDir: "/agents/test-agent",
    workspaceDir: "/workspace",
    threadId: "thread-1",
    directories: [],
    manifest: { createdAt: "", updatedAt: "" },
    callbacks: {},
    agent: { id: "test-agent", name: "Test", trust: "controlled", model: "sonnet" } as any,
    ...overrides,
  };
}

describe("CapabilityRegistry", () => {
  it("register and resolve a capability", () => {
    const registry = new CapabilityRegistry();
    registry.register(
      "test-cap",
      () => ({ type: "sdk" as const, name: "test-cap" } as any),
      [{ name: "tool_a", description: "Tool A" }],
    );

    const servers = registry.resolve({ "test-cap": {} }, makeCtx());
    expect(servers["test-cap"]).toBeDefined();
    expect((servers["test-cap"] as any).name).toBe("test-cap");
  });

  it("returns empty for undefined capabilities", () => {
    const registry = new CapabilityRegistry();
    expect(registry.resolve(undefined, makeCtx())).toEqual({});
  });

  it("returns empty for empty capabilities object", () => {
    const registry = new CapabilityRegistry();
    expect(registry.resolve({}, makeCtx())).toEqual({});
  });

  it("throws for unknown capability", () => {
    const registry = new CapabilityRegistry();
    expect(() => registry.resolve({ nonexistent: {} }, makeCtx())).toThrow(
      'Unknown capability: "nonexistent"',
    );
  });

  it("knownCapabilities returns descriptors", () => {
    const registry = new CapabilityRegistry();
    registry.register(
      "cap-a",
      () => ({ type: "sdk" as const, name: "cap-a" } as any),
      [{ name: "tool_x", description: "X" }],
    );
    registry.register(
      "cap-b",
      () => ({ type: "sdk" as const, name: "cap-b" } as any),
      [{ name: "tool_y", description: "Y" }],
    );

    const descriptors = registry.knownCapabilities();
    expect(descriptors).toHaveLength(2);
    expect(descriptors[0]!.key).toBe("cap-a");
    expect(descriptors[0]!.tools).toEqual([{ name: "tool_x", description: "X" }]);
    expect(descriptors[1]!.key).toBe("cap-b");
  });

  it("knownKeys returns all registered keys", () => {
    const registry = new CapabilityRegistry();
    registry.register("a", () => null, []);
    registry.register("b", () => null, []);
    expect(registry.knownKeys()).toEqual(["a", "b"]);
  });
});

describe("capabilityRegistry singleton", () => {
  it("resolves known capabilities to servers", () => {
    const servers = capabilityRegistry.resolve(
      { memory: {}, tasks: {} },
      makeCtx(),
    );
    expect(Object.keys(servers)).toEqual(["memory", "tasks"]);
    expect(servers.memory).toBeDefined();
    expect(servers.tasks).toBeDefined();
  });

  it("resolves browser capability as stdio config", () => {
    const servers = capabilityRegistry.resolve({ browser: {} }, makeCtx());
    expect(servers.browser).toEqual({
      type: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"],
    });
  });

  it("skips agents capability when runAgentFn is not set", () => {
    const servers = capabilityRegistry.resolve({ agents: {} }, makeCtx());
    expect(servers.agents).toBeUndefined();
  });

  it("includes agents capability when runAgentFn is set", () => {
    const servers = capabilityRegistry.resolve(
      { agents: {} },
      makeCtx({ runAgentFn: vi.fn() }),
    );
    expect(servers.agents).toBeDefined();
  });

  it("knownCapabilities includes all 12 capabilities", () => {
    const descriptors = capabilityRegistry.knownCapabilities();
    const keys = descriptors.map((d) => d.key);
    const expected = [
      "memory", "history", "tasks", "notes", "self", "media",
      "audio", "secrets", "agents", "agent-management", "triggers", "browser",
    ];
    for (const cap of expected) {
      expect(keys).toContain(cap);
    }
    expect(descriptors).toHaveLength(12);
  });

  it("passes config.tools as allowedTools to factory", () => {
    vi.mocked(createAudioMcpServer).mockClear();

    capabilityRegistry.resolve(
      { audio: { tools: ["transcribe"] } },
      makeCtx(),
    );

    expect(createAudioMcpServer).toHaveBeenCalledWith(
      "/agents/test-agent",
      [],
      ["transcribe"],
    );
  });
});

describe("filterTools", () => {
  const mockTools = [
    { name: "tool_a", description: "A", inputSchema: {}, handler: vi.fn() },
    { name: "tool_b", description: "B", inputSchema: {}, handler: vi.fn() },
    { name: "tool_c", description: "C", inputSchema: {}, handler: vi.fn() },
  ];

  it("returns all tools when allowedTools is undefined", () => {
    expect(filterTools(mockTools as any, "test", undefined)).toBe(mockTools);
  });

  it("returns all tools when allowedTools is empty", () => {
    expect(filterTools(mockTools as any, "test", [])).toBe(mockTools);
  });

  it("filters to specified tools", () => {
    const result = filterTools(mockTools as any, "test", ["tool_a", "tool_c"]);
    expect(result.map((t) => t.name)).toEqual(["tool_a", "tool_c"]);
  });

  it("throws for unknown tool name", () => {
    expect(() => filterTools(mockTools as any, "test", ["nonexistent"])).toThrow(
      'Unknown tool "nonexistent" for capability "test"',
    );
  });
});
