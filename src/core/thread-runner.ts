import path from "path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Model } from "./models.js";
import { claudeEngine, generateThreadTitle, type Engine, type EngineCallbacks, type EngineEvent, type EngineOptions } from "./engine/index.js";
import { loadAgents, getAgentCwd, getAgentDirectories } from "./agents/index.js";
import { Config } from "./config.js";
import { buildSystemPrompt } from "./prompts/index.js";
import { resolveCapabilities, resolveInjections, type ResolverContext } from "./capabilities.js";
import { appendUsage } from "./usage.js";
import { generateEmbedding, appendEmbedding, isModelAvailable } from "./episodic/index.js";
import { getTask } from "#tasks/index.js";
import {
  threadPath,
  loadManifest,
  saveManifest,
  loadMessages,
  appendMessage,
  appendEvent,
  withThreadLock,
} from "./threads.js";
import { log } from "./logger.js";
import type { FileType } from "./media/mcp.js";

export interface RunAgentOverrides {
  model?: Model | undefined;
  maxTurns?: number | undefined;
  background?: boolean | undefined;  // Running without a live user session
}

export interface AgentRunnerCallbacks extends EngineCallbacks {
  onResponse?: (agentId: string, threadId: string, text: string) => void;
  onError?: (agentId: string, threadId: string, error: string) => void;
  onFileSend?: (agentId: string, threadId: string, filePath: string, caption: string | undefined, fileType: FileType) => void;
  onShareNote?: (agentId: string, threadId: string, title: string, slug: string, message: string | undefined) => void;
  onPinChange?: (agentId: string) => void;
  onNotifyUser?: (agentId: string, threadId: string, message: string) => void;
}

export interface AgentRunner {
  runAgent(
    agentDir: string,
    threadId: string,
    message: string,
    callbacks?: AgentRunnerCallbacks,
    extraMcpServers?: Record<string, McpServerConfig>,
    askAgentDepth?: number,
    abortController?: AbortController,
    overrides?: RunAgentOverrides,
  ): Promise<{ text: string }>;
}

export function createAgentRunner(engine: Engine = claudeEngine): AgentRunner {
  const runAgent = async (
    agentDir: string,
    threadId: string,
    message: string,
    callbacks?: AgentRunnerCallbacks,
    extraMcpServers?: Record<string, McpServerConfig>,
    askAgentDepth?: number,
    abortController?: AbortController,
    overrides?: RunAgentOverrides,
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

      const trust = agent.trust;

      // Create a runAgent wrapper for ask-agent that maintains the callback chain
      const runAgentForAskAgent = async (
        targetAgentDir: string,
        targetThreadId: string,
        targetMessage: string,
        depth: number,
      ): Promise<{ text: string }> => {
        return runAgent(
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
      let systemPrompt: string | undefined;
      let mcpServerCount = 0;
      try {
        const cwd = getAgentCwd(agent);
        const directories = getAgentDirectories(agent);

        const taskId = manifest.taskId as string | undefined;
        const task = taskId ? getTask(Config.workspaceDir, taskId) ?? undefined : undefined;

        systemPrompt = buildSystemPrompt(agent, cwd, directories, {
          task,
          background: overrides?.background,
        });

        const engineCallbacks: EngineCallbacks = {
          ...callbacks,
          onEvent: (event: EngineEvent) => {
            appendEvent(filePath, { ...event, timestamp: new Date().toISOString() });
            callbacks?.onEvent?.(event);
          },
        };

        const resolverContext: ResolverContext = {
          agentId,
          agentDir,
          workspaceDir: Config.workspaceDir,
          threadId,
          directories,
          manifest,
          callbacks: {
            onFileSend: (fp, caption, fileType) => callbacks?.onFileSend?.(agentId, threadId, fp, caption, fileType),
            onShareNote: (title, slug, message) => callbacks?.onShareNote?.(agentId, threadId, title, slug, message),
            onPinChange: () => callbacks?.onPinChange?.(agentId),
            onNotifyUser: (message) => callbacks?.onNotifyUser?.(agentId, threadId, message),
          },
          agent,
          askAgentDepth: askAgentDepth ?? 0,
          runAgentFn: runAgentForAskAgent,
        };

        const mcpServers = {
          ...resolveCapabilities(agent.capabilities, resolverContext),
          ...extraMcpServers,
          ...resolveInjections(resolverContext, { background: overrides?.background }),
        };
        mcpServerCount = Object.keys(mcpServers).length;

        result = await engine.run(
          message,
          {
            cwd,
            ...(directories.length > 0 ? { directories } : {}),
            systemPrompt,
            ...(overrides?.model ? { model: overrides.model } : {}),
            ...(overrides?.maxTurns ? { maxTurns: overrides.maxTurns } : {}),
            ...(agent.subagents ? { agents: agent.subagents as EngineOptions["agents"] } : {}),
            mcpServers,
          },
          trust,
          manifest.sessionId,
          engineCallbacks,
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
        callbacks?.onError?.(agentId, threadId, errorMsg);
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
          systemPromptChars: systemPrompt?.length,
          mcpServerCount,
          capabilityCount: agent.capabilities?.length ?? 0,
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

      callbacks?.onResponse?.(agentId, threadId, responseText);

      log.info("thread-runner", `thread ${threadId} for agent ${agentId} completed (${responseText.length} chars)`);

      // Fire-and-forget: embed the user message and assistant response
      if (!isModelAvailable()) {
        log.debug("episodic", `skipping embedding for ${threadId} — model not available (run 'nova init')`);
      } else {
        const msgMessages = loadMessages(filePath);
        const userAssistantMessages = msgMessages.filter((m) => m.role === "user" || m.role === "assistant");
        const messageCount = userAssistantMessages.length;

        // Embed the last user message and assistant response
        const lastUserIdx = messageCount - 2;
        const lastAssistantIdx = messageCount - 1;

        const lastUser = userAssistantMessages[lastUserIdx];
        const lastAssistant = userAssistantMessages[lastAssistantIdx];

        if (lastUser && lastUser.role === "user") {
          generateEmbedding(lastUser.text).then((embedding) => {
            appendEmbedding(agentDir, {
              threadId,
              messageIndex: lastUserIdx,
              role: "user",
              text: lastUser.text,
              embedding,
              timestamp: lastUser.timestamp,
            });
            log.debug("episodic", `embedded user message in ${threadId} for ${agentId} (idx=${lastUserIdx})`);
          }).catch((err) => {
            log.warn("episodic", `embedding failed for user message in ${threadId}:`, (err as Error).message);
          });
        }

        if (lastAssistant && lastAssistant.role === "assistant") {
          generateEmbedding(lastAssistant.text).then((embedding) => {
            appendEmbedding(agentDir, {
              threadId,
              messageIndex: lastAssistantIdx,
              role: "assistant",
              text: lastAssistant.text,
              embedding,
              timestamp: lastAssistant.timestamp,
            });
            log.debug("episodic", `embedded assistant message in ${threadId} for ${agentId} (idx=${lastAssistantIdx})`);
          }).catch((err) => {
            log.warn("episodic", `embedding failed for assistant message in ${threadId}:`, (err as Error).message);
          });
        }
      }

      if (!manifest.title) {
        const messages = loadMessages(filePath);
        const userMessages = messages.filter((m) => m.role === "user");
        // Wait for at least 2 user messages — the first is often just a greeting
        if (userMessages.length >= 2) {
          const topicMessages = userMessages.slice(-2).map((m) => m.text).join("\n");
          generateThreadTitle(topicMessages, responseText).then(({ title, usage: titleUsage }) => {
            if (title) {
              manifest.title = title;
              saveManifest(filePath, manifest);
              log.info("thread-runner", `titled thread ${threadId}: "${title}"`);
            }
            if (titleUsage) {
              appendUsage({
                timestamp: new Date().toISOString(),
                agentId: "_system",
                threadId,
                ...titleUsage,
              });
            }
          }).catch((err) => {
            log.warn("thread-runner", `title generation failed for ${threadId}:`, (err as Error).message);
          });
        }
      }

      return { text: responseText };
    });
  };

  return { runAgent };
}

// Default instance
export const agentRunner = createAgentRunner();

// Convenience export for backwards compatibility
export const runAgent = agentRunner.runAgent;
