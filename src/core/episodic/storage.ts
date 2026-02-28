import fs from "fs";
import path from "path";
import { z } from "zod/v4";
import { Config } from "../config.js";

export const EmbeddingRecordSchema = z.object({
  threadId: z.string(),
  messageIndex: z.number().int(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  embedding: z.array(z.number()),
  timestamp: z.string(),
});

export type EmbeddingRecord = z.infer<typeof EmbeddingRecordSchema>;

function getEmbeddingsPath(agentId: string): string {
  return path.join(Config.workspaceDir, "threads", "embeddings", `${agentId}.jsonl`);
}

/**
 * Load all embedding records for an agent.
 */
export function loadEmbeddings(agentId: string): EmbeddingRecord[] {
  const filePath = getEmbeddingsPath(agentId);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const records: EmbeddingRecord[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const result = EmbeddingRecordSchema.safeParse(parsed);
      if (result.success) {
        records.push(result.data);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return records;
}

/**
 * Append a single embedding record to the agent's embeddings file.
 */
export function appendEmbedding(agentId: string, record: EmbeddingRecord): void {
  const filePath = getEmbeddingsPath(agentId);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
}

/**
 * Rewrite the entire embeddings file (used by backfill to clean orphans).
 */
export function rewriteEmbeddings(agentId: string, records: EmbeddingRecord[]): void {
  const filePath = getEmbeddingsPath(agentId);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const content = records.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(filePath, content ? content + "\n" : "");
}

/**
 * Delete the embeddings file for an agent.
 */
export function deleteEmbeddings(agentId: string): void {
  const filePath = getEmbeddingsPath(agentId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
