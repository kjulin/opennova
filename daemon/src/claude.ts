import { query, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { securityOptions, type SecurityLevel } from "./security.js";
import { log } from "./logger.js";

export interface ClaudeOptions {
  cwd?: string;
  additionalDirectories?: string[];
  systemPrompt?: string;
  security?: SecurityLevel;
  agents?: Record<string, { description: string; prompt: string; tools?: string[]; disallowedTools?: string[]; model?: "sonnet" | "opus" | "haiku"; maxTurns?: number }>;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface ClaudeResult {
  text: string;
  sessionId?: string | undefined;
}

export interface ClaudeCallbacks {
  onAssistantMessage?: (text: string) => void;
  onToolUse?: (toolName: string, input: Record<string, unknown>, summary: string) => void;
  onToolUseSummary?: (summary: string) => void;
}

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
    default:
      return `Using ${toolName}…`;
  }
}

export async function generateThreadTitle(userMessage: string, assistantResponse: string): Promise<string | null> {
  const userSnippet = userMessage.slice(0, 200);
  const assistantSnippet = assistantResponse.slice(0, 200);
  const prompt = `Generate a concise title (3-6 words, no quotes) for this conversation:\n\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}`;

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

  const title = text.trim().replace(/^["']|["']$/g, "");
  return title || null;
}

export async function runClaude(
  prompt: string,
  options: ClaudeOptions = {},
  sessionId?: string,
  callbacks?: ClaudeCallbacks,
  abortController?: AbortController,
): Promise<ClaudeResult> {
  try {
    return await execClaude(prompt, options, sessionId, callbacks, abortController);
  } catch (err) {
    if (sessionId) {
      log.warn("claude", "session resume failed, retrying as new conversation");
      return await execClaude(prompt, options, undefined, callbacks, abortController);
    }
    throw err;
  }
}

async function execClaude(
  prompt: string,
  options: ClaudeOptions,
  sessionId: string | undefined,
  callbacks: ClaudeCallbacks | undefined,
  abortController: AbortController | undefined,
): Promise<ClaudeResult> {
  const security = options.security ?? "standard";
  log.info("claude", `running${sessionId ? ` (session: ${sessionId})` : ""}`);

  const result = query({
    prompt,
    options: {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.additionalDirectories && options.additionalDirectories.length > 0 ? { additionalDirectories: options.additionalDirectories } : {}),
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.agents ? { agents: options.agents } : {}),
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
      ...securityOptions(security),
      ...(sessionId ? { resume: sessionId } : {}),
      ...(abortController ? { abortController } : {}),
    },
  });

  let responseText = "";
  let resultSessionId: string | undefined;

  for await (const message of result) {
    log.debug("claude", `event: ${message.type}${("subtype" in message && message.subtype) ? `:${message.subtype}` : ""}`);

    if (message.type === "assistant") {
      resultSessionId = message.message.session_id;
      const hasToolUse = message.message.content.some((b: { type: string }) => b.type === "tool_use");
      for (const block of message.message.content) {
        log.debug("claude", `block: ${block.type}${"name" in block ? ` (${block.name})` : ""}`);
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
    } else if (message.type === "result" && message.subtype === "success") {
      responseText = message.result;
      resultSessionId = message.session_id;
      const denials = (message as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [];
      if (denials.length > 0) {
        for (const d of denials) {
          log.warn("claude", `permission denied: ${d.tool_name}`);
        }
      }
      log.info("claude", `done — session: ${resultSessionId}, cost: $${message.total_cost_usd}, duration: ${message.duration_ms}ms, turns: ${message.num_turns}${denials.length > 0 ? `, denials: ${denials.length}` : ""}`);
    } else if (message.type === "tool_use_summary") {
      log.debug("claude", `summary: ${message.summary}`);
      callbacks?.onToolUseSummary?.(message.summary);
    } else if (message.type === "result" && (message.subtype === "error_during_execution" || message.subtype === "error_max_turns")) {
      const denials = (message as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [];
      for (const d of denials) {
        log.warn("claude", `permission denied: ${d.tool_name}`);
      }
      log.error("claude", `${message.subtype}:`, "error" in message ? (message as { error: string }).error : "unknown error");
    }
  }

  if (abortController?.signal.aborted) {
    log.info("claude", "aborted by caller");
    return { text: "", sessionId: resultSessionId };
  }

  return { text: responseText.trim(), sessionId: resultSessionId };
}
