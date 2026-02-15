import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  runThread as coreRunThread,
  type ThreadRunnerCallbacks,
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
  callbacks?: ThreadRunnerCallbacks,
  extraMcpServers?: Record<string, McpServerConfig>,
  askAgentDepth?: number,
  abortController?: AbortController,
  overrides?: RunThreadOverrides,
): Promise<{ text: string }> {
  const silent = overrides?.silent ?? false;

  return coreRunThread(
    agentDir,
    threadId,
    message,
    {
      ...callbacks,
      onThreadResponse(agentId, threadId, channel, text) {
        if (!silent) {
          bus.emit("thread:response", { agentId, threadId, channel, text });
        }
      },
      onThreadError(agentId, threadId, channel, error) {
        if (!silent) {
          bus.emit("thread:error", { agentId, threadId, channel, error });
        }
      },
      onFileSend(agentId, threadId, channel, filePath, caption, fileType) {
        if (!silent) {
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
      onNotifyUser(agentId, threadId, channel, text) {
        // Always emit notify_user messages, even in silent mode
        bus.emit("thread:response", { agentId, threadId, channel, text });
      },
    },
    extraMcpServers,
    askAgentDepth,
    abortController,
    overrides,
  );
}
