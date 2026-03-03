import fs from "fs";
import path from "path";
import { startTelegram } from "./channels/telegram.js";
import { startAgentTelegram } from "./channels/telegram-agent.js";
import { TelegramConfigSchema, safeParseJsonFile, Config, type TelegramConfig } from "#core/index.js";
import type { AgentRunnerCallbacks } from "#core/agent-runner.js";
import { log } from "./logger.js";

export interface ChannelInfo {
  name: string;
  detail: string;
}

export interface LoadChannelsResult {
  channels: ChannelInfo[];
  shutdown: () => void;
}

let currentShutdown: (() => void) | null = null;
const deliveryCallbackMap = new Map<string, () => Partial<AgentRunnerCallbacks>>();
const taskDeliveryCallbackMap = new Map<string, () => Partial<AgentRunnerCallbacks>>();

/** Get delivery callbacks for an agent (e.g. Telegram message sending). */
export function getDeliveryCallbacks(agentId: string): Partial<AgentRunnerCallbacks> | undefined {
  const factory = deliveryCallbackMap.get(agentId);
  return factory?.();
}

/** Register task-specific delivery callbacks (e.g. taskgroup topic routing). */
export function registerTaskDeliveryCallbacks(taskId: string, factory: () => Partial<AgentRunnerCallbacks>): void {
  taskDeliveryCallbackMap.set(taskId, factory);
}

/** Get task-specific delivery callbacks. */
export function getTaskDeliveryCallbacks(taskId: string): Partial<AgentRunnerCallbacks> | undefined {
  const factory = taskDeliveryCallbackMap.get(taskId);
  return factory?.();
}

/** Unregister task-specific delivery callbacks. */
export function unregisterTaskDeliveryCallbacks(taskId: string): void {
  taskDeliveryCallbackMap.delete(taskId);
}

function loadTelegramConfig(): TelegramConfig | null {
  const filePath = path.join(Config.workspaceDir, "telegram.json");
  if (!fs.existsSync(filePath)) return null;
  const raw = safeParseJsonFile(filePath, "telegram.json");
  if (raw === null) return null;
  const result = TelegramConfigSchema.safeParse(raw);
  if (!result.success) {
    log.warn("telegram", `invalid telegram.json: ${result.error.message}`);
    return null;
  }
  return result.data;
}

function saveTelegramConfig(config: TelegramConfig): void {
  fs.writeFileSync(
    path.join(Config.workspaceDir, "telegram.json"),
    JSON.stringify(config, null, 2),
    { mode: 0o600 },
  );
}

export function reloadChannels(): void {
  if (currentShutdown) {
    log.info("channels", "shutting down channels for reload");
    try { currentShutdown(); } catch (err) {
      log.error("channels", "shutdown error during reload:", err);
    }
    currentShutdown = null;
  }

  log.info("channels", "reloading channels");
  const result = loadChannels();
  for (const ch of result.channels) {
    log.info("channels", `channel: ${ch.name} (${ch.detail})`);
  }
}

export function getCurrentShutdown(): (() => void) | null {
  return currentShutdown;
}

export function loadChannels(): LoadChannelsResult {
  const channels: ChannelInfo[] = [];
  const shutdowns: (() => void)[] = [];

  // Clear previous delivery callbacks on reload
  deliveryCallbackMap.clear();
  taskDeliveryCallbackMap.clear();

  // Load config once — shared across main bot and agent bots
  const config = loadTelegramConfig();
  if (!config) {
    log.info("channels", "telegram skipped (no telegram.json)");
    return { channels, shutdown: () => {} };
  }

  if (!config.chatId) {
    log.info("channels", "telegram skipped (chatId not configured)");
    return { channels, shutdown: () => {} };
  }

  const saveConfig = () => saveTelegramConfig(config);

  // Global Telegram bot
  const telegram = startTelegram(config, saveConfig);
  channels.push({ name: "Telegram", detail: "polling" });
  shutdowns.push(telegram.shutdown);

  // Per-agent Telegram bots (share same config object for groups visibility)
  if (config.agentBots) {
    for (const [agentId, botConfig] of Object.entries(config.agentBots)) {
      const agentBot = startAgentTelegram(agentId, botConfig, saveConfig, config);
      if (agentBot) {
        channels.push({ name: `Telegram (${agentId})`, detail: "polling" });
        shutdowns.push(agentBot.shutdown);
        deliveryCallbackMap.set(agentId, agentBot.deliveryCallbacks);
      }
    }
  }

  const shutdown = () => {
    for (const fn of shutdowns) {
      try { fn(); } catch (err) {
        log.error("channels", "shutdown error:", err);
      }
    }
  };

  currentShutdown = shutdown;

  return { channels, shutdown };
}
