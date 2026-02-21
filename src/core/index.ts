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
  SecurityLevel,
  SettingsSchema,
  safeParseJsonFile,
  type AgentBotConfig,
  type TelegramConfig,
  type Trigger,
  type Settings,
} from "./schemas.js";

// Security
export { securityOptions, type SecurityLevel as SecurityLevelType } from "./security.js";

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
  type ChannelType,
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
  getAgentRole,
  loadSettings,
  resolveSecurityLevel,
  type SubagentConfig,
  type AgentConfig,
} from "./agents.js";

// Prompts
export {
  buildSystemPrompt,
  buildMemoryPrompt,
  buildContextBlock,
  buildDirectoriesBlock,
  getFormattingInstructions,
  SECURITY_INSTRUCTIONS,
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

// Runtime
export {
  runtime,
  createRuntime,
  type Runtime,
  type RuntimeOptions,
} from "./runtime.js";

// Thread Runner
export {
  agentRunner,
  createAgentRunner,
  runAgent,
  type AgentRunner,
  type AgentRunnerCallbacks,
  type RunAgentOverrides,
} from "./thread-runner.js";

// MCP Servers
export { createMemoryMcpServer } from "./memory.js";
export { createAgentManagementMcpServer, createSelfManagementMcpServer } from "./agent-management.js";
export { createAskAgentMcpServer, type RunAgentFn } from "./ask-agent.js";
export { createFileSendMcpServer, type FileType, type OnFileSendCallback } from "./file-send.js";
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

// Episodic Memory
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
  createEpisodicMcpServer,
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
  createTranscriptionMcpServer,
  type TranscriptionConfig,
  type TranscriptionResult,
  type TranscriptionOptions,
} from "./transcription/index.js";

