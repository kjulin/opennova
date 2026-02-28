import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ResolverContext } from "./registry.js";
import { createNotifyUserMcpServer } from "../notify-user.js";

export function resolveInjections(
  ctx: ResolverContext,
  options?: { background?: boolean | undefined },
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};

  if (options?.background) {
    servers["notify-user"] = createNotifyUserMcpServer((message) => {
      ctx.callbacks.onNotifyUser?.(message);
    });
  }

  return servers;
}
