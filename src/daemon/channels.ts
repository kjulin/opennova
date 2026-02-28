import fs from "fs";
import path from "path";
import { startTelegram } from "./channels/telegram.js";
import { startAgentTelegram } from "./channels/telegram-agent.js";
import { TelegramConfigSchema, safeParseJsonFile, Config } from "#core/index.js";
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

/** Get delivery callbacks for an agent (e.g. Telegram message sending). */
export function getDeliveryCallbacks(agentId: string): Partial<AgentRunnerCallbacks> | undefined {
  const factory = deliveryCallbackMap.get(agentId);
  return factory?.();
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

  // Global Telegram bot
  const telegram = startTelegram();
  if (telegram) {
    channels.push({ name: "Telegram", detail: "polling" });
    shutdowns.push(telegram.shutdown);
  }

  // Per-agent Telegram bots
  const configPath = path.join(Config.workspaceDir, "telegram.json");
  if (fs.existsSync(configPath)) {
    const raw = safeParseJsonFile(configPath, "telegram.json");
    if (raw) {
      const result = TelegramConfigSchema.safeParse(raw);
      if (result.success && result.data.agentBots) {
        const config = result.data;

        function saveConfig() {
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
        }

        for (const [agentId, botConfig] of Object.entries(config.agentBots!)) {
          const agentBot = startAgentTelegram(agentId, botConfig, saveConfig);
          if (agentBot) {
            channels.push({ name: `Telegram (${agentId})`, detail: "polling" });
            shutdowns.push(agentBot.shutdown);
            deliveryCallbackMap.set(agentId, agentBot.deliveryCallbacks);
          }
        }
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
