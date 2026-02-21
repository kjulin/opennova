import fs from "fs";
import { z } from "zod/v4";
import { log } from "./logger.js";

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
  channel: z.string(),
  cron: z.string(),
  tz: z.string().optional(),
  prompt: z.string(),
  enabled: z.boolean(),
  lastRun: z.string().nullable().optional(),
});

export type Trigger = z.infer<typeof TriggerSchema>;

export const ThreadManifestSchema = z.object({
  title: z.string().optional(),
  channel: z.string(),
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

export const TrustLevel = z.enum(["sandbox", "default", "unrestricted"]);
export type TrustLevel = z.infer<typeof TrustLevel>;

export const SettingsSchema = z.object({
  defaultTrust: TrustLevel,
}).passthrough();

export type Settings = z.infer<typeof SettingsSchema>;

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
