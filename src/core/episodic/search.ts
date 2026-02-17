import fs from "fs";
import path from "path";
import { generateEmbedding, cosineSimilarity } from "./embeddings.js";
import { loadEmbeddings, type EmbeddingRecord } from "./storage.js";
import { threadPath, loadManifest, loadMessages, type ThreadMessage } from "../threads.js";

const CONTEXT_WINDOW = 3;

export interface SearchResultMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface SearchResult {
  threadId: string;
  threadTitle: string;
  timestamp: string;
  score: number;
  messages: SearchResultMessage[];
}

/**
 * Search across all embedded messages for an agent using cosine similarity.
 * Returns top-N results with surrounding context messages.
 */
export async function searchThreads(
  agentDir: string,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const embeddings = loadEmbeddings(agentDir);
  if (embeddings.length === 0) return [];

  const queryEmbedding = await generateEmbedding(query);

  // Score all embeddings
  const scored: Array<{ record: EmbeddingRecord; score: number }> = [];
  for (const record of embeddings) {
    const score = cosineSimilarity(queryEmbedding, record.embedding);
    scored.push({ record, score });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate by threadId — keep best match per thread
  const seenThreads = new Set<string>();
  const topMatches: Array<{ record: EmbeddingRecord; score: number }> = [];

  for (const entry of scored) {
    if (seenThreads.has(entry.record.threadId)) continue;
    seenThreads.add(entry.record.threadId);
    topMatches.push(entry);
    if (topMatches.length >= limit) break;
  }

  // Build results with context
  const results: SearchResult[] = [];

  for (const match of topMatches) {
    const { record, score } = match;
    const filePath = threadPath(agentDir, record.threadId);

    // Thread may have been deleted
    if (!fs.existsSync(filePath)) continue;

    let threadTitle = "";
    try {
      const manifest = loadManifest(filePath);
      threadTitle = (manifest.title as string | undefined) ?? "";
    } catch {
      // Skip if manifest is corrupt
    }

    // Load user/assistant messages from thread
    let threadMessages: ThreadMessage[];
    try {
      threadMessages = loadMessages(filePath);
    } catch {
      continue;
    }

    // Filter to user/assistant only (loadMessages already does this)
    const relevantMessages = threadMessages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );

    // Find the matching message index in the filtered list
    const matchIndex = relevantMessages.findIndex(
      (m) => m.role === record.role && m.text === record.text,
    );

    // Extract ±CONTEXT_WINDOW surrounding messages
    const startIdx = Math.max(0, matchIndex === -1 ? 0 : matchIndex - CONTEXT_WINDOW);
    const endIdx = Math.min(
      relevantMessages.length,
      matchIndex === -1 ? relevantMessages.length : matchIndex + CONTEXT_WINDOW + 1,
    );

    const contextMessages: SearchResultMessage[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const msg = relevantMessages[i]!;
      contextMessages.push({
        role: msg.role,
        text: msg.text,
        timestamp: msg.timestamp,
      });
    }

    results.push({
      threadId: record.threadId,
      threadTitle,
      timestamp: record.timestamp,
      score,
      messages: contextMessages,
    });
  }

  return results;
}
