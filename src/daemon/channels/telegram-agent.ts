import fs from "fs";
import path from "path";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import {
  Config,
  loadAgents,
  listThreads,
  createThread,
  loadManifest,
  threadPath,
  type AgentBotConfig,
} from "#core/index.js";
import { bus } from "../events.js";
import { runThread } from "../runner.js";
import { createTriggerMcpServer } from "../triggers.js";
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function downloadTelegramFile(
  bot: Bot,
  token: string,
  fileId: string,
  agentDir: string,
  originalName: string,
): Promise<string> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error("Failed to get file path");

  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

  const buffer = Buffer.from(await response.arrayBuffer());

  const inboxDir = path.join(agentDir, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(inboxDir, `${timestamp}-${safeName}`);

  fs.writeFileSync(filePath, buffer);
  return filePath;
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

  bus.on("thread:file", async (payload) => {
    if (payload.channel !== channel) return;
    const chatId = Number(botConfig.chatId);

    try {
      const file = new InputFile(payload.filePath);
      const options = payload.caption ? { caption: payload.caption } : {};

      switch (payload.fileType) {
        case "photo":
          await bot.api.sendPhoto(chatId, file, options);
          break;
        case "audio":
          await bot.api.sendAudio(chatId, file, options);
          break;
        case "video":
          await bot.api.sendVideo(chatId, file, options);
          break;
        case "document":
        default:
          await bot.api.sendDocument(chatId, file, options);
          break;
      }

      log.info("telegram-agent", `agent ${agentId}: sent file: ${path.basename(payload.filePath)}`);
    } catch (err) {
      log.error("telegram-agent", `agent ${agentId}: failed to send file ${payload.filePath}:`, (err as Error).message);
      bot.api.sendMessage(chatId, `Failed to send file: ${(err as Error).message}`).catch(() => {});
    }
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
        onThinking() {
          updateStatus("Thinking…");
        },
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

  // Generic file handler for documents, photos, audio, video
  async function handleIncomingFile(
    ctx: { chat: { id: number }; reply: (text: string) => Promise<unknown> },
    fileId: string,
    fileName: string,
    fileSize: number | undefined,
    mimeType: string | undefined,
    fileType: string,
  ) {
    const chatId = ctx.chat.id;
    if (String(chatId) !== botConfig.chatId) return;

    // Telegram bot API download limit is 20MB
    if (fileSize && fileSize > 20 * 1024 * 1024) {
      await ctx.reply(`File too large (${formatFileSize(fileSize)}). Maximum: 20MB`);
      return;
    }

    log.info("telegram-agent", `[${chatId}] [${agentId}] ${fileType}: ${fileName}`);

    const statusMsg = await ctx.reply(`Receiving ${fileType}...`);

    try {
      const filePath = await downloadTelegramFile(bot, botConfig.token, fileId, agentDir, fileName);

      await bot.api.editMessageText(chatId, (statusMsg as { message_id: number }).message_id, `Received: ${fileName}`);

      const threadId = resolveThreadId(botConfig, agentDir, channel);
      saveConfig();

      const prompt = `The user sent you a file:
- Name: ${fileName}
- Type: ${mimeType || "unknown"}
- Size: ${fileSize ? formatFileSize(fileSize) : "unknown"}
- Saved at: ${filePath}

You can read, process, or move this file as needed.`;

      const abortController = new AbortController();
      activeAbortController = abortController;

      const typingInterval = setInterval(() => {
        bot.api.sendChatAction(chatId, "typing").catch(() => {});
      }, 4000);
      bot.api.sendChatAction(chatId, "typing").catch(() => {});

      runThread(
        agentDir, threadId, prompt,
        {
          onThinking() {},
          onAssistantMessage() {
            bot.api.sendChatAction(chatId, "typing").catch(() => {});
          },
          onToolUse() {
            bot.api.sendChatAction(chatId, "typing").catch(() => {});
          },
          onToolUseSummary() {
            bot.api.sendChatAction(chatId, "typing").catch(() => {});
          },
        },
        { triggers: createTriggerMcpServer(agentDir, channel) },
        undefined,
        abortController,
      ).catch((err) => {
        if (!abortController.signal.aborted) {
          log.error("telegram-agent", `agent ${agentId} file handling error:`, (err as Error).message);
          bot.api.sendMessage(chatId, "Something went wrong processing the file.").catch(() => {});
        }
      }).finally(() => {
        if (activeAbortController === abortController) activeAbortController = null;
        clearInterval(typingInterval);
      });

    } catch (err) {
      log.error("telegram-agent", `agent ${agentId} file download failed:`, (err as Error).message);
      await bot.api.editMessageText(
        chatId,
        (statusMsg as { message_id: number }).message_id,
        `Failed to receive file: ${(err as Error).message}`
      );
    }
  }

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    await handleIncomingFile(ctx, doc.file_id, doc.file_name || "document", doc.file_size, doc.mime_type, "document");
  });

  bot.on("message:photo", async (ctx) => {
    // Telegram sends multiple sizes, get the largest
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1]!;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await handleIncomingFile(ctx, largest.file_id, `photo-${timestamp}.jpg`, largest.file_size, "image/jpeg", "photo");
  });

  bot.on("message:audio", async (ctx) => {
    const audio = ctx.message.audio;
    const name = audio.file_name || audio.title || `audio-${Date.now()}.mp3`;
    await handleIncomingFile(ctx, audio.file_id, name, audio.file_size, audio.mime_type, "audio");
  });

  bot.on("message:video", async (ctx) => {
    const video = ctx.message.video;
    const name = video.file_name || `video-${Date.now()}.mp4`;
    await handleIncomingFile(ctx, video.file_id, name, video.file_size, video.mime_type, "video");
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
