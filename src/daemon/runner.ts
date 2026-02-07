import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  runThread as coreRunThread,
  type ClaudeCallbacks,
  type RunThreadOverrides,
} from "#core/index.js";
import { bus } from "./events.js";

/**
 * Daemon wrapper for runThread that integrates with the event bus.
 */
export async function runThread(
  agentDir: string,
  threadId: string,
  message: string,
  callbacks?: ClaudeCallbacks,
  extraMcpServers?: Record<string, McpServerConfig>,
  askAgentDepth?: number,
  abortController?: AbortController,
  overrides?: RunThreadOverrides,
): Promise<{ text: string }> {
  return coreRunThread(
    agentDir,
    threadId,
    message,
    {
      ...callbacks,
      onThreadResponse(agentId, threadId, channel, text) {
        bus.emit("thread:response", { agentId, threadId, channel, text });
      },
      onThreadError(agentId, threadId, channel, error) {
        bus.emit("thread:error", { agentId, threadId, channel, error });
      },
    },
    extraMcpServers,
    askAgentDepth,
    abortController,
    overrides,
  );
}
