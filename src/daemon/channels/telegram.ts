import fs from "fs";
import path from "path";
import { Bot, InlineKeyboard } from "grammy";
import {
  Config,
  loadAgents,
  listThreads,
  createThread,
  loadManifest,
  threadPath,
  TelegramConfigSchema,
  safeParseJsonFile,
  createTriggerMcpServer,
  type TelegramConfig,
} from "#core/index.js";
import { bus } from "../events.js";
import { runThread } from "../runner.js";
import { TELEGRAM_HELP_MESSAGE } from "./telegram-help.js";
import { log } from "../logger.js";

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

function switchAgent(config: TelegramConfig, agentId: string): void {
  config.activeAgentId = agentId;
  config.activeThreadId = undefined;
  const agentDir = path.join(Config.workspaceDir, "agents", agentId);
  resolveThreadId(config, agentDir);
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

function agentKeyboard(agents: Map<string, { id: string; name: string }>, activeId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const a of agents.values()) {
    const label = a.id === activeId ? `✓ ${a.name}` : a.name;
    keyboard.text(label, `agent:${a.id}`).row();
  }
  return keyboard;
}

export function startTelegram() {
  const config = loadTelegramConfig();
  if (!config) {
    log.info("telegram", "channel skipped (no telegram.json)");
    return null;
  }
  if (!config.chatId) {
    log.info("telegram", "channel skipped (chatId not configured)");
    return null;
  }

  const bot = new Bot(config.token);
  log.info("telegram", "channel started");

  let activeAbortController: AbortController | null = null;

  bot.api.setMyCommands([
    { command: "agent", description: "Select an agent" },
    { command: "threads", description: "List conversation threads" },
    { command: "stop", description: "Stop the running agent" },
    { command: "new", description: "Start a fresh conversation thread" },
    { command: "help", description: "Show help message" },
  ]).catch((err) => {
    log.warn("telegram", "failed to register commands:", err);
  });

  bus.on("thread:response", async (payload) => {
    if (payload.channel !== "telegram") return;
    const chatId = Number(config.chatId);

    // Track active context — prepend switch notice when it changes (e.g. trigger firing on a different agent/thread)
    let text = payload.text;
    if (payload.agentId !== config.activeAgentId || payload.threadId !== config.activeThreadId) {
      const agents = loadAgents();
      const agent = agents.get(payload.agentId);
      const name = agent?.name ?? payload.agentId;
      config.activeAgentId = payload.agentId;
      config.activeThreadId = payload.threadId;
      saveTelegramConfig(config);
      log.info("telegram", `context switched to agent=${payload.agentId} thread=${payload.threadId}`);
      text = `_Switched to ${name}_\n\n${text}`;
    }

    bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(() => {
      // Markdown parse failed (unmatched entities) — retry as plain text
      bot.api.sendMessage(chatId, text).catch((err) => {
        log.error("telegram", "failed to deliver thread:response:", err);
      });
    });
  });

  bus.on("thread:error", (payload) => {
    if (payload.channel !== "telegram") return;
    bot.api.sendMessage(Number(config.chatId), "Something went wrong. Check the logs for details.").catch((err) => {
      log.error("telegram", "failed to deliver thread:error:", err);
    });
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const agents = loadAgents();

    if (String(chatId) !== config.chatId) return;

    // Handle /help command
    if (text === "/help" || text === "/start") {
      await ctx.reply(TELEGRAM_HELP_MESSAGE, { parse_mode: "Markdown" });
      return;
    }

    // Handle /stop command
    if (text === "/stop") {
      if (activeAbortController) {
        activeAbortController.abort();
        await ctx.reply("Stopped.");
      } else {
        await ctx.reply("Nothing to stop.");
      }
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

    // Handle /threads command
    if (text === "/threads") {
      const agentDir = path.join(Config.workspaceDir, "agents", config.activeAgentId);
      const threads = listThreads(agentDir)
        .filter((t) => t.manifest.channel === "telegram")
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
        const active = t.id === config.activeThreadId ? "\u2713 " : "";
        keyboard.text(`${active}${title} \u00b7 ${time}`, `thread:${t.id}`).row();
      }
      await ctx.reply("*Threads:*", { parse_mode: "Markdown", reply_markup: keyboard });
      return;
    }

    // Handle /agent command
    if (text.startsWith("/agent")) {
      const parts = text.split(/\s+/);
      const agentName = parts[1];

      if (!agentName) {
        await ctx.reply("*Select an agent:*", {
          parse_mode: "Markdown",
          reply_markup: agentKeyboard(agents, config.activeAgentId),
        });
        return;
      }

      if (!agents.has(agentName)) {
        await ctx.reply(`Unknown agent: ${agentName}`);
        return;
      }

      switchAgent(config, agentName);
      const switched = agents.get(agentName)!;
      await ctx.reply(`Switched to *${switched.name}*`, { parse_mode: "Markdown" });
      return;
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

    const truncated = text.length > 200 ? text.slice(0, 200) + "…" : text;
    log.info("telegram", `[${chatId}] [${agent.id}] ${truncated}`);

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

    // Don't await — let it run in the background so subsequent messages
    // (like /stop) can be processed while the agent is working.
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
      { triggers: createTriggerMcpServer(agentDir, "telegram") },
      undefined,
      abortController,
    ).catch((err) => {
      if (!abortController.signal.aborted) {
        log.error("telegram", `claude error for ${agent.id}:`, (err as Error).message);
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
    if (!chatId || String(chatId) !== config.chatId) return;

    const data = ctx.callbackQuery.data;

    if (data.startsWith("thread:")) {
      const threadId = data.slice("thread:".length);
      const agentDir = path.join(Config.workspaceDir, "agents", config.activeAgentId);
      const filePath = threadPath(agentDir, threadId);
      try {
        const manifest = loadManifest(filePath);
        config.activeThreadId = threadId;
        saveTelegramConfig(config);
        const title = manifest.title || "Untitled";
        await ctx.editMessageText(`Switched to: ${title}`);
      } catch {
        await ctx.answerCallbackQuery({ text: "Thread not found" });
        return;
      }
      await ctx.answerCallbackQuery();
      return;
    }

    if (!data.startsWith("agent:")) return;

    const agentId = data.slice("agent:".length);
    const agents = loadAgents();
    if (!agents.has(agentId)) {
      await ctx.answerCallbackQuery({ text: "Agent not found" });
      return;
    }

    switchAgent(config, agentId);
    const agent = agents.get(agentId)!;

    await ctx.editMessageText(`Switched to *${agent.name}*`, { parse_mode: "Markdown" });
    await ctx.answerCallbackQuery();

    // Greet the user from the new agent
    const agentDir = path.join(Config.workspaceDir, "agents", agentId);
    const threadId = resolveThreadId(config, agentDir);
    const typingInterval = setInterval(() => {
      bot.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);
    bot.api.sendChatAction(chatId, "typing").catch(() => {});
    runThread(agentDir, threadId, "The user just switched to you. Greet them briefly, then in 1-2 sentences help them reorient — recap where you left off, any open questions or pending tasks. If there's no prior context, just say hi and what you can help with. Keep it short.", undefined, {
      triggers: createTriggerMcpServer(agentDir, "telegram"),
    }, undefined, undefined, { model: "haiku", maxTurns: 1 }).catch((err) => {
      log.error("telegram", `greeting failed for ${agentId}:`, (err as Error).message);
    }).finally(() => {
      clearInterval(typingInterval);
    });
  });

  bot.start();

  return {
    bot,
    shutdown() {
      bot.stop();
    },
  };
}
