import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";

/**
 * Filter an array of MCP tool definitions to only include the specified tool names.
 * If allowedTools is undefined or empty, returns the array unchanged (all tools).
 * Throws if an allowed tool name doesn't exist in the array.
 */
export function filterTools<T extends SdkMcpToolDefinition<any>>(
  tools: T[],
  capabilityName: string,
  allowedTools: string[] | undefined,
): T[] {
  if (!allowedTools || allowedTools.length === 0) return tools;

  const allToolNames = new Set(tools.map((t) => t.name));

  for (const name of allowedTools) {
    if (!allToolNames.has(name)) {
      throw new Error(
        `Unknown tool "${name}" for capability "${capabilityName}". Available: ${[...allToolNames].join(", ")}`,
      );
    }
  }

  const allowedSet = new Set(allowedTools);
  return tools.filter((t) => allowedSet.has(t.name));
}
