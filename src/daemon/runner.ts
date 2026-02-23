import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  runAgent as coreRunAgent,
  type AgentRunnerCallbacks,
  type RunAgentOverrides,
} from "#core/index.js";
import { bus } from "./events.js";

/**
 * Daemon wrapper for runAgent that integrates with the event bus.
 */
export async function runAgent(
  agentDir: string,
  threadId: string,
  message: string,
  callbacks?: AgentRunnerCallbacks,
  extraMcpServers?: Record<string, McpServerConfig>,
  askAgentDepth?: number,
  abortController?: AbortController,
  overrides?: RunAgentOverrides,
): Promise<{ text: string }> {
  const background = overrides?.background ?? false;

  return coreRunAgent(
    agentDir,
    threadId,
    message,
    {
      ...callbacks,
      onThreadResponse(agentId, threadId, channel, text) {
        if (!background) {
          bus.emit("thread:response", { agentId, threadId, channel, text });
        }
      },
      onThreadError(agentId, threadId, channel, error) {
        if (!background) {
          bus.emit("thread:error", { agentId, threadId, channel, error });
        }
      },
      onFileSend(agentId, threadId, channel, filePath, caption, fileType) {
        if (!background) {
          bus.emit("thread:file", {
            agentId,
            threadId,
            channel,
            filePath,
            ...(caption !== undefined ? { caption } : {}),
            fileType,
          });
        }
      },
      onShareNote(agentId, threadId, channel, title, slug, message) {
        bus.emit("thread:note", { agentId, threadId, channel, title, slug, ...(message !== undefined ? { message } : {}) });
      },
      onPinChange(agentId, channel) {
        bus.emit("thread:pin", { agentId, channel });
      },
      onNotifyUser(agentId, threadId, channel, text) {
        // Always emit notify_user messages, even in background mode
        bus.emit("thread:response", { agentId, threadId, channel, text });
      },
    },
    extraMcpServers,
    askAgentDepth,
    abortController,
    overrides,
  );
}
