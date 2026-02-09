import {query, type SettingSource} from "@anthropic-ai/claude-agent-sdk";
import { log } from "../logger.js";
import type { Engine, EngineOptions, EngineResult, EngineCallbacks } from "./types.js";

function friendlyToolStatus(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "WebSearch":
      return input.query ? `Searching the web (${input.query})…` : "Searching the web…";
    case "WebFetch":
      return input.url ? `Fetching ${input.url}…` : "Fetching a webpage…";
    case "Read":
      return input.file_path ? `Reading ${input.file_path}…` : "Reading files…";
    case "Write":
      return input.file_path ? `Writing ${input.file_path}…` : "Writing a file…";
    case "Edit":
      return input.file_path ? `Editing ${input.file_path}…` : "Editing a file…";
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
    case "mcp__ask-agent__ask_agent": {
      const msg = input.message ? `: ${String(input.message).slice(0, 80)}` : "";
      return input.agent ? `Asking ${input.agent}${msg}…` : "Asking another agent…";
    }
    case "mcp__usage__get_usage_stats":
      return input.period ? `Checking ${input.period}'s usage…` : "Checking usage stats…";
    case "mcp__suggest-edit__suggest_edit":
      return input.file ? `Suggesting edit to ${input.file}…` : "Suggesting an edit…";
    default:
      return `Using ${toolName}…`;
  }
}

async function execQuery(
  message: string,
  options: EngineOptions,
  sessionId: string | undefined,
  callbacks: EngineCallbacks | undefined,
  abortController: AbortController | undefined,
): Promise<EngineResult> {
  log.info("engine", `running${sessionId ? ` (session: ${sessionId})` : ""}`);

  const queryOptions = {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.directories && options.directories.length > 0 ? { additionalDirectories: options.directories } : {}),
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.agents ? { agents: options.agents } : {}),
    ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
    // Security options (injected by Runtime)
    ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
    ...(options.disallowedTools ? { disallowedTools: options.disallowedTools } : {}),
    ...(options.allowDangerouslySkipPermissions ? { allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions } : {}),
    ...(sessionId ? { resume: sessionId } : {}),
    settingSources: ["project"] as SettingSource[],
  };

  // Log options without mcpServers (may contain circular refs)
  const { mcpServers, ...loggableOptions } = queryOptions as Record<string, unknown>;
  log.debug("engine", "options", JSON.stringify({
    ...loggableOptions,
    ...(mcpServers ? { mcpServers: Object.keys(mcpServers as object) } : {}),
  }, null, 2));

  const result = query({
    prompt: message,
    options: {
      ...queryOptions,
      ...(abortController ? { abortController } : {})
    },
  });

  let responseText = "";
  let resultSessionId: string | undefined;
  let resultUsage: EngineResult["usage"] | undefined;

  for await (const event of result) {
    log.debug("engine", `event: ${event.type}${("subtype" in event && event.subtype) ? `:${event.subtype}` : ""}`);

    if (event.type === "assistant") {
      resultSessionId = event.message.session_id;
      const hasToolUse = event.message.content.some((b: { type: string }) => b.type === "tool_use");
      for (const block of event.message.content) {
        log.debug("engine", `block: ${block.type}${"name" in block ? ` (${block.name})` : ""}`);
        if (block.type === "text" && block.text.trim()) {
          // Only show as status if this message also contains tool calls (i.e. narration before tools).
          // Pure text messages are the final response — skip status to avoid duplication.
          if (hasToolUse) {
            callbacks?.onAssistantMessage?.(block.text);
          }
          responseText = block.text;
        } else if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          callbacks?.onToolUse?.(block.name, input, friendlyToolStatus(block.name, input));
        }
      }
    } else if (event.type === "result" && event.subtype === "success") {
      responseText = event.result;
      resultSessionId = event.session_id;
      const denials = (event as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [];
      if (denials.length > 0) {
        for (const d of denials) {
          log.warn("engine", `permission denied: ${d.tool_name}`);
        }
      }
      log.info("engine", `done — session: ${resultSessionId}, cost: $${event.total_cost_usd}, duration: ${event.duration_ms}ms, turns: ${event.num_turns}${denials.length > 0 ? `, denials: ${denials.length}` : ""}`);

      // Capture usage metrics
      const usage = (event as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } }).usage;
      if (usage) {
        resultUsage = {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          durationMs: event.duration_ms,
          turns: event.num_turns,
        };
      }
    } else if (event.type === "tool_use_summary") {
      log.debug("engine", `summary: ${event.summary}`);
      callbacks?.onToolUseSummary?.(event.summary);
    } else if (event.type === "result" && (event.subtype === "error_during_execution" || event.subtype === "error_max_turns")) {
      const denials = (event as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [];
      for (const d of denials) {
        log.warn("engine", `permission denied: ${d.tool_name}`);
      }
      log.error("engine", `${event.subtype}:`, "error" in event ? (event as { error: string }).error : "unknown error");
    }
  }

  if (abortController?.signal.aborted) {
    log.info("engine", "aborted by caller");
    return { text: "", sessionId: resultSessionId, usage: resultUsage };
  }

  return { text: responseText.trim(), sessionId: resultSessionId, usage: resultUsage };
}

export async function generateThreadTitle(userMessage: string, assistantResponse: string): Promise<string | null> {
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
  for await (const msg of result) {
    if (msg.type === "result" && msg.subtype === "success") {
      text = msg.result;
    }
  }

  const title = text.trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^(title|topic|conversation|subject|#)\s*[:—–-]\s*/i, "")
    .trim();
  return title || null;
}

export function createClaudeEngine(): Engine {
  return {
    async run(message, options, sessionId, callbacks, abortController) {
      try {
        return await execQuery(message, options, sessionId, callbacks, abortController);
      } catch (err) {
        if (sessionId) {
          log.warn("engine", "session resume failed, retrying as new conversation");
          return await execQuery(message, options, undefined, callbacks, abortController);
        }
        throw err;
      }
    },
  };
}

export const claudeEngine = createClaudeEngine();
