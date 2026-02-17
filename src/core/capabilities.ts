import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

/**
 * Static registry of platform capabilities.
 * Each entry maps a capability name to the MCP server config that provides it.
 *
 * Adding a new capability is a code change — capabilities are curated platform
 * features, not user config.
 *
 * Prerequisites:
 * - browser: Requires Playwright browsers. Run `npx playwright install chromium`
 *   once before first use, or the first invocation will auto-download (~150MB).
 */
const CAPABILITY_REGISTRY: Record<string, McpServerConfig> = {
  browser: {
    type: "stdio",
    command: "npx",
    args: ["@playwright/mcp@latest"],
  },
};

export function resolveCapabilities(
  capabilities: string[] | undefined,
): Record<string, McpServerConfig> {
  if (!capabilities || capabilities.length === 0) return {};

  const servers: Record<string, McpServerConfig> = {};
  for (const cap of capabilities) {
    const config = CAPABILITY_REGISTRY[cap];
    if (!config) {
      throw new Error(`Unknown capability: "${cap}". Available: ${Object.keys(CAPABILITY_REGISTRY).join(", ")}`);
    }
    servers[cap] = config;
  }
  return servers;
}
