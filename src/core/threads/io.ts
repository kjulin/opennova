import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { ThreadManifestSchema } from "../schemas.js";
import { Config } from "../config.js";

export interface ThreadManifest {
  id: string;
  agentId: string;
  title?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  /** Allow additional fields (e.g. taskId) */
  [key: string]: unknown;
}

export interface ThreadMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface ThreadMessageEvent {
  type: "message";
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface ThreadToolUseEvent {
  type: "tool_use";
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
}

export interface ThreadAssistantTextEvent {
  type: "assistant_text";
  text: string;
  timestamp: string;
}

export interface ThreadResultEvent {
  type: "result";
  cost?: number;
  durationMs?: number;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  timestamp: string;
}

export type ThreadEvent =
  | ThreadMessageEvent
  | ThreadToolUseEvent
  | ThreadAssistantTextEvent
  | ThreadResultEvent;


export function threadPath(threadId: string): string {
  return path.join(Config.workspaceDir, "threads", `${threadId}.jsonl`);
}

export function loadManifest(filePath: string): ThreadManifest {
  const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0]!;
  const raw = JSON.parse(firstLine);
  const result = ThreadManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid thread manifest in ${path.basename(filePath)}: ${result.error.message}`);
  }
  return result.data as ThreadManifest;
}

export function saveManifest(filePath: string, manifest: ThreadManifest): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  lines[0] = JSON.stringify(manifest);
  fs.writeFileSync(filePath, lines.join("\n"));
}

export interface CreateThreadOptions {
  taskId?: string;
}

export function createThread(agentId: string, options?: CreateThreadOptions): string {
  const id = randomBytes(6).toString("hex");
  const threadsDir = path.join(Config.workspaceDir, "threads");
  if (!fs.existsSync(threadsDir)) fs.mkdirSync(threadsDir, { recursive: true });

  const manifest: ThreadManifest = {
    id,
    agentId,
    ...(options?.taskId ? { taskId: options.taskId } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(threadsDir, `${id}.jsonl`),
    JSON.stringify(manifest) + "\n",
  );

  return id;
}

export function listThreads(agentId?: string): ThreadManifest[] {
  const threadsDir = path.join(Config.workspaceDir, "threads");
  if (!fs.existsSync(threadsDir)) return [];

  const threads: ThreadManifest[] = [];

  for (const file of fs.readdirSync(threadsDir)) {
    if (!file.endsWith(".jsonl")) continue;
    try {
      const manifest = loadManifest(path.join(threadsDir, file));
      if (agentId && manifest.agentId !== agentId) continue;
      threads.push(manifest);
    } catch {
      // skip corrupt files
    }
  }

  return threads;
}

export function loadMessages(filePath: string): ThreadMessage[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").slice(1); // skip manifest line
  const messages: ThreadMessage[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type && parsed.type !== "message") continue;
      messages.push(parsed);
    } catch {
      // skip corrupt lines
    }
  }
  return messages;
}

export function deleteThread(threadId: string): void {
  const filePath = threadPath(threadId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function appendMessage(filePath: string, msg: ThreadMessage): void {
  fs.appendFileSync(filePath, JSON.stringify(msg) + "\n");
}

export function appendEvent(filePath: string, event: ThreadEvent): void {
  fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
}

export function loadEvents(filePath: string): ThreadEvent[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").slice(1); // skip manifest line
  const events: ThreadEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type) {
        events.push(parsed);
      } else {
        events.push({ type: "message", ...parsed });
      }
    } catch {
      // skip corrupt lines
    }
  }
  return events;
}

// Per-thread promise queue to serialize concurrent writes
const threadLocks = new Map<string, Promise<void>>();

export async function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = threadLocks.get(threadId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  threadLocks.set(threadId, next);

  await prev;
  try {
    return await fn();
  } finally {
    resolve!();
    if (threadLocks.get(threadId) === next) {
      threadLocks.delete(threadId);
    }
  }
}
