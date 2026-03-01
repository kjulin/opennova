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
    agent: { id: "test-agent", name: "Test", model: "sonnet" } as any,
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

    const resolved = registry.resolve({ "test-cap": {} }, makeCtx());
    expect(resolved.mcpServers["test-cap"]).toBeDefined();
    expect((resolved.mcpServers["test-cap"] as any).name).toBe("test-cap");
  });

  it("returns empty result for undefined capabilities", () => {
    const registry = new CapabilityRegistry();
    const resolved = registry.resolve(undefined, makeCtx());
    expect(resolved.mcpServers).toEqual({});
    expect(resolved.engineConfig).toEqual({ allowedTools: [], disallowedTools: [] });
  });

  it("returns empty result for empty capabilities object", () => {
    const registry = new CapabilityRegistry();
    const resolved = registry.resolve({}, makeCtx());
    expect(resolved.mcpServers).toEqual({});
    expect(resolved.engineConfig).toEqual({ allowedTools: [], disallowedTools: [] });
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

  it("registerEngineConfig and resolve returns engine config", () => {
    const registry = new CapabilityRegistry();
    registry.registerEngineConfig(
      "shell",
      () => ({ allowedTools: ["Bash"] }),
      [{ name: "Bash", description: "Execute shell commands" }],
    );

    const resolved = registry.resolve({ shell: {} }, makeCtx());
    expect(resolved.mcpServers).toEqual({});
    expect(resolved.engineConfig.allowedTools).toEqual(["Bash"]);
    expect(resolved.engineConfig.disallowedTools).toEqual([]);
  });

  it("knownKeys includes engine config keys", () => {
    const registry = new CapabilityRegistry();
    registry.register("a", () => null, []);
    registry.registerEngineConfig("shell", () => ({ allowedTools: ["Bash"] }), []);
    expect(registry.knownKeys()).toEqual(["a", "shell"]);
  });

  it("knownCapabilities includes engine config capabilities", () => {
    const registry = new CapabilityRegistry();
    registry.registerEngineConfig(
      "shell",
      () => ({ allowedTools: ["Bash"] }),
      [{ name: "Bash", description: "Execute shell commands" }],
    );
    const descriptors = registry.knownCapabilities();
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]!.key).toBe("shell");
    expect(descriptors[0]!.tools).toEqual([{ name: "Bash", description: "Execute shell commands" }]);
  });
});

describe("capabilityRegistry singleton", () => {
  it("resolves known capabilities to servers", () => {
    const resolved = capabilityRegistry.resolve(
      { memory: {}, tasks: {} },
      makeCtx(),
    );
    expect(Object.keys(resolved.mcpServers)).toEqual(["memory", "tasks"]);
    expect(resolved.mcpServers.memory).toBeDefined();
    expect(resolved.mcpServers.tasks).toBeDefined();
  });

  it("resolves browser capability as stdio config", () => {
    const resolved = capabilityRegistry.resolve({ browser: {} }, makeCtx());
    expect(resolved.mcpServers.browser).toEqual({
      type: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"],
    });
  });

  it("skips agents capability when runAgentFn is not set", () => {
    const resolved = capabilityRegistry.resolve({ agents: {} }, makeCtx());
    expect(resolved.mcpServers.agents).toBeUndefined();
  });

  it("includes agents capability when runAgentFn is set", () => {
    const resolved = capabilityRegistry.resolve(
      { agents: {} },
      makeCtx({ runAgentFn: vi.fn() }),
    );
    expect(resolved.mcpServers.agents).toBeDefined();
  });

  it("knownCapabilities includes all 12 capabilities", () => {
    const descriptors = capabilityRegistry.knownCapabilities();
    const keys = descriptors.map((d) => d.key);
    const expected = [
      "memory", "history", "tasks", "self", "media",
      "audio", "secrets", "agents", "agent-management", "triggers", "browser",
      "shell",
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

  it("resolves shell capability to engine config", () => {
    const resolved = capabilityRegistry.resolve({ shell: {} }, makeCtx());
    expect(resolved.engineConfig.allowedTools).toContain("Bash");
    expect(Object.keys(resolved.mcpServers)).toEqual([]);
  });

  it("agent without shell does not get Bash in engine config", () => {
    const resolved = capabilityRegistry.resolve({ memory: {} }, makeCtx());
    expect(resolved.engineConfig.allowedTools).not.toContain("Bash");
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
