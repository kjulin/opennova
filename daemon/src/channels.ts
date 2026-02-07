import fs from "fs";
import path from "path";
import { startTelegram } from "./channels/telegram.js";
import { startAgentTelegram } from "./channels/telegram-agent.js";
import { TelegramConfigSchema, safeParseJsonFile, Config } from "@opennova/core";
import { log } from "./logger.js";

export interface ChannelInfo {
  name: string;
  detail: string;
}

export interface LoadChannelsResult {
  channels: ChannelInfo[];
  shutdown: () => void;
}

export function loadChannels(): LoadChannelsResult {
  const channels: ChannelInfo[] = [];
  const shutdowns: (() => void)[] = [];

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
          }
        }
      }
    }
  }

  return {
    channels,
    shutdown() {
      for (const fn of shutdowns) {
        try { fn(); } catch (err) {
          log.error("channels", "shutdown error:", err);
        }
      }
    },
  };
}
