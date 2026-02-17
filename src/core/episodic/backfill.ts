import fs from "fs";
import path from "path";
import { generateEmbedding, isModelAvailable } from "./embeddings.js";
import { loadEmbeddings, appendEmbedding, rewriteEmbeddings, type EmbeddingRecord } from "./storage.js";
import { threadPath, listThreads, loadMessages } from "../threads.js";
import { log } from "../logger.js";

/**
 * Backfill embeddings for a single agent.
 *
 * - Scans all threads and finds unembedded user/assistant messages
 * - Generates embeddings for any gaps
 * - Removes embeddings for threads that no longer exist (orphan cleanup)
 *
 * Returns count of newly embedded messages and cleaned orphans.
 */
export async function backfillAgent(
  agentDir: string,
): Promise<{ embedded: number; cleaned: number }> {
  if (!isModelAvailable()) {
    log.warn("episodic", "embedding model not available, skipping backfill");
    return { embedded: 0, cleaned: 0 };
  }

  const agentId = path.basename(agentDir);
  const existing = loadEmbeddings(agentDir);

  // Build a set of existing (threadId, messageIndex, role) for fast lookup
  const existingKeys = new Set<string>();
  for (const rec of existing) {
    existingKeys.add(`${rec.threadId}:${rec.messageIndex}:${rec.role}`);
  }

  // Get all current thread IDs
  const threads = listThreads(agentDir);
  const currentThreadIds = new Set(threads.map((t) => t.id));

  // Clean orphaned embeddings (threads that no longer exist)
  let cleaned = 0;
  const validRecords: EmbeddingRecord[] = [];
  for (const rec of existing) {
    if (currentThreadIds.has(rec.threadId)) {
      validRecords.push(rec);
    } else {
      cleaned++;
    }
  }

  if (cleaned > 0) {
    rewriteEmbeddings(agentDir, validRecords);
    log.info("episodic", `cleaned ${cleaned} orphaned embeddings for agent ${agentId}`);
  }

  // Find and embed missing messages
  let embedded = 0;

  for (const thread of threads) {
    const filePath = threadPath(agentDir, thread.id);
    if (!fs.existsSync(filePath)) continue;

    let messages;
    try {
      messages = loadMessages(filePath);
    } catch {
      continue;
    }

    // Filter to user/assistant messages only
    const relevantMessages = messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    );

    let messageIndex = 0;
    for (const msg of relevantMessages) {
      const key = `${thread.id}:${messageIndex}:${msg.role}`;

      if (!existingKeys.has(key)) {
        try {
          const embedding = await generateEmbedding(msg.text);
          const record: EmbeddingRecord = {
            threadId: thread.id,
            messageIndex,
            role: msg.role,
            text: msg.text,
            embedding,
            timestamp: msg.timestamp,
          };
          appendEmbedding(agentDir, record);
          embedded++;
        } catch (err) {
          log.warn("episodic", `failed to embed message in thread ${thread.id}:`, (err as Error).message);
        }
      }

      messageIndex++;
    }
  }

  if (embedded > 0) {
    log.info("episodic", `backfilled ${embedded} embeddings for agent ${agentId}`);
  }

  return { embedded, cleaned };
}
