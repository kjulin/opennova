// Configuration
export { Config } from "./config.js";

// Models
export { MODELS, type Model } from "./models.js";

// Logger
export { log, setLogger, type Logger } from "./logger.js";

// Schemas
export {
  AgentBotConfigSchema,
  TelegramConfigSchema,
  TriggerSchema,
  ThreadManifestSchema,
  ThreadMessageSchema,
  ThreadMessageEventSchema,
  ThreadToolUseEventSchema,
  ThreadAssistantTextEventSchema,
  ThreadResultEventSchema,
  ThreadEventSchema,
  TrustLevel,
  safeParseJsonFile,
  type AgentBotConfig,
  type TelegramConfig,
  type Trigger,
} from "./schemas.js";

// Security
export { trustOptions, type TrustLevel as TrustLevelType } from "./security.js";

// Threads
export {
  threadPath,
  loadManifest,
  saveManifest,
  createThread,
  listThreads,
  loadMessages,
  deleteThread,
  appendMessage,
  appendEvent,
  loadEvents,
  withThreadLock,
  findThread,
  getThreadManifest,
  type ThreadManifest,
  type ThreadMessage,
  type ThreadInfo,
  type CreateThreadOptions,
  type ThreadEvent,
  type ThreadMessageEvent,
  type ThreadToolUseEvent,
  type ThreadAssistantTextEvent,
  type ThreadResultEvent,
} from "./threads.js";

// Agents
export {
  loadAgents,
  getAgentCwd,
  getAgentDirectories,
  agentsDir,
  agentDir,
  validateAgentId,
  readAgentJson,
  writeAgentJson,
  loadAgentConfig,
  loadAllAgents,
  type AgentConfig,
  type AgentJson,
} from "./agents/index.js";

// Agent schema constants
export {
  VALID_AGENT_ID,
  MAX_IDENTITY_LENGTH,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  AgentJsonSchema,
} from "./schemas.js";

// Prompts
export {
  buildSystemPrompt,
  buildMemoryPrompt,
  buildContextBlock,
  buildDirectoriesBlock,
  getFormattingInstructions,
  STORAGE_INSTRUCTIONS,
} from "./prompts/index.js";

// Engine
export {
  claudeEngine,
  createClaudeEngine,
  generateThreadTitle,
  type Engine,
  type EngineEvent,
  type EngineOptions,
  type EngineResult,
  type EngineCallbacks,
} from "./engine/index.js";

// Agent Runner
export {
  agentRunner,
  createAgentRunner,
  runAgent,
  type AgentRunner,
  type AgentRunnerCallbacks,
  type RunAgentOverrides,
} from "./agent-runner.js";

// Capabilities
export {
  resolveCapabilities,
  resolveInjections,
  capabilityToolPatterns,
  KNOWN_CAPABILITIES,
  type ResolverContext,
} from "./capabilities.js";

// Triggers
export {
  loadTriggers,
  saveTriggers,
  createTriggerMcpServer,
} from "./triggers.js";

// MCP Servers
export { createMemoryMcpServer } from "./memory.js";
export { createAgentManagementMcpServer, createSelfManagementMcpServer } from "./agents/management.js";
export { createAgentsMcpServer, type RunAgentFn } from "./agents/ask-agent.js";
export { createMediaMcpServer, type FileType, type OnFileSendCallback } from "./media/mcp.js";
export {
  appendUsage,
  loadUsageRecords,
  getUsageStats,
  loadClaudeCodeStats,
  getClaudeCodeStats,
  type UsageRecord,
  type UsageStats,
  type ClaudeCodeStats,
  type ClaudeCodePeriodStats,
} from "./usage.js";

// History (Episodic Memory)
export {
  generateEmbedding,
  cosineSimilarity,
  isModelAvailable,
  downloadEmbeddingModel,
  loadEmbeddings,
  appendEmbedding,
  rewriteEmbeddings,
  EmbeddingRecordSchema,
  searchThreads,
  backfillAgent,
  createHistoryMcpServer,
  logSearch,
  type EmbeddingRecord,
  type SearchResult,
  type SearchResultMessage,
  type SearchAnalytics,
} from "./episodic/index.js";

// Transcription
export {
  transcribe,
  loadTranscriptionConfig,
  saveTranscriptionConfig,
  checkDependencies as checkTranscriptionDependencies,
  downloadModel,
  MODEL_URLS,
  MODEL_SIZES,
  checkFfmpeg,
  checkWhisper,
  type TranscriptionConfig,
  type TranscriptionResult,
  type TranscriptionOptions,
} from "./transcription/index.js";

