import fs from "fs";
import path from "path";
import { Bot, InlineKeyboard, InputFile, Keyboard } from "grammy";
import {
  Config,
  agentStore,
  threadStore,
  runAgent,
  createTriggerMcpServer,
  type AgentBotConfig,
} from "#core/index.js";
import { listNotes, getPinnedNotes } from "#notes/index.js";
import { relativeTime } from "./telegram.js";
import { splitMessage, chatGuard } from "./telegram-utils.js";
import { log } from "../logger.js";
import { getPublicUrl } from "../workspace.js";

function resolveThreadId(config: AgentBotConfig, agentId: string): string {
  if (config.activeThreadId) {
    const manifest = threadStore.get(config.activeThreadId);
    if (manifest) return config.activeThreadId;
  }
  const threads = threadStore.list(agentId)
    .filter((t) => !t.taskId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const id = threads.length > 0 ? threads[0]!.id : threadStore.create(agentId);
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
): { bot: Bot; deliveryCallbacks: () => Record<string, unknown>; shutdown: () => void } | null {
  if (!botConfig.chatId) {
    log.warn("telegram-agent", `agent ${agentId}: skipped (no chatId)`);
    return null;
  }

  const agents = agentStore.list();
  const agent = agents.get(agentId);
  if (!agent) {
    log.warn("telegram-agent", `agent ${agentId}: skipped (agent not found)`);
    return null;
  }

  const agentDir = path.join(Config.workspaceDir, "agents", agentId);
  const bot = new Bot(botConfig.token);
  bot.use(chatGuard(botConfig.chatId));
  let activeAbortController: AbortController | null = null;

  log.info("telegram-agent", `agent ${agentId}: started`);

  bot.api.setMyCommands([
    { command: "threads", description: "List conversation threads" },
    { command: "notes", description: "Browse agent notes" },
    { command: "stop", description: "Stop the running agent" },
    { command: "new", description: "Start a fresh conversation thread" },
    { command: "admin", description: "Open admin console" },
    { command: "help", description: "Show help message" },
  ]).catch((err) => {
    log.warn("telegram-agent", `agent ${agentId}: failed to register commands:`, err);
  });

  function buildReplyKeyboard(): Keyboard | null {
    const publicUrl = getPublicUrl();
    if (!publicUrl) return null;
    const keyboard = new Keyboard();
    keyboard.webApp("Tasks", `${publicUrl}/web/tasklist/`).row();
    for (const note of getPinnedNotes(agentDir)) {
      keyboard.webApp(note.title, `${publicUrl}/web/tasklist/#/note/${agentId}/${note.slug}`).row();
    }
    return keyboard.resized().persistent();
  }

  // Delivery helpers — shared across all runAgent call sites
  function deliveryCallbacks() {
    const chatId = Number(botConfig.chatId);
    return {
      async onResponse(_agentId: string, threadId: string, text: string) {
        // Track the thread that last sent a message so user replies go there
        botConfig.activeThreadId = threadId;
        saveConfig();

        const chunks = splitMessage(text);
        for (const chunk of chunks) {
          await bot.api.sendMessage(chatId, chunk, { parse_mode: "Markdown" }).catch(() => {
            return bot.api.sendMessage(chatId, chunk).catch((err) => {
              log.error("telegram-agent", `agent ${agentId}: failed to deliver response:`, err);
            });
          });
        }
      },
      onFileSend(_agentId: string, _threadId: string, filePath: string, caption: string | undefined, fileType: string) {
        try {
          const file = new InputFile(filePath);
          const options = caption ? { caption } : {};

          switch (fileType) {
            case "photo":
              bot.api.sendPhoto(chatId, file, options);
              break;
            case "audio":
              bot.api.sendAudio(chatId, file, options);
              break;
            case "video":
              bot.api.sendVideo(chatId, file, options);
              break;
            case "document":
            default:
              bot.api.sendDocument(chatId, file, options);
              break;
          }

          log.info("telegram-agent", `agent ${agentId}: sent file: ${path.basename(filePath)}`);
        } catch (err) {
          log.error("telegram-agent", `agent ${agentId}: failed to send file ${filePath}:`, (err as Error).message);
          bot.api.sendMessage(chatId, `Failed to send file: ${(err as Error).message}`).catch(() => {});
        }
      },
      onShareNote(_agentId: string, _threadId: string, title: string, slug: string, message: string | undefined) {
        const publicUrl = getPublicUrl();
        if (!publicUrl) return;

        const text = message ?? `\uD83D\uDCDD ${title}`;
        const keyboard = new InlineKeyboard().webApp(
          "Open note",
          `${publicUrl}/web/tasklist/#/note/${agentId}/${slug}`,
        );
        bot.api.sendMessage(chatId, text, { reply_markup: keyboard }).catch((err) => {
          log.error("telegram-agent", `agent ${agentId}: failed to deliver note:`, err);
        });
      },
      onPinChange(_agentId: string) {
        const kb = buildReplyKeyboard();
        if (!kb) return;
        bot.api.sendMessage(chatId, "\uD83D\uDCCC Pinned notes updated", { reply_markup: kb }).catch((err) => {
          log.error("telegram-agent", `agent ${agentId}: failed to send pin update:`, err);
        });
      },
      onNotifyUser(_agentId: string, _threadId: string, message: string) {
        const chunks = splitMessage(message);
        for (const chunk of chunks) {
          bot.api.sendMessage(chatId, chunk, { parse_mode: "Markdown" }).catch(() => {
            return bot.api.sendMessage(chatId, chunk).catch((err) => {
              log.error("telegram-agent", `agent ${agentId}: failed to deliver notification:`, err);
            });
          });
        }
      },
    };
  }

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (text === "/help" || text === "/start") {
      const kb = buildReplyKeyboard();
      await ctx.reply(`This is *${agent.name}*'s dedicated bot.\n\n/threads \u2014 list and switch threads\n/new \u2014 start a fresh thread\n/stop \u2014 stop the running agent\n/admin \u2014 open admin console\n/help \u2014 show this message`, {
        parse_mode: "Markdown",
        ...(kb ? { reply_markup: kb } : {}),
      });
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
      const threads = threadStore.list(agentId)
        .filter((t) => !t.taskId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 10);

      if (threads.length === 0) {
        await ctx.reply("No threads yet.");
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const t of threads) {
        const title = t.title || "Untitled";
        const time = relativeTime(t.updatedAt);
        const active = t.id === botConfig.activeThreadId ? "\u2713 " : "";
        keyboard.text(`${active}${title} \u00b7 ${time}`, `thread:${t.id}`).row();
      }
      await ctx.reply("*Threads:*", { parse_mode: "Markdown", reply_markup: keyboard });
      return;
    }

    if (text === "/admin") {
      const publicUrl = getPublicUrl();
      if (!publicUrl) {
        await ctx.reply("Set your Nova URL: `nova config set settings.url https://your-domain.com`");
        return;
      }
      const url = `${publicUrl}/web/console/`;
      const keyboard = new InlineKeyboard();
      keyboard.url("Open Console", url).row();
      await ctx.reply(`*Admin Console*\n\nManage your agents, skills, triggers, and secrets.`, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
      return;
    }

    if (text === "/notes") {
      const publicUrl = getPublicUrl();
      if (!publicUrl) {
        await ctx.reply("Set your Nova URL: `nova config set settings.url https://your-domain.com`");
        return;
      }
      const notes = listNotes(agentDir);
      if (notes.length === 0) {
        await ctx.reply("No notes yet.");
        return;
      }
      const keyboard = new InlineKeyboard();
      for (const note of notes) {
        keyboard.webApp(
          note.title,
          `${publicUrl}/web/tasklist/#/note/${agentId}/${note.slug}`,
        ).row();
      }
      await ctx.reply("*Notes:*", { parse_mode: "Markdown", reply_markup: keyboard });
      return;
    }

    if (text === "/new") {
      const id = threadStore.create(agentId);
      botConfig.activeThreadId = id;
      saveConfig();
      await ctx.reply("New thread started");
      return;
    }

    const threadId = resolveThreadId(botConfig, agentId);
    saveConfig();

    const truncated = text.length > 200 ? text.slice(0, 200) + "\u2026" : text;
    log.info("telegram-agent", `[${chatId}] [${agentId}] ${truncated}`);

    const abortController = new AbortController();
    activeAbortController = abortController;

    const typingInterval = setInterval(() => {
      bot.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);
    bot.api.sendChatAction(chatId, "typing").catch(() => {});

    let statusMessageId: number | undefined;

    async function updateStatus(status: string) {
      const truncated = status.length > 100 ? status.slice(0, 100) + "\u2026" : status;
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

    runAgent(
      agentDir, threadId, text,
      {
        onThinking() {
          updateStatus("Thinking\u2026");
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
        ...deliveryCallbacks(),
      },
      { triggers: createTriggerMcpServer(agentId) },
      undefined,
      abortController,
      { source: "chat" },
    ).catch((err) => {
      if (!abortController.signal.aborted) {
        log.error("telegram-agent", `agent ${agentId} error:`, (err as Error).message);
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

      const threadId = resolveThreadId(botConfig, agentId);
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

      runAgent(
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
          ...deliveryCallbacks(),
        },
        { triggers: createTriggerMcpServer(agentId) },
        undefined,
        abortController,
        { source: "chat" },
      ).catch((err) => {
        if (!abortController.signal.aborted) {
          log.error("telegram-agent", `agent ${agentId} file handling error:`, (err as Error).message);
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
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("thread:")) return;

    const threadId = data.slice("thread:".length);
    const manifest = threadStore.get(threadId);
    if (!manifest) {
      await ctx.answerCallbackQuery({ text: "Thread not found" });
      return;
    }
    botConfig.activeThreadId = threadId;
    saveConfig();
    const title = manifest.title || "Untitled";
    await ctx.editMessageText(`Switched to: ${title}`);
    await ctx.answerCallbackQuery();
  });

  bot.start();

  return {
    bot,
    deliveryCallbacks,
    shutdown() {
      bot.stop();
    },
  };
}
