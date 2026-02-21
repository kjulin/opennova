export {
  generateEmbedding,
  cosineSimilarity,
  isModelAvailable,
  downloadEmbeddingModel,
} from "./embeddings.js";

export {
  loadEmbeddings,
  appendEmbedding,
  rewriteEmbeddings,
  EmbeddingRecordSchema,
  type EmbeddingRecord,
} from "./storage.js";

export {
  searchThreads,
  type SearchResult,
  type SearchResultMessage,
} from "./search.js";

export { backfillAgent } from "./backfill.js";

export { createHistoryMcpServer } from "./mcp.js";

export { logSearch, type SearchAnalytics } from "./analytics.js";
