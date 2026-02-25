import crypto from "node:crypto";
import path from "path";
import {query, type SettingSource} from "@anthropic-ai/claude-agent-sdk";
import { log } from "../logger.js";
import { trustOptions } from "../security.js";
import type { TrustLevel } from "../schemas.js";
import { createDirectoryGuard } from "./directory-guard.js";
import type { Engine, EngineOptions, EngineResult, EngineCallbacks } from "./types.js";

/** Generate a short random run ID for log correlation */
function runId(): string {
  return crypto.randomBytes(3).toString("hex"); // 6 hex chars
}

/** Shorten a file path to parent/filename for display */
function shortPath(filePath: string): string {
  const parent = path.basename(path.dirname(filePath));
  const file = path.basename(filePath);
  return parent ? `${parent}/${file}` : file;
}

function friendlyToolStatus(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "WebSearch":
      return input.query ? `Searching the web (${input.query})…` : "Searching the web…";
    case "WebFetch":
      return input.url ? `Fetching ${input.url}…` : "Fetching a webpage…";
    case "Read":
      return input.file_path ? `Reading ${shortPath(String(input.file_path))}…` : "Reading files…";
    case "Write":
      return input.file_path ? `Writing ${shortPath(String(input.file_path))}…` : "Writing a file…";
    case "Edit":
      return input.file_path ? `Editing ${shortPath(String(input.file_path))}…` : "Editing a file…";
    case "Bash":
      return input.command ? `Running \`${input.command}\`…` : "Running a command…";
    case "Grep":
      return input.pattern ? `Searching for "${input.pattern}"…` : "Searching code…";
    case "Glob":
      return input.pattern ? `Finding files matching ${input.pattern}…` : "Finding files…";
    case "Task":
      return input.description ? `${input.description}…` : "Running a subtask…";
    case "NotebookEdit":
      return "Editing a notebook…";
    case "mcp__agents__ask_agent": {
      const msg = input.message ? `: ${String(input.message).slice(0, 80)}` : "";
      return input.agent ? `Asking ${input.agent}${msg}…` : "Asking another agent…";
    }
    case "mcp__suggest-edit__suggest_edit":
      return input.file ? `Suggesting edit to ${shortPath(String(input.file))}…` : "Suggesting an edit…";
    default:
      return `Using ${toolName}…`;
  }
}

async function execQuery(
  message: string,
  options: EngineOptions,
  trust: TrustLevel,
  sessionId: string | undefined,
  callbacks: EngineCallbacks | undefined,
  abortController: AbortController | undefined,
): Promise<EngineResult> {
  const tag = `engine:${runId()}`;
  log.info(tag, `running (trust=${trust})${sessionId ? ` (session: ${sessionId})` : ""}`);

  // Derive MCP tool patterns from registered servers — ensures all MCP tools
  // work at every trust level (trust only governs SDK-native tools).
  const mcpToolPatterns = options.mcpServers
    ? Object.keys(options.mcpServers).map((name) => `mcp__${name}__*`)
    : [];

  // Translate trust level into SDK permission options
  const sdkTrustOptions = trustOptions(trust, mcpToolPatterns.length > 0 ? mcpToolPatterns : undefined);

  // Enforce directory boundaries via PreToolUse hook.
  // This must be a hook (not canUseTool) because the SDK auto-allows tools
  // in allowedTools before canUseTool is consulted.
  const directoryGuard = createDirectoryGuard(trust, options.cwd, options.directories ?? []);

  const queryOptions = {
    cwd: options.cwd,
    ...(options.directories && options.directories.length > 0 ? { additionalDirectories: options.directories } : {}),
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.agents ? { agents: options.agents } : {}),
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    model: options.model ?? "opus",
    ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
    ...sdkTrustOptions,
    hooks: { PreToolUse: [directoryGuard] },
    ...(sessionId ? { resume: sessionId } : {}),
    settingSources: ["project"] as SettingSource[],
  };

  // Log options without mcpServers (may contain circular refs) and systemPrompt (too verbose)
  const { mcpServers, systemPrompt, ...loggableOptions } = queryOptions as Record<string, unknown>;
  log.debug(tag, "options", JSON.stringify({
    ...loggableOptions,
    ...(systemPrompt ? { systemPrompt: "[omitted]" } : {}),
    ...(mcpServers ? { mcpServers: Object.keys(mcpServers as object) } : {}),
  }, null, 2));

  const result = query({
    prompt: message,
    options: {
      ...queryOptions,
      ...(abortController ? { abortController } : {})
    },
  });

  // Signal thinking immediately at start
  callbacks?.onThinking?.();

  let responseText = "";
  let resultSessionId: string | undefined;
  let resultUsage: EngineResult["usage"] | undefined;
  let resultModel: string = String(queryOptions.model ?? "opus");
  let thinkingTimeout: ReturnType<typeof setTimeout> | null = null;

  for await (const event of result) {
    log.debug(tag, `event: ${event.type}${("subtype" in event && event.subtype) ? `:${event.subtype}` : ""}`);

    // Log model info from init event
    if (event.type === "system" && "subtype" in event && event.subtype === "init") {
      const initEvent = event as { model?: string };
      if (initEvent.model) {
        resultModel = initEvent.model;
        log.info(tag, `model: ${initEvent.model}`);
      }
    }

    // Clear any pending thinking timeout on new events
    if (thinkingTimeout) {
      clearTimeout(thinkingTimeout);
      thinkingTimeout = null;
    }

    if (event.type === "user") {
      // Log subagent-related tool results
      const userEvent = event as { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: string }> } };
      const toolResults = userEvent.message?.content?.filter((b) => b.type === "tool_result") ?? [];
      for (const tr of toolResults) {
        const preview = typeof tr.content === "string" ? tr.content.slice(0, 200) : "";
        if (preview.includes("task_id") || preview.includes("Task")) {
          log.info(tag, `subagent result received (tool_use_id: ${tr.tool_use_id ?? "?"}, preview: ${preview})`);
        }
      }
      // Tool results delivered — show "Thinking..." after 3s delay if no other event
      thinkingTimeout = setTimeout(() => {
        callbacks?.onThinking?.();
      }, 3000);
    } else if (event.type === "assistant") {
      resultSessionId = event.message.session_id;
      const hasToolUse = event.message.content.some((b: { type: string }) => b.type === "tool_use");
      for (const block of event.message.content) {
        if (block.type === "text") {
          log.debug(tag, `block: text — ${block.text.slice(0, 200)}`);
        } else if (block.type === "tool_use") {
          const inputStr = JSON.stringify(block.input);
          log.debug(tag, `block: tool_use (${block.name}) — ${inputStr.slice(0, 300)}`);
        } else {
          log.debug(tag, `block: ${block.type}`);
        }
        if (block.type === "text" && block.text.trim()) {
          // Only show as status if this message also contains tool calls (i.e. narration before tools).
          // Pure text messages are the final response — skip status to avoid duplication.
          if (hasToolUse) {
            callbacks?.onAssistantMessage?.(block.text);
          }
          callbacks?.onEvent?.({ type: "assistant_text", text: block.text });
          responseText = block.text;
        } else if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          if (block.name === "Task") {
            log.info(tag, `subagent spawned: "${input.description ?? "unnamed"}" (prompt: ${String(input.prompt ?? "").slice(0, 120)})`);
          } else if (block.name === "TaskOutput") {
            log.info(tag, `waiting for subagent output (task_id: ${input.task_id ?? "unknown"}, block: ${input.block ?? true}, timeout: ${input.timeout ?? "default"})`);
          } else if (block.name === "TaskStop") {
            log.info(tag, `stopping subagent (task_id: ${input.task_id ?? "unknown"})`);
          }
          callbacks?.onToolUse?.(block.name, input, friendlyToolStatus(block.name, input));
          callbacks?.onEvent?.({ type: "tool_use", name: block.name, input });
        }
      }
    } else if (event.type === "result" && event.subtype === "success") {
      responseText = event.result;
      resultSessionId = event.session_id;
      const denials = (event as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [];
      if (denials.length > 0) {
        for (const d of denials) {
          log.warn(tag, `permission denied: ${d.tool_name}`);
        }
      }
      log.info(tag, `done — session: ${resultSessionId}, cost: $${event.total_cost_usd}, duration: ${event.duration_ms}ms, turns: ${event.num_turns}${denials.length > 0 ? `, denials: ${denials.length}` : ""}`);

      // Capture usage metrics
      const usage = (event as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
      const sdkModelUsage = (event as { model_usage?: Record<string, { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; cost_usd?: number }> }).model_usage;
      const durationApiMs = (event as { duration_api_ms?: number }).duration_api_ms;
      if (usage) {
        const modelUsage = sdkModelUsage
          ? Object.fromEntries(
              Object.entries(sdkModelUsage).map(([model, mu]) => [model, {
                inputTokens: mu.input_tokens ?? 0,
                outputTokens: mu.output_tokens ?? 0,
                cacheReadTokens: mu.cache_read_input_tokens ?? 0,
                cacheCreationTokens: mu.cache_creation_input_tokens ?? 0,
                costUsd: mu.cost_usd ?? 0,
              }])
            ) as Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number }>
          : undefined;
        resultUsage = {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
          costUsd: event.total_cost_usd ?? 0,
          durationMs: event.duration_ms,
          durationApiMs: durationApiMs ?? event.duration_ms,
          turns: event.num_turns,
          model: resultModel,
          ...(modelUsage ? { modelUsage } : {}),
        };
      }
      callbacks?.onEvent?.({
        type: "result",
        cost: event.total_cost_usd,
        durationMs: event.duration_ms,
        turns: event.num_turns,
        ...(usage?.input_tokens != null ? { inputTokens: usage.input_tokens } : {}),
        ...(usage?.output_tokens != null ? { outputTokens: usage.output_tokens } : {}),
        ...(usage?.cache_read_input_tokens != null ? { cacheReadTokens: usage.cache_read_input_tokens } : {}),
      });
    } else if (event.type === "tool_use_summary") {
      log.debug(tag, `summary: ${event.summary}`);
      callbacks?.onToolUseSummary?.(event.summary);
    } else if (event.type === "result" && (event.subtype === "error_during_execution" || event.subtype === "error_max_turns")) {
      const denials = (event as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [];
      for (const d of denials) {
        log.warn(tag, `permission denied: ${d.tool_name}`);
      }
      log.error(tag, `${event.subtype}:`, "error" in event ? (event as { error: string }).error : "unknown error");
    }
  }

  // Clean up any pending timeout
  if (thinkingTimeout) {
    clearTimeout(thinkingTimeout);
  }

  if (abortController?.signal.aborted) {
    log.info(tag, "aborted by caller");
    return { text: "", sessionId: resultSessionId, usage: resultUsage };
  }

  return { text: responseText.trim(), sessionId: resultSessionId, usage: resultUsage };
}

export async function generateThreadTitle(userMessage: string, assistantResponse: string): Promise<{ title: string | null; usage?: EngineResult["usage"] }> {
  const userSnippet = userMessage.slice(0, 200);
  const assistantSnippet = assistantResponse.slice(0, 200);
  const prompt = `What is this conversation about? Reply with ONLY a short title (3-6 words). No quotes, no labels, no preamble.\n\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}`;

  const result = query({
    prompt,
    options: {
      model: "haiku",
      tools: [],
      maxTurns: 1,
      persistSession: false,
      permissionMode: "dontAsk",
    },
  });

  let text = "";
  let titleUsage: EngineResult["usage"] | undefined;
  for await (const msg of result) {
    if (msg.type === "result" && msg.subtype === "success") {
      text = msg.result;
      const usage = (msg as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
      const durationApiMs = (msg as { duration_api_ms?: number }).duration_api_ms;
      if (usage) {
        titleUsage = {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
          costUsd: msg.total_cost_usd ?? 0,
          durationMs: msg.duration_ms,
          durationApiMs: durationApiMs ?? msg.duration_ms,
          turns: msg.num_turns,
          model: "haiku",
        };
      }
    }
  }

  const title = text.trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^(title|topic|conversation|subject|#)\s*[:—–-]\s*/i, "")
    .trim();
  return { title: title || null, usage: titleUsage };
}

export function createClaudeEngine(): Engine {
  return {
    async run(message, options, trust, sessionId, callbacks, abortController) {
      try {
        return await execQuery(message, options, trust, sessionId, callbacks, abortController);
      } catch (err) {
        if (sessionId) {
          log.warn("engine", "session resume failed, retrying as new conversation");
          return await execQuery(message, options, trust, undefined, callbacks, abortController);
        }
        throw err;
      }
    },
  };
}

export const claudeEngine = createClaudeEngine();
