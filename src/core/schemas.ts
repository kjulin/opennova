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

export const ThreadManifestSchema = z.object({
  title: z.string().optional(),
  channel: z.string(),
  sessionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

export const ThreadMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  timestamp: z.string(),
});

export const SecurityLevel = z.enum(["sandbox", "standard", "unrestricted"]);
export type SecurityLevel = z.infer<typeof SecurityLevel>;

export const SettingsSchema = z.object({
  defaultSecurity: SecurityLevel,
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
