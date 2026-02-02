import fs from "fs";
import path from "path";
import { Bot } from "grammy";
import { Config } from "../config.js";
import { bus } from "../events.js";
import { loadAgents } from "../agents.js";
import { runThread } from "../runner.js";
import { listThreads, createThread } from "../threads.js";
import { createTriggerMcpServer } from "../triggers.js";
import { TelegramConfigSchema, safeParseJsonFile, type TelegramConfig } from "../schemas.js";
import { TELEGRAM_HELP_MESSAGE } from "./telegram-help.js";

function loadTelegramConfig(): TelegramConfig | null {
  const filePath = path.join(Config.workspaceDir, "telegram.json");
  if (!fs.existsSync(filePath)) return null;
  const raw = safeParseJsonFile(filePath, "telegram.json");
  if (raw === null) return null;
  const result = TelegramConfigSchema.safeParse(raw);
  if (!result.success) {
    console.warn(`[telegram] invalid telegram.json: ${result.error.message}`);
    return null;
  }
  return result.data;
}

function saveTelegramConfig(config: TelegramConfig): void {
  fs.writeFileSync(path.join(Config.workspaceDir, "telegram.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
}

function resolveThreadId(config: TelegramConfig, agentDir: string): string {
  // Use active thread if it still exists on disk
  if (config.activeThreadId) {
    const file = path.join(agentDir, "threads", `${config.activeThreadId}.jsonl`);
    if (fs.existsSync(file)) return config.activeThreadId;
  }
  // Fall back to most recent telegram thread for this agent
  const threads = listThreads(agentDir)
    .filter((t) => t.manifest.channel === "telegram")
    .sort((a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt));
  const id = threads.length > 0 ? threads[0]!.id : createThread(agentDir, "telegram");
  config.activeThreadId = id;
  saveTelegramConfig(config);
  return id;
}

export function startTelegram() {
  const config = loadTelegramConfig();
  if (!config) {
    console.log("telegram channel skipped (no telegram.json)");
    return null;
  }
  if (!config.chatId) {
    console.log("telegram channel skipped (chatId not configured)");
    return null;
  }

  const bot = new Bot(config.token);
  console.log("telegram channel started");

  bus.on("thread:response", (payload) => {
    if (payload.channel !== "telegram") return;
    bot.api.sendMessage(Number(config.chatId), payload.text, { parse_mode: "Markdown" }).catch((err) => {
      console.error("[telegram] failed to deliver thread:response:", err);
    });
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    let text = ctx.message.text;
    const agents = loadAgents();

    if (String(chatId) !== config.chatId) return;

    // Handle /help command
    if (text === "/help" || text === "/start") {
      await ctx.reply(TELEGRAM_HELP_MESSAGE, { parse_mode: "Markdown" });
      return;
    }

    // Handle /new command
    if (text === "/new") {
      const agentDir = path.join(Config.workspaceDir, "agents", config.activeAgentId);
      const id = createThread(agentDir, "telegram");
      config.activeThreadId = id;
      saveTelegramConfig(config);
      await ctx.reply("New thread started");
      return;
    }

    // Handle /agent command
    if (text.startsWith("/agent")) {
      const parts = text.split(/\s+/);
      const agentName = parts[1];

      if (!agentName) {
        const list = [...agents.values()]
          .map((a) => (a.id === config.activeAgentId ? `• *${a.name}* (active)` : `• ${a.name}`))
          .join("\n");
        await ctx.reply(`*Agents:*\n${list}\n\nSwitch with /agent <name>`, { parse_mode: "Markdown" });
        return;
      }

      if (!agents.has(agentName)) {
        await ctx.reply(`Unknown agent: ${agentName}`);
        return;
      }

      config.activeAgentId = agentName;
      delete config.activeThreadId;
      saveTelegramConfig(config);
      const switched = agents.get(agentName)!;
      await ctx.reply(`Switched to *${switched.name}*`, { parse_mode: "Markdown" });

      // Let the new agent greet the user
      text = "greet the user";
    }

    // Resolve active agent
    const agentId = config.activeAgentId;
    const agent = agents.get(agentId);
    if (!agent) {
      await ctx.reply(`Agent "${agentId}" not found. Use /agent to switch.`);
      return;
    }

    const agentDir = path.join(Config.workspaceDir, "agents", agent.id);
    const threadId = resolveThreadId(config, agentDir);

    console.log(`[telegram:${chatId}] [${agent.id}] ${text}`);

    const typingInterval = setInterval(() => {
      bot.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);
    bot.api.sendChatAction(chatId, "typing").catch(() => {});

    let statusMessageId: number | undefined;

    async function updateStatus(status: string) {
      const truncated = status.length > 100 ? status.slice(0, 100) + "…" : status;
      const formatted = `_${truncated}_`;
      if (statusMessageId) {
        await bot.api.editMessageText(chatId, statusMessageId, formatted, { parse_mode: "Markdown" }).catch(() => {});
      } else {
        const sent = await bot.api.sendMessage(chatId, formatted, { parse_mode: "Markdown" }).catch(() => undefined);
        if (sent) statusMessageId = sent.message_id;
      }
    }

    async function deleteStatus() {
      if (statusMessageId) {
        await bot.api.deleteMessage(chatId, statusMessageId).catch(() => {});
        statusMessageId = undefined;
      }
    }

    try {
      await runThread(
        agentDir, threadId, text,
        {
          onAssistantMessage(text) {
            updateStatus(text);
          },
          onToolUse(_toolName, _input, summary) {
            updateStatus(summary);
          },
          onToolUseSummary(summary) {
            updateStatus(summary);
          },
        },
        { triggers: createTriggerMcpServer(agentDir, "telegram") },
      );
    } catch (err) {
      console.error("claude error:", (err as Error).message);
      await ctx.reply(`Error: ${(err as Error).message}`);
    } finally {
      clearInterval(typingInterval);
      await deleteStatus();
    }
  });

  bot.start();

  return {
    bot,
    shutdown() {
      bot.stop();
    },
  };
}
