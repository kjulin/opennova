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

    appendMessage(filePath, {
      role: "user",
      text: message,
      timestamp: new Date().toISOString(),
    });

    const security = resolveSecurityLevel(agent);

    const result = await runClaude(
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

    return { text: responseText };
  });
}
