import fs from "fs";
import { z } from "zod/v4";
import { log } from "./logger.js";
import { MODELS } from "./models.js";

export const AgentBotConfigSchema = z.object({
  token: z.string(),
  chatId: z.string(),
  activeThreadId: z.string().optional(),
});

export type AgentBotConfig = z.infer<typeof AgentBotConfigSchema>;

export const TelegramConfigSchema = z.object({
  token: z.string(),
  chatId: z.string(),
  activeAgentId: z.string(),
  activeThreadId: z.string().optional(),
  agentBots: z.record(z.string(), AgentBotConfigSchema).optional(),
}).passthrough();

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export const TriggerSchema = z.object({
  id: z.string(),
  cron: z.string(),
  tz: z.string().optional(),
  prompt: z.string(),
  lastRun: z.string().nullable().optional(),
}).passthrough();

export type Trigger = z.infer<typeof TriggerSchema>;

export const ThreadManifestSchema = z.object({
  title: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

export const ThreadMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  timestamp: z.string(),
});

export const ThreadMessageEventSchema = z.object({
  type: z.literal("message"),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  timestamp: z.string(),
});

export const ThreadToolUseEventSchema = z.object({
  type: z.literal("tool_use"),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});

export const ThreadAssistantTextEventSchema = z.object({
  type: z.literal("assistant_text"),
  text: z.string(),
  timestamp: z.string(),
});

export const ThreadResultEventSchema = z.object({
  type: z.literal("result"),
  cost: z.number().optional(),
  durationMs: z.number().optional(),
  turns: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  timestamp: z.string(),
});

export const ThreadEventSchema = z.union([
  ThreadMessageEventSchema,
  ThreadToolUseEventSchema,
  ThreadAssistantTextEventSchema,
  ThreadResultEventSchema,
]);

export const TrustLevel = z.enum(["sandbox", "controlled", "unrestricted"]);
export type TrustLevel = z.infer<typeof TrustLevel>;

// Agent JSON schema and constants
export const VALID_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_IDENTITY_LENGTH = 4000;
export const MAX_INSTRUCTIONS_LENGTH = 8000;
export const MAX_DESCRIPTION_LENGTH = 500;

export const ResponsibilitySchema = z.object({
  title: z.string().min(1, "title is required"),
  content: z.string().min(1, "content is required"),
});
export type Responsibility = z.infer<typeof ResponsibilitySchema>;

export const AgentJsonSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  identity: z.string().max(MAX_IDENTITY_LENGTH).optional(),
  instructions: z.string().max(MAX_INSTRUCTIONS_LENGTH).optional(),
  responsibilities: z.array(ResponsibilitySchema).optional(),
  directories: z.array(z.string()).optional(),
  trust: TrustLevel.optional(),
  subagents: z.record(z.string(), z.object({
    description: z.string(),
    prompt: z.string(),
    tools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    model: z.enum(MODELS).optional(),
    maxTurns: z.number().int().positive().optional(),
  })).optional(),
  capabilities: z.array(z.string()).optional(),
  model: z.enum(MODELS).optional(),
}).passthrough();

export type AgentJson = z.infer<typeof AgentJsonSchema>;
export type AgentConfig = AgentJson & { id: string; trust: TrustLevel };

/**
 * Safely parse JSON from a file, returning null on failure.
 */
export function safeParseJsonFile(filePath: string, label: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    log.warn("config", `failed to parse ${label} (${filePath}): ${(err as Error).message}`);
    return null;
  }
}
