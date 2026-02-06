import path from "path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { runClaude, generateThreadTitle, type ClaudeCallbacks } from "./claude.js";
import { loadAgents, buildSystemPrompt, getAgentCwd, getAgentDirectories, resolveSecurityLevel } from "./agents.js";
import { createMemoryMcpServer } from "./memory.js";
import { createAgentManagementMcpServer } from "./agent-management.js";
import { createAskAgentMcpServer } from "./ask-agent.js";
import { appendUsage, createUsageMcpServer } from "./usage.js";
import { bus } from "./events.js";
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
  model?: "sonnet" | "opus" | "haiku";
  maxTurns?: number;
}

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
  return withThreadLock(threadId, async () => {
    const filePath = threadPath(agentDir, threadId);
    const manifest = loadManifest(filePath);

    const agentId = path.basename(agentDir);
    const agents = loadAgents();
    const agent = agents.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    log.info("runner", `starting thread ${threadId} for agent ${agentId}`);

    appendMessage(filePath, {
      role: "user",
      text: message,
      timestamp: new Date().toISOString(),
    });

    const security = resolveSecurityLevel(agent);

    let result;
    try {
      const directories = getAgentDirectories(agent);
      result = await runClaude(
        message,
        {
          cwd: getAgentCwd(agent),
          ...(directories.length > 0 ? { directories } : {}),
          systemPrompt: buildSystemPrompt(agent, agentDir, manifest.channel, security),
          security,
          ...(overrides?.model ? { model: overrides.model } : {}),
          ...(overrides?.maxTurns ? { maxTurns: overrides.maxTurns } : {}),
          ...(agent.subagents ? { agents: agent.subagents } : {}),
          mcpServers: {
            memory: createMemoryMcpServer(agentDir),
            ...extraMcpServers,
            ...(agentId === "agent-builder" ? { agents: createAgentManagementMcpServer() } : {}),
            ...(agentId === "nova" ? { usage: createUsageMcpServer() } : {}),
            ...(agent.allowedAgents && security !== "sandbox" ? { "ask-agent": createAskAgentMcpServer(agent, askAgentDepth ?? 0) } : {}),
          },
        },
        manifest.sessionId,
        callbacks,
        abortController,
      );
    } catch (err) {
      if (abortController?.signal.aborted) {
        log.info("runner", `thread ${threadId} for agent ${agentId} stopped by user`);
        appendMessage(filePath, {
          role: "assistant",
          text: "(stopped by user)",
          timestamp: new Date().toISOString(),
        });
        manifest.updatedAt = new Date().toISOString();
        saveManifest(filePath, manifest);
        return { text: "" };
      }
      log.error("runner", `thread ${threadId} for agent ${agentId} failed:`, err);
      const errorMsg = (err as Error).message ?? "unknown error";
      appendMessage(filePath, {
        role: "assistant",
        text: `(error: ${errorMsg})`,
        timestamp: new Date().toISOString(),
      });
      bus.emit("thread:error", {
        agentId,
        threadId,
        channel: manifest.channel,
        error: errorMsg,
      });
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

    bus.emit("thread:response", {
      agentId,
      threadId,
      channel: manifest.channel,
      text: responseText,
    });

    log.info("runner", `thread ${threadId} for agent ${agentId} completed (${responseText.length} chars)`);

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
            log.info("runner", `titled thread ${threadId}: "${title}"`);
          }
        }).catch((err) => {
          log.warn("runner", `title generation failed for ${threadId}:`, (err as Error).message);
        });
      }
    }

    return { text: responseText };
  });
}
