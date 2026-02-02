import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export type ChannelType = "telegram" | "api";

export interface ThreadManifest {
  title?: string;
  channel: ChannelType;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface ThreadInfo {
  id: string;
  agentId: string;
  manifest: ThreadManifest;
}

export function threadPath(agentDir: string, threadId: string): string {
  return path.join(agentDir, "threads", `${threadId}.jsonl`);
}

export function loadManifest(filePath: string): ThreadManifest {
  const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0]!;
  return JSON.parse(firstLine);
}

export function saveManifest(filePath: string, manifest: ThreadManifest): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  lines[0] = JSON.stringify(manifest);
  fs.writeFileSync(filePath, lines.join("\n"));
}

export function createThread(agentDir: string, channel: ChannelType): string {
  const id = randomBytes(6).toString("hex");
  const threadsDir = path.join(agentDir, "threads");
  if (!fs.existsSync(threadsDir)) fs.mkdirSync(threadsDir, { recursive: true });

  const manifest: ThreadManifest = {
    channel,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(threadsDir, `${id}.jsonl`),
    JSON.stringify(manifest) + "\n",
  );

  return id;
}

export function listThreads(agentDir: string): ThreadInfo[] {
  const threadsDir = path.join(agentDir, "threads");
  if (!fs.existsSync(threadsDir)) return [];

  const agentId = path.basename(agentDir);
  const threads: ThreadInfo[] = [];

  for (const file of fs.readdirSync(threadsDir)) {
    if (!file.endsWith(".jsonl")) continue;
    const id = file.replace(".jsonl", "");
    try {
      const manifest = loadManifest(path.join(threadsDir, file));
      threads.push({ id, agentId, manifest });
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
      messages.push(JSON.parse(line));
    } catch {
      // skip corrupt lines
    }
  }
  return messages;
}

export function deleteThread(agentDir: string, threadId: string): void {
  const filePath = threadPath(agentDir, threadId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function appendMessage(filePath: string, msg: ThreadMessage): void {
  fs.appendFileSync(filePath, JSON.stringify(msg) + "\n");
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
