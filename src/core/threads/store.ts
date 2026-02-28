import fs from "fs";
import path from "path";
import { Config } from "../config.js";
import {
  threadPath,
  createThread,
  listThreads,
  loadManifest,
  saveManifest,
  loadMessages,
  loadEvents,
  withThreadLock,
  type ThreadManifest,
  type ThreadMessage,
  type ThreadEvent,
  type CreateThreadOptions,
} from "./io.js";
import { searchThreads, type SearchResult } from "../episodic/search.js";
import { backfillAgent } from "../episodic/backfill.js";

export interface SearchOptions {
  agentId?: string;
  limit?: number;
}

export interface BackfillResult {
  embedded: number;
  cleaned: number;
}

export interface ThreadStore {
  create(agentId: string, opts?: CreateThreadOptions): string;
  get(threadId: string): ThreadManifest | null;
  list(agentId: string): ThreadManifest[];
  delete(threadId: string): void;

  appendMessage(threadId: string, msg: ThreadMessage): void;
  appendEvent(threadId: string, event: ThreadEvent): void;
  loadEvents(threadId: string): ThreadEvent[];
  loadMessages(threadId: string): ThreadMessage[];

  updateManifest(threadId: string, partial: Partial<ThreadManifest>): void;

  withLock<T>(threadId: string, fn: () => Promise<T>): Promise<T>;

  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
  backfill(agentId: string): Promise<BackfillResult>;
}

export class FilesystemThreadStore implements ThreadStore {
  private agentDirFor(agentId: string): string {
    return path.join(Config.workspaceDir, "agents", agentId);
  }

  private resolveThread(threadId: string): { filePath: string; agentDir: string; agentId: string } | null {
    const agentsDir = path.join(Config.workspaceDir, "agents");
    if (!fs.existsSync(agentsDir)) return null;

    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const agentDir = path.join(agentsDir, entry.name);
      const filePath = threadPath(agentDir, threadId);
      if (fs.existsSync(filePath)) {
        return { filePath, agentDir, agentId: entry.name };
      }
    }

    return null;
  }

  private requireThread(threadId: string): { filePath: string; agentDir: string; agentId: string } {
    const result = this.resolveThread(threadId);
    if (!result) throw new Error(`Thread not found: ${threadId}`);
    return result;
  }

  create(agentId: string, opts?: CreateThreadOptions): string {
    return createThread(this.agentDirFor(agentId), opts);
  }

  get(threadId: string): ThreadManifest | null {
    const resolved = this.resolveThread(threadId);
    if (!resolved) return null;
    const manifest = loadManifest(resolved.filePath);
    if (!manifest.id) manifest.id = threadId;
    if (!manifest.agentId) manifest.agentId = resolved.agentId;
    return manifest;
  }

  list(agentId: string): ThreadManifest[] {
    return listThreads(this.agentDirFor(agentId));
  }

  delete(threadId: string): void {
    const resolved = this.resolveThread(threadId);
    if (!resolved) return;
    fs.unlinkSync(resolved.filePath);
  }

  appendMessage(threadId: string, msg: ThreadMessage): void {
    const { filePath } = this.requireThread(threadId);
    fs.appendFileSync(filePath, JSON.stringify(msg) + "\n");
  }

  appendEvent(threadId: string, event: ThreadEvent): void {
    const { filePath } = this.requireThread(threadId);
    fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
  }

  loadEvents(threadId: string): ThreadEvent[] {
    const { filePath } = this.requireThread(threadId);
    return loadEvents(filePath);
  }

  loadMessages(threadId: string): ThreadMessage[] {
    const { filePath } = this.requireThread(threadId);
    return loadMessages(filePath);
  }

  updateManifest(threadId: string, partial: Partial<ThreadManifest>): void {
    const { filePath } = this.requireThread(threadId);
    const manifest = loadManifest(filePath);
    Object.assign(manifest, partial);
    saveManifest(filePath, manifest);
  }

  withLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    return withThreadLock(threadId, fn);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    if (!opts?.agentId) throw new Error("agentId is required for search");
    const agentDir = this.agentDirFor(opts.agentId);
    return searchThreads(agentDir, query, opts.limit ?? 5);
  }

  async backfill(agentId: string): Promise<BackfillResult> {
    return backfillAgent(this.agentDirFor(agentId));
  }
}
