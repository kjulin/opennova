import path from "path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { runtime as defaultRuntime, type Runtime } from "./runtime.js";
import type { Model } from "./models.js";
import { generateThreadTitle } from "./claude.js";
import type { EngineCallbacks } from "./engine/index.js";
import { loadAgents, buildSystemPrompt, getAgentCwd, getAgentDirectories, resolveSecurityLevel } from "./agents.js";
import { createMemoryMcpServer } from "./memory.js";
import { createAgentManagementMcpServer } from "./agent-management.js";
import { createAskAgentMcpServer } from "./ask-agent.js";
import { appendUsage, createUsageMcpServer } from "./usage.js";
import { createSuggestEditMcpServer, type SuggestEditCallback } from "./suggest-edit.js";
import {
  threadPath,
  loadManifest,
  saveManifest,
  loadMessages,
  appendMessage,
  withThreadLock,
} from "./threads.js";
import { log } from "./logger.js";

export interface RunThreadOverrides {
  model?: Model | undefined;
  maxTurns?: number | undefined;
  systemPromptSuffix?: string | undefined;
  onSuggestEdit?: SuggestEditCallback | undefined;
}

export interface ThreadRunnerCallbacks extends EngineCallbacks {
  onThreadResponse?: (agentId: string, threadId: string, channel: string, text: string) => void;
  onThreadError?: (agentId: string, threadId: string, channel: string, error: string) => void;
}

export interface ThreadRunner {
  runThread(
    agentDir: string,
    threadId: string,
    message: string,
    callbacks?: ThreadRunnerCallbacks,
    extraMcpServers?: Record<string, McpServerConfig>,
    askAgentDepth?: number,
    abortController?: AbortController,
    overrides?: RunThreadOverrides,
  ): Promise<{ text: string }>;
}

export function createThreadRunner(runtime: Runtime = defaultRuntime): ThreadRunner {
  const runThread = async (
    agentDir: string,
    threadId: string,
    message: string,
    callbacks?: ThreadRunnerCallbacks,
    extraMcpServers?: Record<string, McpServerConfig>,
    askAgentDepth?: number,
    abortController?: AbortController,
    overrides?: RunThreadOverrides,
  ): Promise<{ text: string }> => {
    return withThreadLock(threadId, async () => {
      const filePath = threadPath(agentDir, threadId);
      const manifest = loadManifest(filePath);

      const agentId = path.basename(agentDir);
      const agents = loadAgents();
      const agent = agents.get(agentId);
      if (!agent) throw new Error(`Agent not found: ${agentId}`);

      log.info("thread-runner", `starting thread ${threadId} for agent ${agentId}`);

      appendMessage(filePath, {
        role: "user",
        text: message,
        timestamp: new Date().toISOString(),
      });

      const security = resolveSecurityLevel(agent);

      // Create a runThread wrapper for ask-agent that maintains the callback chain
      const runThreadForAskAgent = async (
        targetAgentDir: string,
        targetThreadId: string,
        targetMessage: string,
        depth: number,
      ): Promise<{ text: string }> => {
        return runThread(
          targetAgentDir,
          targetThreadId,
          targetMessage,
          callbacks,
          undefined,
          depth,
          abortController,
          overrides,
        );
      };

      let result;
      try {
        const directories = getAgentDirectories(agent);
        const baseSystemPrompt = buildSystemPrompt(agent, agentDir, manifest.channel, security);
        const systemPrompt = overrides?.systemPromptSuffix
          ? `${baseSystemPrompt}\n\n${overrides.systemPromptSuffix}`
          : baseSystemPrompt;
        result = await runtime.run(
          message,
          {
            cwd: getAgentCwd(agent),
            ...(directories.length > 0 ? { directories } : {}),
            systemPrompt,
            ...(overrides?.model ? { model: overrides.model } : {}),
            ...(overrides?.maxTurns ? { maxTurns: overrides.maxTurns } : {}),
            ...(agent.subagents ? { agents: agent.subagents } : {}),
            mcpServers: {
              memory: createMemoryMcpServer(agentDir),
              ...extraMcpServers,
              ...(agentId === "agent-builder" ? { agents: createAgentManagementMcpServer() } : {}),
              ...(agentId === "nova" ? { usage: createUsageMcpServer() } : {}),
              ...(agent.allowedAgents && security !== "sandbox" ? { "ask-agent": createAskAgentMcpServer(agent, askAgentDepth ?? 0, runThreadForAskAgent) } : {}),
              ...(overrides?.onSuggestEdit ? { "suggest-edit": createSuggestEditMcpServer(overrides.onSuggestEdit) } : {}),
            },
          },
          security,
          manifest.sessionId,
          callbacks,
          abortController,
        );
      } catch (err) {
        if (abortController?.signal.aborted) {
          log.info("thread-runner", `thread ${threadId} for agent ${agentId} stopped by user`);
          appendMessage(filePath, {
            role: "assistant",
            text: "(stopped by user)",
            timestamp: new Date().toISOString(),
          });
          manifest.updatedAt = new Date().toISOString();
          saveManifest(filePath, manifest);
          return { text: "" };
        }
        log.error("thread-runner", `thread ${threadId} for agent ${agentId} failed:`, err);
        const errorMsg = (err as Error).message ?? "unknown error";
        appendMessage(filePath, {
          role: "assistant",
          text: `(error: ${errorMsg})`,
          timestamp: new Date().toISOString(),
        });
        callbacks?.onThreadError?.(agentId, threadId, manifest.channel, errorMsg);
        throw err;
      }

      const responseText = result.text || "(empty response)";

      // Record usage metrics
      if (result.usage) {
        appendUsage({
          timestamp: new Date().toISOString(),
          agentId,
          threadId,
          ...result.usage,
        });
      }

      appendMessage(filePath, {
        role: "assistant",
        text: responseText,
        timestamp: new Date().toISOString(),
      });

      if (result.sessionId) {
        manifest.sessionId = result.sessionId;
      }
      manifest.updatedAt = new Date().toISOString();
      saveManifest(filePath, manifest);

      callbacks?.onThreadResponse?.(agentId, threadId, manifest.channel, responseText);

      log.info("thread-runner", `thread ${threadId} for agent ${agentId} completed (${responseText.length} chars)`);

      if (!manifest.title) {
        const messages = loadMessages(filePath);
        const userMessages = messages.filter((m) => m.role === "user");
        // Wait for at least 2 user messages — the first is often just a greeting
        if (userMessages.length >= 2) {
          const topicMessages = userMessages.slice(-2).map((m) => m.text).join("\n");
          generateThreadTitle(topicMessages, responseText).then((title) => {
            if (title) {
              manifest.title = title;
              saveManifest(filePath, manifest);
              log.info("thread-runner", `titled thread ${threadId}: "${title}"`);
            }
          }).catch((err) => {
            log.warn("thread-runner", `title generation failed for ${threadId}:`, (err as Error).message);
          });
        }
      }

      return { text: responseText };
    });
  };

  return { runThread };
}

// Default instance
export const threadRunner = createThreadRunner();

// Convenience export for backwards compatibility
export const runThread = threadRunner.runThread;
