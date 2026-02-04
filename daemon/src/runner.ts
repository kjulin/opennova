import path from "path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { runClaude, type ClaudeCallbacks } from "./claude.js";
import { loadAgents, buildSystemPrompt, getAgentCwd, resolveSecurityLevel } from "./agents.js";
import { createMemoryMcpServer } from "./memory.js";
import { createAgentManagementMcpServer } from "./agent-management.js";
import { bus } from "./events.js";
import {
  threadPath,
  loadManifest,
  saveManifest,
  appendMessage,
  withThreadLock,
} from "./threads.js";
import { log } from "./logger.js";

export async function runThread(
  agentDir: string,
  threadId: string,
  message: string,
  callbacks?: ClaudeCallbacks,
  extraMcpServers?: Record<string, McpServerConfig>,
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
      result = await runClaude(
        message,
        {
          cwd: getAgentCwd(agent),
          systemPrompt: buildSystemPrompt(agent, agentDir, manifest.channel, security),
          security,
          ...(agent.subagents ? { agents: agent.subagents } : {}),
          mcpServers: {
            memory: createMemoryMcpServer(agentDir),
            ...extraMcpServers,
            ...(agentId === "agent-builder" ? { agents: createAgentManagementMcpServer() } : {}),
          },
        },
        manifest.sessionId,
        callbacks,
      );
    } catch (err) {
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

    return { text: responseText };
  });
}
