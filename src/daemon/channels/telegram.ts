import fs from "fs";
import path from "path";
import os from "os";
import { Bot, InlineKeyboard, InputFile, Keyboard } from "grammy";
import {
  Config,
  loadAgents,
  listThreads,
  createThread,
  loadManifest,
  threadPath,
  TelegramConfigSchema,
  safeParseJsonFile,
  transcribe,
  checkTranscriptionDependencies,
  type TelegramConfig,
} from "#core/index.js";
import { bus } from "../events.js";
import { runThread } from "../runner.js";
import { createTriggerMcpServer } from "../triggers.js";
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

function agentKeyboard(agents: Map<string, { id: string; name: string }>, activeId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const a of agents.values()) {
    const label = a.id === activeId ? `✓ ${a.name}` : a.name;
    keyboard.text(label, `agent:${a.id}`).row();
  }
  return keyboard;
}

function getTailscaleHostname(): string | null {
  const certDir = path.join(os.homedir(), ".nova", "certs");
  if (!fs.existsSync(certDir)) return null;
  const certFiles = fs.readdirSync(certDir).filter((f) => f.endsWith(".crt"));
  if (certFiles.length === 0) return null;
  return certFiles[0]!.replace(".crt", "");
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

  const tailscaleHostname = getTailscaleHostname();

  bot.api.setMyCommands([
    { command: "agent", description: "Select an agent" },
    { command: "threads", description: "List conversation threads" },
    { command: "stop", description: "Stop the running agent" },
    { command: "new", description: "Start a fresh conversation thread" },
    { command: "help", description: "Show help message" },
  ]).catch((err) => {
    log.warn("telegram", "failed to register commands:", err);
  });

  // Reset menu button to commands (in case it was previously set to web_app)
  bot.api.setChatMenuButton({
    chat_id: Number(config.chatId),
    menu_button: { type: "commands" },
  }).catch((err) => {
    log.warn("telegram", "failed to set menu button:", err);
  });

  // Create persistent reply keyboard with Tasks button if Tailscale is configured
  const replyKeyboard = tailscaleHostname
    ? new Keyboard()
        .webApp("Tasks", `https://${tailscaleHostname}:3838`)
        .resized()
        .persistent()
    : null;

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

  bus.on("thread:file", async (payload) => {
    if (payload.channel !== "telegram") return;
    const chatId = Number(config.chatId);

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

      log.info("telegram", `sent file: ${path.basename(payload.filePath)}`);
    } catch (err) {
      log.error("telegram", `failed to send file ${payload.filePath}:`, (err as Error).message);
      bot.api.sendMessage(chatId, `Failed to send file: ${(err as Error).message}`).catch(() => {});
    }
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    const agents = loadAgents();

    if (String(chatId) !== config.chatId) return;

    // Handle /help command
    if (text === "/help" || text === "/start") {
      if (replyKeyboard) {
        await ctx.reply(TELEGRAM_HELP_MESSAGE, {
          parse_mode: "Markdown",
          reply_markup: replyKeyboard,
        });
      } else {
        await ctx.reply(TELEGRAM_HELP_MESSAGE, { parse_mode: "Markdown" });
      }
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

  // Voice message handler
  bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat.id;
    if (String(chatId) !== config.chatId) return;

    const agents = loadAgents();
    const agentId = config.activeAgentId;
    const agent = agents.get(agentId);
    if (!agent) {
      await ctx.reply(`Agent "${agentId}" not found. Use /agent to switch.`);
      return;
    }

    const voice = ctx.message.voice;
    const duration = voice.duration;

    log.info("telegram", `[${chatId}] [${agent.id}] voice message (${duration}s)`);

    // Check transcription dependencies
    const deps = await checkTranscriptionDependencies();
    if (!deps.ffmpeg || !deps.whisper || !deps.model) {
      const missing = [];
      if (!deps.ffmpeg) missing.push("ffmpeg");
      if (!deps.whisper) missing.push("whisper-cpp");
      if (!deps.model) missing.push(`model at ${deps.modelPath}`);
      await ctx.reply(`❌ Transcription not available. Missing: ${missing.join(", ")}\n\nRun \`nova transcription setup\` to configure.`);
      return;
    }

    const statusMsg = await ctx.reply("🎙️ Transcribing...");

    try {
      // Download voice file
      const file = await bot.api.getFile(voice.file_id);
      if (!file.file_path) throw new Error("Failed to get file path");

      const url = `https://api.telegram.org/file/bot${config.token}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      const tempPath = path.join(os.tmpdir(), `nova-voice-${Date.now()}.ogg`);
      fs.writeFileSync(tempPath, buffer);

      // Transcribe
      const result = await transcribe(tempPath);

      // Save to file
      const agentDir = path.join(Config.workspaceDir, "agents", agent.id);
      const voiceDir = path.join(agentDir, "voice");
      fs.mkdirSync(voiceDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const mdPath = path.join(voiceDir, `${timestamp}.md`);
      const mdContent = `# Voice Memo - ${new Date().toLocaleString()}

Duration: ${duration}s
Language: ${result.language}

---

${result.text}
`;
      fs.writeFileSync(mdPath, mdContent);

      // Update status
      await bot.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `🎙️ Transcribed (${duration}s)`
      );

      // Cleanup temp file
      try { fs.unlinkSync(tempPath); } catch {}

      // Invoke agent
      const threadId = resolveThreadId(config, agentDir);
      const prompt = `I just sent you a voice memo (${duration}s). The transcript is saved at:
${mdPath}

Please read it and respond to what I said.`;

      const abortController = new AbortController();
      activeAbortController = abortController;

      const typingInterval = setInterval(() => {
        bot.api.sendChatAction(chatId, "typing").catch(() => {});
      }, 4000);
      bot.api.sendChatAction(chatId, "typing").catch(() => {});

      runThread(
        agentDir, threadId, prompt,
        {
          onThinking() {
            // Status already shown
          },
          onAssistantMessage(text) {
            bot.api.sendChatAction(chatId, "typing").catch(() => {});
          },
          onToolUse(_toolName, _input, summary) {
            bot.api.sendChatAction(chatId, "typing").catch(() => {});
          },
          onToolUseSummary(summary) {
            bot.api.sendChatAction(chatId, "typing").catch(() => {});
          },
        },
        { triggers: createTriggerMcpServer(agentDir, "telegram") },
        undefined,
        abortController,
      ).catch((err) => {
        if (!abortController.signal.aborted) {
          log.error("telegram", `voice message error for ${agent.id}:`, (err as Error).message);
          bot.api.sendMessage(chatId, "Something went wrong processing the voice message.").catch(() => {});
        }
      }).finally(() => {
        if (activeAbortController === abortController) activeAbortController = null;
        clearInterval(typingInterval);
      });

    } catch (err) {
      log.error("telegram", `transcription failed:`, (err as Error).message);
      await bot.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `❌ Transcription failed: ${(err as Error).message}`
      );
    }
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
    if (!config || String(chatId) !== config.chatId) return;

    const agents = loadAgents();
    const agentId = config.activeAgentId;
    const agent = agents.get(agentId);
    if (!agent) {
      await ctx.reply(`Agent "${agentId}" not found. Use /agent to switch.`);
      return;
    }

    // Telegram bot API download limit is 20MB
    if (fileSize && fileSize > 20 * 1024 * 1024) {
      await ctx.reply(`File too large (${formatFileSize(fileSize)}). Maximum: 20MB`);
      return;
    }

    log.info("telegram", `[${chatId}] [${agent.id}] ${fileType}: ${fileName}`);

    const statusMsg = await ctx.reply(`Receiving ${fileType}...`);
    const agentDir = path.join(Config.workspaceDir, "agents", agent.id);

    try {
      const filePath = await downloadTelegramFile(bot, config.token, fileId, agentDir, fileName);

      await bot.api.editMessageText(chatId, (statusMsg as { message_id: number }).message_id, `Received: ${fileName}`);

      const threadId = resolveThreadId(config, agentDir);
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
        { triggers: createTriggerMcpServer(agentDir, "telegram") },
        undefined,
        abortController,
      ).catch((err) => {
        if (!abortController.signal.aborted) {
          log.error("telegram", `file handling error for ${agent.id}:`, (err as Error).message);
          bot.api.sendMessage(chatId, "Something went wrong processing the file.").catch(() => {});
        }
      }).finally(() => {
        if (activeAbortController === abortController) activeAbortController = null;
        clearInterval(typingInterval);
      });

    } catch (err) {
      log.error("telegram", `file download failed:`, (err as Error).message);
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
