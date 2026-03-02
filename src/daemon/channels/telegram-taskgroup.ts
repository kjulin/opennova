/**
 * Taskgroup pairing — connects a Telegram supergroup as a task board.
 *
 * Phase 1: pairing only. No topic creation or message routing.
 *
 * When the bot receives a message from an unknown supergroup with
 * forum topics enabled and can_manage_topics permission, it offers
 * to pair via inline keyboard. The user confirms or declines.
 */

import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { Context, NextFunction } from "grammy";
import {
  Config,
  agentStore,
  threadStore,
  runAgent,
  createTriggerMcpServer,
  type TelegramConfig,
} from "#core/index.js";
import { getTask } from "#tasks/index.js";
import { taskBus, type TaskEventPayload } from "#tasks/events.js";
import { registerTaskDeliveryCallbacks, unregisterTaskDeliveryCallbacks } from "../channels.js";
import { splitMessage, toTelegramMarkdown } from "./telegram-utils.js";
import { log } from "../logger.js";
import path from "path";

let generalAbortController: AbortController | null = null;

/**
 * Creates middleware that handles taskgroup pairing.
 * Must be registered BEFORE chatGuard — messages from unknown groups
 * need processing, not silent dropping.
 */
export function taskgroupMiddleware(
  bot: Bot,
  config: TelegramConfig,
  saveConfig: () => void,
) {
  return async (ctx: Context, next: NextFunction) => {
    const chat = ctx.chat;
    if (!chat) return next();

    const chatIdStr = String(chat.id);

    // Only intercept non-private-chat messages
    if (chatIdStr === config.chatId) return next();

    // Handle taskgroup pairing callback queries
    if (ctx.callbackQuery?.data?.startsWith("taskgroup:")) {
      await handleTaskgroupCallback(ctx, config, saveConfig);
      return;
    }

    // Only handle actual messages (not other update types)
    if (!ctx.message) return next();

    const handled = await handleTaskgroupMessage(ctx, bot, config, saveConfig);
    if (!handled) return next();
  };
}

/** Returns true if the message was handled, false if it should pass through. */
async function handleTaskgroupMessage(
  ctx: Context,
  bot: Bot,
  config: TelegramConfig,
  saveConfig: () => void,
): Promise<boolean> {
  const chat = ctx.chat!;
  const chatIdStr = String(chat.id);

  // Already paired to this group — handle all messages
  if (config.taskgroup?.chatId === chatIdStr) {
    const topicId = ctx.message?.message_thread_id;

    // Handle /disconnect in General topic
    if (ctx.message?.text === "/disconnect" && !topicId) {
      config.taskgroup = undefined;
      saveConfig();
      await ctx.reply("Disconnected. Task topics will stay visible but I'll stop updating them.");
      log.info("telegram", `taskgroup disconnected: ${chatIdStr}`);
      return true;
    }

    // Handle user replies in task topics
    if (topicId && ctx.message?.text) {
      await handleTopicReply(ctx, bot, config, topicId);
      return true;
    }

    // General topic text → main agent
    if (!topicId && ctx.message?.text) {
      await handleGeneralTopicMessage(ctx, bot, config, saveConfig);
    }
    return true;
  }

  // Not a taskgroup candidate — pass through to other middleware
  if (config.ignoredGroups?.includes(chatIdStr)) return false;
  if (config.taskgroup?.chatId) return false; // already paired to a different group
  if (chat.type !== "supergroup") return false;
  if (!(chat as any).is_forum) return false;

  // Check bot permissions for taskgroup pairing
  try {
    const me = await bot.api.getMe();
    const member = await bot.api.getChatMember(chat.id, me.id);
    if (member.status !== "administrator" || !(member as any).can_manage_topics) {
      await ctx.reply("I need the 'Manage Topics' admin permission to create task topics.");
      return true;
    }
  } catch (err) {
    log.warn("telegram", `failed to check bot permissions in ${chatIdStr}:`, (err as Error).message);
    await ctx.reply("I need the 'Manage Topics' admin permission to create task topics.");
    return true;
  }

  // All checks pass — show pairing prompt
  const keyboard = new InlineKeyboard()
    .text("Yes, connect", `taskgroup:connect:${chatIdStr}`)
    .text("No thanks", `taskgroup:ignore:${chatIdStr}`);

  await ctx.reply(
    "Use this group as your task board?\nTask topics will be created here automatically.",
    { reply_markup: keyboard },
  );
  return true;
}

async function handleGeneralTopicMessage(
  ctx: Context,
  bot: Bot,
  config: TelegramConfig,
  saveConfig: () => void,
) {
  const text = ctx.message!.text!;
  const chatId = Number(config.taskgroup!.chatId);

  // /stop — abort running agent
  if (text === "/stop") {
    if (generalAbortController) {
      generalAbortController.abort();
      generalAbortController = null;
      await ctx.reply("Stopped.");
    } else {
      await ctx.reply("Nothing running.");
    }
    return;
  }

  // /new — create fresh thread
  if (text === "/new") {
    const agents = agentStore.list();
    const agent = agents.get("nova");
    if (!agent) {
      await ctx.reply("Nova agent not available.");
      return;
    }
    const agentDir = path.join(Config.workspaceDir, "agents", agent.id);
    config.taskgroup!.generalThreadId = threadStore.create(agent.id);
    saveConfig();
    await ctx.reply("New conversation started.");
    return;
  }

  // Route to nova agent
  const agents = agentStore.list();
  const agent = agents.get("nova");
  if (!agent) {
    await ctx.reply("Nova agent not available.");
    return;
  }

  const agentDir = path.join(Config.workspaceDir, "agents", agent.id);

  // Resolve or create dedicated thread
  let threadId = config.taskgroup!.generalThreadId;
  if (threadId) {
    if (!threadStore.get(threadId)) threadId = undefined;
  }
  if (!threadId) {
    threadId = threadStore.create(agent.id);
    config.taskgroup!.generalThreadId = threadId;
    saveConfig();
  }

  // Abort controller for this run
  generalAbortController = new AbortController();
  const abortController = generalAbortController;

  // Typing indicator
  const typingInterval = setInterval(() => {
    bot.api.sendChatAction(chatId, "typing").catch(() => {});
  }, 4000);
  bot.api.sendChatAction(chatId, "typing").catch(() => {});

  // Status message (same pattern as DM channel)
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

  const callbacks = {
    onThinking() {
      updateStatus("Thinking\u2026");
    },
    onAssistantMessage(text: string) {
      updateStatus(text);
    },
    onToolUse(_toolName: string, _input: unknown, summary: string) {
      updateStatus(summary);
    },
    onToolUseSummary(summary: string) {
      updateStatus(summary);
    },
    async onResponse(_agentId: string, _threadId: string, text: string) {
      const formatted = toTelegramMarkdown(text);
      const chunks = splitMessage(formatted);
      for (const chunk of chunks) {
        await bot.api.sendMessage(chatId, chunk, {
          parse_mode: "Markdown",
        }).catch(() => {
          bot.api.sendMessage(chatId, chunk).catch((err) => {
            log.error("telegram", "failed to deliver general topic response:", err);
          });
        });
      }
    },
    onFileSend(_agentId: string, _threadId: string, filePath: string, caption: string | undefined, fileType: string) {
      const file = new InputFile(filePath);
      const opts: Record<string, unknown> = {};
      if (caption) opts.caption = caption;

      const sendFn = fileType === "photo" ? bot.api.sendPhoto.bind(bot.api)
        : fileType === "audio" ? bot.api.sendAudio.bind(bot.api)
        : fileType === "video" ? bot.api.sendVideo.bind(bot.api)
        : bot.api.sendDocument.bind(bot.api);

      sendFn(chatId, file, opts).catch((err: Error) => {
        log.error("telegram", `failed to send file to general topic:`, err.message);
      });
    },
    onNotifyUser(_agentId: string, _threadId: string, message: string) {
      const formatted = toTelegramMarkdown(message);
      bot.api.sendMessage(chatId, formatted, {
        parse_mode: "Markdown",
      }).catch(() => {
        bot.api.sendMessage(chatId, message).catch(() => {});
      });
    },
  };

  const userMessage = `[From task board]\n\n${text}`;

  runAgent(
    agentDir, threadId, userMessage,
    callbacks,
    { triggers: createTriggerMcpServer(agent.id) },
    undefined, abortController,
    { source: "chat" },
  ).catch((err) => {
    log.error("telegram", `general topic reply error:`, (err as Error).message);
  }).finally(() => {
    clearInterval(typingInterval);
    deleteStatus();
    if (generalAbortController === abortController) {
      generalAbortController = null;
    }
  });
}

async function handleTopicReply(
  ctx: Context,
  bot: Bot,
  config: TelegramConfig,
  topicId: number,
) {
  const mapping = config.taskgroup?.topicMappings.find((m) => m.topicId === topicId);
  if (!mapping) return; // Not a task topic

  const task = getTask(Config.workspaceDir, mapping.taskId);
  if (!task || !task.threadId) {
    await ctx.reply("Task or thread not found.", { message_thread_id: topicId });
    return;
  }

  const agents = agentStore.list();
  const agent = agents.get(task.owner);
  if (!agent) {
    await ctx.reply(`Agent "${task.owner}" not found.`, { message_thread_id: topicId });
    return;
  }

  const agentDir = path.join(Config.workspaceDir, "agents", agent.id);
  const userMessage = ctx.message!.text!;
  const chatId = Number(config.taskgroup!.chatId);

  const typingInterval = setInterval(() => {
    bot.api.sendChatAction(chatId, "typing", { message_thread_id: topicId }).catch(() => {});
  }, 4000);
  bot.api.sendChatAction(chatId, "typing", { message_thread_id: topicId }).catch(() => {});

  const topicCallbacks = {
    async onResponse(_agentId: string, _threadId: string, text: string) {
      const formatted = toTelegramMarkdown(text);
      const chunks = splitMessage(formatted);
      for (const chunk of chunks) {
        await bot.api.sendMessage(chatId, chunk, {
          message_thread_id: topicId,
          parse_mode: "Markdown",
        }).catch(() => {
          bot.api.sendMessage(chatId, chunk, { message_thread_id: topicId }).catch((err) => {
            log.error("telegram", "failed to deliver topic response:", err);
          });
        });
      }
    },
    onFileSend(_agentId: string, _threadId: string, filePath: string, caption: string | undefined, fileType: string) {
      const file = new InputFile(filePath);
      const opts: Record<string, unknown> = { message_thread_id: topicId };
      if (caption) opts.caption = caption;

      const sendFn = fileType === "photo" ? bot.api.sendPhoto.bind(bot.api)
        : fileType === "audio" ? bot.api.sendAudio.bind(bot.api)
        : fileType === "video" ? bot.api.sendVideo.bind(bot.api)
        : bot.api.sendDocument.bind(bot.api);

      sendFn(chatId, file, opts).catch((err: Error) => {
        log.error("telegram", `failed to send file to topic:`, err.message);
      });
    },
    onNotifyUser(_agentId: string, _threadId: string, message: string) {
      const formatted = toTelegramMarkdown(message);
      bot.api.sendMessage(chatId, formatted, {
        message_thread_id: topicId,
        parse_mode: "Markdown",
      }).catch(() => {
        bot.api.sendMessage(chatId, message, { message_thread_id: topicId }).catch(() => {});
      });
    },
  };

  runAgent(
    agentDir, task.threadId, userMessage,
    topicCallbacks,
    { triggers: createTriggerMcpServer(agent.id) },
    undefined, undefined,
    { source: "chat" },
  ).catch((err) => {
    log.error("telegram", `topic reply error for ${agent.id}:`, (err as Error).message);
  }).finally(() => {
    clearInterval(typingInterval);
  });
}

async function handleTaskgroupCallback(
  ctx: Context,
  config: TelegramConfig,
  saveConfig: () => void,
) {
  const data = ctx.callbackQuery!.data!;

  if (data.startsWith("taskgroup:connect:")) {
    const groupChatId = data.slice("taskgroup:connect:".length);
    config.taskgroup = { chatId: groupChatId, topicMappings: [] };
    saveConfig();
    await ctx.editMessageText("Connected ✓ — task topics will appear here.");
    await ctx.answerCallbackQuery();
    log.info("telegram", `taskgroup paired: ${groupChatId}`);
    return;
  }

  if (data.startsWith("taskgroup:ignore:")) {
    const groupChatId = data.slice("taskgroup:ignore:".length);
    if (!config.ignoredGroups) config.ignoredGroups = [];
    if (!config.ignoredGroups.includes(groupChatId)) {
      config.ignoredGroups.push(groupChatId);
    }
    saveConfig();
    await ctx.editMessageText("Got it — I'll stay quiet here.");
    await ctx.answerCallbackQuery();
    log.info("telegram", `taskgroup ignored: ${groupChatId}`);
    return;
  }
}

/**
 * Subscribe to task lifecycle events and auto-create/close forum topics.
 * Returns a cleanup function that removes the event listeners.
 */
export function initTaskgroupTopics(
  bot: Bot,
  config: TelegramConfig,
  saveConfig: () => void,
): () => void {
  function onTaskCreated({ taskId }: TaskEventPayload) {
    if (!config.taskgroup?.chatId) return;

    const task = getTask(Config.workspaceDir, taskId);
    if (!task) return;

    const chatId = Number(config.taskgroup.chatId);

    // Check if topic already exists for this task
    if (config.taskgroup.topicMappings.some((m) => m.taskId === taskId)) return;

    // Register callbacks synchronously with a promise so that task:started
    // (which fires right after task:created) can already resolve them.
    let resolveTopicId!: (topicId: number) => void;
    const topicIdPromise = new Promise<number>((resolve) => { resolveTopicId = resolve; });

    registerTaskDeliveryCallbacks(taskId, () => buildTopicCallbacks(bot, chatId, topicIdPromise));

    (async () => {
      try {
        const topic = await bot.api.createForumTopic(chatId, task.title);
        const topicId = topic.message_thread_id;

        resolveTopicId(topicId);

        config.taskgroup!.topicMappings.push({ taskId, topicId });
        saveConfig();

        log.info("telegram", `created taskgroup topic ${topicId} for task #${taskId}`);

        // Send initial message with task description
        const desc = task.description
          ? `*Task #${taskId}*: ${task.title}\n\n${toTelegramMarkdown(task.description)}`
          : `*Task #${taskId}*: ${task.title}`;
        await bot.api.sendMessage(chatId, desc, {
          message_thread_id: topicId,
          parse_mode: "Markdown",
          disable_notification: true,
        }).catch(() => {
          bot.api.sendMessage(chatId, `Task #${taskId}: ${task.title}\n\n${task.description || ""}`, {
            message_thread_id: topicId,
            disable_notification: true,
          }).catch(() => {});
        });
      } catch (err) {
        log.error("telegram", `failed to create topic for task #${taskId}:`, (err as Error).message);
        unregisterTaskDeliveryCallbacks(taskId);
      }
    })();
  }

  function onTaskEnded(status: "completed" | "canceled") {
    return ({ taskId }: TaskEventPayload) => {
      if (!config.taskgroup?.chatId) return;

      const mapping = config.taskgroup.topicMappings.find((m) => m.taskId === taskId);
      if (!mapping) return;

      const chatId = Number(config.taskgroup.chatId);
      const label = status === "completed" ? "Task completed" : "Task canceled";

      (async () => {
        try {
          await bot.api.sendMessage(chatId, `_${label}._`, {
            message_thread_id: mapping.topicId,
            parse_mode: "Markdown",
          }).catch(() => {});

          await bot.api.closeForumTopic(chatId, mapping.topicId).catch((err) => {
            log.warn("telegram", `failed to close topic ${mapping.topicId}:`, (err as Error).message);
          });

          log.info("telegram", `closed taskgroup topic ${mapping.topicId} for task #${taskId} (${status})`);
        } catch (err) {
          log.error("telegram", `failed to close topic for task #${taskId}:`, (err as Error).message);
        }

        unregisterTaskDeliveryCallbacks(taskId);
      })();
    };
  }

  const onCompleted = onTaskEnded("completed");
  const onCanceled = onTaskEnded("canceled");

  taskBus.on("task:created", onTaskCreated);
  taskBus.on("task:completed", onCompleted);
  taskBus.on("task:canceled", onCanceled);

  // Re-register callbacks for existing topic mappings (e.g. after reload)
  if (config.taskgroup?.chatId) {
    const chatId = Number(config.taskgroup.chatId);
    for (const mapping of config.taskgroup.topicMappings) {
      const task = getTask(Config.workspaceDir, mapping.taskId);
      if (task && (task.status === "active" || task.status === "draft")) {
        const readyTopicId = Promise.resolve(mapping.topicId);
        registerTaskDeliveryCallbacks(mapping.taskId, () => buildTopicCallbacks(bot, chatId, readyTopicId));
      }
    }
  }

  return () => {
    taskBus.removeListener("task:created", onTaskCreated);
    taskBus.removeListener("task:completed", onCompleted);
    taskBus.removeListener("task:canceled", onCanceled);
  };
}

/**
 * Build delivery callbacks that route messages to a taskgroup forum topic.
 * - onResponse / onFileSend → muted (disable_notification: true)
 * - onNotifyUser → with notification
 *
 * topicId is a promise so callbacks registered before the topic is created
 * will wait for it to resolve (fixes task:created → task:started race).
 */
function buildTopicCallbacks(bot: Bot, chatId: number, topicIdPromise: Promise<number>) {
  return {
    async onResponse(_agentId: string, _threadId: string, text: string) {
      const topicId = await topicIdPromise;
      const formatted = toTelegramMarkdown(text);
      const chunks = splitMessage(formatted);
      for (const chunk of chunks) {
        await bot.api.sendMessage(chatId, chunk, {
          message_thread_id: topicId,
          parse_mode: "Markdown",
          disable_notification: true,
        }).catch(() => {
          bot.api.sendMessage(chatId, chunk, {
            message_thread_id: topicId,
            disable_notification: true,
          }).catch((err) => {
            log.error("telegram", "failed to deliver topic response:", err);
          });
        });
      }
    },
    async onFileSend(_agentId: string, _threadId: string, filePath: string, caption: string | undefined, fileType: string) {
      const topicId = await topicIdPromise;
      const file = new InputFile(filePath);
      const opts: Record<string, unknown> = {
        message_thread_id: topicId,
        disable_notification: true,
      };
      if (caption) opts.caption = caption;

      const sendFn = fileType === "photo" ? bot.api.sendPhoto.bind(bot.api)
        : fileType === "audio" ? bot.api.sendAudio.bind(bot.api)
        : fileType === "video" ? bot.api.sendVideo.bind(bot.api)
        : bot.api.sendDocument.bind(bot.api);

      sendFn(chatId, file, opts).catch((err: Error) => {
        log.error("telegram", `failed to send file to topic:`, err.message);
      });
    },
    async onNotifyUser(_agentId: string, _threadId: string, message: string) {
      const topicId = await topicIdPromise;
      const formatted = toTelegramMarkdown(message);
      bot.api.sendMessage(chatId, formatted, {
        message_thread_id: topicId,
        parse_mode: "Markdown",
      }).catch(() => {
        bot.api.sendMessage(chatId, message, { message_thread_id: topicId }).catch(() => {});
      });
    },
  };
}
