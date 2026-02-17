import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Model } from "../models.js";

export type EngineEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "result"; cost?: number; durationMs?: number; turns?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };

export interface EngineCallbacks {
  onThinking?: () => void;
  onAssistantMessage?: (text: string) => void;
  onToolUse?: (toolName: string, input: Record<string, unknown>, summary: string) => void;
  onToolUseSummary?: (summary: string) => void;
  onEvent?: (event: EngineEvent) => void;
}

export interface EngineResult {
  text: string;
  sessionId?: string | undefined;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    durationMs: number;
    turns: number;
  } | undefined;
}

export interface EngineOptions {
  // Working directory and paths
  cwd?: string | undefined;
  directories?: string[] | undefined;

  // Prompt configuration
  systemPrompt?: string | undefined;
  model?: Model | undefined;
  maxTurns?: number | undefined;

  // Sub-agents and MCP
  agents?: Record<string, {
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: Model;
    maxTurns?: number;
  }> | undefined;
  mcpServers?: Record<string, McpServerConfig> | undefined;

  // SDK security options (injected by Runtime)
  permissionMode?: "default" | "dontAsk" | "bypassPermissions" | undefined;
  allowedTools?: string[] | undefined;
  disallowedTools?: string[] | undefined;
  allowDangerouslySkipPermissions?: boolean | undefined;
}

export interface Engine {
  run(
    message: string,
    options: EngineOptions,
    sessionId?: string,
    callbacks?: EngineCallbacks,
    abortController?: AbortController,
  ): Promise<EngineResult>;
}
