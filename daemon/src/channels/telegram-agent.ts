import fs from "fs";
import path from "path";
import { Bot, InlineKeyboard } from "grammy";
import { Config } from "../config.js";
import { bus } from "../events.js";
import { loadAgents } from "../agents.js";
import { runThread } from "../runner.js";
import { listThreads, createThread, loadManifest, threadPath } from "../threads.js";
import { createTriggerMcpServer } from "../triggers.js";
import type { AgentBotConfig } from "../schemas.js";
import { relativeTime } from "./telegram.js";
import { log } from "../logger.js";

function resolveThreadId(config: AgentBotConfig, agentDir: string, channel: string): string {
  if (config.activeThreadId) {
    const file = path.join(agentDir, "threads", `${config.activeThreadId}.jsonl`);
    if (fs.existsSync(file)) return config.activeThreadId;
  }
  const threads = listThreads(agentDir)
    .filter((t) => t.manifest.channel === channel)
    .sort((a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt));
  const id = threads.length > 0 ? threads[0]!.id : createThread(agentDir, channel);
  config.activeThreadId = id;
  return id;
}

export function startAgentTelegram(
  agentId: string,
  botConfig: AgentBotConfig,
  saveConfig: () => void,
): { bot: Bot; shutdown: () => void } | null {
  if (!botConfig.chatId) {
    log.warn("telegram-agent", `agent ${agentId}: skipped (no chatId)`);
    return null;
  }

  const agents = loadAgents();
  const agent = agents.get(agentId);
  if (!agent) {
    log.warn("telegram-agent", `agent ${agentId}: skipped (agent not found)`);
    return null;
  }

  const channel = `telegram:${agentId}`;
  const agentDir = path.join(Config.workspaceDir, "agents", agentId);
  const bot = new Bot(botConfig.token);
  let activeAbortController: AbortController | null = null;

  log.info("telegram-agent", `agent ${agentId}: started`);

  bot.api.setMyCommands([
    { command: "threads", description: "List conversation threads" },
    { command: "stop", description: "Stop the running agent" },
    { command: "new", description: "Start a fresh conversation thread" },
    { command: "help", description: "Show help message" },
  ]).catch((err) => {
    log.warn("telegram-agent", `agent ${agentId}: failed to register commands:`, err);
  });

  bus.on("thread:response", async (payload) => {
    if (payload.channel !== channel) return;
    const chatId = Number(botConfig.chatId);

    bot.api.sendMessage(chatId, payload.text, { parse_mode: "Markdown" }).catch(() => {
      bot.api.sendMessage(chatId, payload.text).catch((err) => {
        log.error("telegram-agent", `agent ${agentId}: failed to deliver response:`, err);
      });
    });
  });

  bus.on("thread:error", (payload) => {
    if (payload.channel !== channel) return;
    bot.api.sendMessage(Number(botConfig.chatId), "Something went wrong. Check the logs for details.").catch((err) => {
      log.error("telegram-agent", `agent ${agentId}: failed to deliver error:`, err);
    });
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (String(chatId) !== botConfig.chatId) return;

    if (text === "/help" || text === "/start") {
      await ctx.reply(`This is *${agent.name}*'s dedicated bot.\n\n/threads — list and switch threads\n/new — start a fresh thread\n/stop — stop the running agent\n/help — show this message`, { parse_mode: "Markdown" });
      return;
    }

    if (text === "/stop") {
      if (activeAbortController) {
        activeAbortController.abort();
        await ctx.reply("Stopped.");
      } else {
        await ctx.reply("Nothing to stop.");
      }
      return;
    }

    if (text === "/threads") {
      const threads = listThreads(agentDir)
        .filter((t) => t.manifest.channel === channel)
        .sort((a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt))
        .slice(0, 10);

      if (threads.length === 0) {
        await ctx.reply("No threads yet.");
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const t of threads) {
        const title = t.manifest.title || "Untitled";
        const time = relativeTime(t.manifest.updatedAt);
        const active = t.id === botConfig.activeThreadId ? "\u2713 " : "";
        keyboard.text(`${active}${title} \u00b7 ${time}`, `thread:${t.id}`).row();
      }
      await ctx.reply("*Threads:*", { parse_mode: "Markdown", reply_markup: keyboard });
      return;
    }

    if (text === "/new") {
      const id = createThread(agentDir, channel);
      botConfig.activeThreadId = id;
      saveConfig();
      await ctx.reply("New thread started");
      return;
    }

    const threadId = resolveThreadId(botConfig, agentDir, channel);
    saveConfig();

    const truncated = text.length > 200 ? text.slice(0, 200) + "…" : text;
    log.info("telegram-agent", `[${chatId}] [${agentId}] ${truncated}`);

    const abortController = new AbortController();
    activeAbortController = abortController;

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

    runThread(
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
      { triggers: createTriggerMcpServer(agentDir, channel) },
      undefined,
      abortController,
    ).catch((err) => {
      if (!abortController.signal.aborted) {
        log.error("telegram-agent", `agent ${agentId} error:`, (err as Error).message);
        bot.api.sendMessage(chatId, "Something went wrong. Check the logs for details.").catch(() => {});
      }
    }).finally(() => {
      if (activeAbortController === abortController) activeAbortController = null;
      clearInterval(typingInterval);
      deleteStatus();
    });
  });

  bot.on("callback_query:data", async (ctx) => {
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!chatId || String(chatId) !== botConfig.chatId) return;

    const data = ctx.callbackQuery.data;
    if (!data.startsWith("thread:")) return;

    const threadId = data.slice("thread:".length);
    const filePath = threadPath(agentDir, threadId);
    try {
      const manifest = loadManifest(filePath);
      botConfig.activeThreadId = threadId;
      saveConfig();
      const title = manifest.title || "Untitled";
      await ctx.editMessageText(`Switched to: ${title}`);
    } catch {
      await ctx.answerCallbackQuery({ text: "Thread not found" });
      return;
    }
    await ctx.answerCallbackQuery();
  });

  bot.start();

  return {
    bot,
    shutdown() {
      bot.stop();
    },
  };
}
