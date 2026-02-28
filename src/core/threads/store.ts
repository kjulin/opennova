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
  create(agentId: string, opts?: CreateThreadOptions): string {
    return createThread(agentId, opts);
  }

  get(threadId: string): ThreadManifest | null {
    const filePath = threadPath(threadId);
    if (!fs.existsSync(filePath)) return null;
    return loadManifest(filePath);
  }

  list(agentId: string): ThreadManifest[] {
    return listThreads(agentId);
  }

  delete(threadId: string): void {
    const filePath = threadPath(threadId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  appendMessage(threadId: string, msg: ThreadMessage): void {
    const filePath = threadPath(threadId);
    fs.appendFileSync(filePath, JSON.stringify(msg) + "\n");
  }

  appendEvent(threadId: string, event: ThreadEvent): void {
    const filePath = threadPath(threadId);
    fs.appendFileSync(filePath, JSON.stringify(event) + "\n");
  }

  loadEvents(threadId: string): ThreadEvent[] {
    const filePath = threadPath(threadId);
    return loadEvents(filePath);
  }

  loadMessages(threadId: string): ThreadMessage[] {
    const filePath = threadPath(threadId);
    return loadMessages(filePath);
  }

  updateManifest(threadId: string, partial: Partial<ThreadManifest>): void {
    const filePath = threadPath(threadId);
    const manifest = loadManifest(filePath);
    Object.assign(manifest, partial);
    saveManifest(filePath, manifest);
  }

  withLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    return withThreadLock(threadId, fn);
  }

  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    if (!opts?.agentId) throw new Error("agentId is required for search");
    return searchThreads(opts.agentId, query, opts.limit ?? 5);
  }

  async backfill(agentId: string): Promise<BackfillResult> {
    return backfillAgent(agentId);
  }
}
