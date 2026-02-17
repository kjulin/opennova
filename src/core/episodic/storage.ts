import fs from "fs";
import path from "path";
import { z } from "zod/v4";

export const EmbeddingRecordSchema = z.object({
  threadId: z.string(),
  messageIndex: z.number().int(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  embedding: z.array(z.number()),
  timestamp: z.string(),
});

export type EmbeddingRecord = z.infer<typeof EmbeddingRecordSchema>;

function getEmbeddingsPath(agentDir: string): string {
  return path.join(agentDir, "embeddings.jsonl");
}

/**
 * Load all embedding records for an agent.
 */
export function loadEmbeddings(agentDir: string): EmbeddingRecord[] {
  const filePath = getEmbeddingsPath(agentDir);
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
export function appendEmbedding(agentDir: string, record: EmbeddingRecord): void {
  const filePath = getEmbeddingsPath(agentDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
}

/**
 * Rewrite the entire embeddings file (used by backfill to clean orphans).
 */
export function rewriteEmbeddings(agentDir: string, records: EmbeddingRecord[]): void {
  const filePath = getEmbeddingsPath(agentDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const content = records.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(filePath, content ? content + "\n" : "");
}
