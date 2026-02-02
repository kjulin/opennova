import { query, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeOptions {
  cwd?: string;
  systemPrompt?: string;
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
    default:
      return `Using ${toolName}…`;
  }
}

export async function runClaude(
  prompt: string,
  options: ClaudeOptions = {},
  sessionId?: string,
  callbacks?: ClaudeCallbacks,
): Promise<ClaudeResult> {
  try {
    return await execClaude(prompt, options, sessionId, callbacks);
  } catch (err) {
    if (sessionId) {
      console.log("[claude] session resume failed, retrying as new conversation");
      return await execClaude(prompt, options, undefined, callbacks);
    }
    throw err;
  }
}

async function execClaude(
  prompt: string,
  options: ClaudeOptions,
  sessionId: string | undefined,
  callbacks: ClaudeCallbacks | undefined,
): Promise<ClaudeResult> {
  console.log(`[claude] running with prompt: "${prompt}"${sessionId ? ` (session: ${sessionId})` : ""}`);

  const result = query({
    prompt,
    options: {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.agents ? { agents: options.agents } : {}),
      ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
      allowDangerouslySkipPermissions: true,
      permissionMode: "bypassPermissions",
      ...(sessionId ? { resume: sessionId } : {}),
    },
  });

  let responseText = "";
  let resultSessionId: string | undefined;

  for await (const message of result) {
    console.log(`[claude] event: ${message.type}${("subtype" in message && message.subtype) ? `:${message.subtype}` : ""}`);

    if (message.type === "assistant") {
      resultSessionId = message.message.session_id;
      const hasToolUse = message.message.content.some((b: { type: string }) => b.type === "tool_use");
      for (const block of message.message.content) {
        console.log(`[claude]   block: ${block.type}`);
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
      console.log(`[claude] done — session: ${resultSessionId}, cost: $${message.total_cost_usd}, duration: ${message.duration_ms}ms`);
    } else if (message.type === "tool_use_summary") {
      console.log(`[claude] summary: ${message.summary}`);
      callbacks?.onToolUseSummary?.(message.summary);
    } else if (message.type === "result" && message.subtype === "error_during_execution") {
      console.error(`[claude] error during execution:`, JSON.stringify(message, null, 2));
    }
  }

  return { text: responseText.trim(), sessionId: resultSessionId };
}
