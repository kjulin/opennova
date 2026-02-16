import path from "path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { runtime as defaultRuntime, type Runtime } from "./runtime.js";
import type { Model } from "./models.js";
import { generateThreadTitle, type EngineCallbacks } from "./engine/index.js";
import { loadAgents, getAgentCwd, getAgentDirectories, resolveSecurityLevel } from "./agents.js";
import { Config } from "./config.js";
import { buildSystemPrompt } from "./prompts/index.js";
import { createMemoryMcpServer } from "./memory.js";
import { createAgentManagementMcpServer, createSelfManagementMcpServer } from "./agent-management.js";
import { createAskAgentMcpServer } from "./ask-agent.js";
import { createFileSendMcpServer, type FileType } from "./file-send.js";
import { createNotifyUserMcpServer } from "./notify-user.js";
import { createTranscriptionMcpServer } from "./transcription/index.js";
import { appendUsage, createUsageMcpServer } from "./usage.js";
import { createTasksMcpServer, getTask, buildTaskContext } from "#tasks/index.js";
import { createNotesMcpServer } from "#notes/index.js";
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
  silent?: boolean | undefined;  // Suppress channel notifications
}

export interface ThreadRunnerCallbacks extends EngineCallbacks {
  onThreadResponse?: (agentId: string, threadId: string, channel: string, text: string) => void;
  onThreadError?: (agentId: string, threadId: string, channel: string, error: string) => void;
  onFileSend?: (agentId: string, threadId: string, channel: string, filePath: string, caption: string | undefined, fileType: FileType) => void;
  onShareNote?: (agentId: string, threadId: string, channel: string, title: string, slug: string, message: string | undefined) => void;
  onPinChange?: (agentId: string, channel: string) => void;
  onNotifyUser?: (agentId: string, threadId: string, channel: string, message: string) => void;
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
        const cwd = getAgentCwd(agent);
        const directories = getAgentDirectories(agent);
        let baseSystemPrompt = buildSystemPrompt(agent, manifest.channel, security, cwd, directories);

        // Inject task context if this thread is bound to a task
        const taskId = manifest.taskId as string | undefined;
        if (taskId) {
          const task = getTask(Config.workspaceDir, taskId);
          if (task) {
            baseSystemPrompt = `${baseSystemPrompt}\n\n${buildTaskContext(task)}`;
          }
        }

        // Add silent mode prompt if running in background
        const silentPrompt = overrides?.silent
          ? `\n\n<Background>
You are running in the background (scheduled task). Your responses will NOT be sent to the user automatically.
If you need to notify the user about something important (questions, updates, completed work), use the notify_user tool.
</Background>`
          : "";

        const systemPrompt = overrides?.systemPromptSuffix
          ? `${baseSystemPrompt}${silentPrompt}\n\n${overrides.systemPromptSuffix}`
          : `${baseSystemPrompt}${silentPrompt}`;
        result = await runtime.run(
          message,
          {
            cwd,
            ...(directories.length > 0 ? { directories } : {}),
            systemPrompt,
            ...(overrides?.model ? { model: overrides.model } : {}),
            ...(overrides?.maxTurns ? { maxTurns: overrides.maxTurns } : {}),
            ...(agent.subagents ? { agents: agent.subagents } : {}),
            mcpServers: {
              memory: createMemoryMcpServer(),
              tasks: createTasksMcpServer(agentId, Config.workspaceDir),
              notes: createNotesMcpServer(agentDir, (title, slug, message) => {
                callbacks?.onShareNote?.(agentId, threadId, manifest.channel, title, slug, message);
              }, () => {
                callbacks?.onPinChange?.(agentId, manifest.channel);
              }),
              ...(security !== "sandbox" ? { self: createSelfManagementMcpServer(agentDir) } : {}),
              ...(security !== "sandbox" ? {
                "file-send": createFileSendMcpServer(agentDir, directories, (filePath, caption, fileType) => {
                  callbacks?.onFileSend?.(agentId, threadId, manifest.channel, filePath, caption, fileType);
                }),
                transcription: createTranscriptionMcpServer(agentDir, directories),
              } : {}),
              ...extraMcpServers,
              ...(agentId === "agent-builder" ? { agents: createAgentManagementMcpServer() } : {}),
              ...(agentId === "nova" ? { usage: createUsageMcpServer() } : {}),
              ...(agent.allowedAgents && security !== "sandbox" ? { "ask-agent": createAskAgentMcpServer(agent, askAgentDepth ?? 0, runThreadForAskAgent) } : {}),
              ...(overrides?.silent ? {
                "notify-user": createNotifyUserMcpServer((message) => {
                  callbacks?.onNotifyUser?.(agentId, threadId, manifest.channel, message);
                }),
              } : {}),
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
