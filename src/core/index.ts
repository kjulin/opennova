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
  withThreadLock,
  type ChannelType,
  type ThreadManifest,
  type ThreadMessage,
  type ThreadInfo,
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
  threadRunner,
  createThreadRunner,
  runThread,
  type ThreadRunner,
  type ThreadRunnerCallbacks,
  type RunThreadOverrides,
} from "./thread-runner.js";

// MCP Servers
export { createMemoryMcpServer } from "./memory.js";
export { createAgentManagementMcpServer, createSelfManagementMcpServer } from "./agent-management.js";
export { createAskAgentMcpServer, type RunThreadFn } from "./ask-agent.js";
export {
  appendUsage,
  loadUsageRecords,
  getUsageStats,
  createUsageMcpServer,
  type UsageRecord,
  type UsageStats,
} from "./usage.js";

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
