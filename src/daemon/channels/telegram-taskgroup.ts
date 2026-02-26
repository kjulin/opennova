/**
 * Taskgroup pairing — connects a Telegram supergroup as a task board.
 *
 * Phase 1: pairing only. No topic creation or message routing.
 *
 * When the bot receives a message from an unknown supergroup with
 * forum topics enabled and can_manage_topics permission, it offers
 * to pair via inline keyboard. The user confirms or declines.
 */

import { Bot, InlineKeyboard } from "grammy";
import type { Context, NextFunction } from "grammy";
import type { TelegramConfig } from "#core/index.js";
import { log } from "../logger.js";

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

    await handleTaskgroupMessage(ctx, bot, config, saveConfig);
    // Don't call next() — don't let chatGuard see these
  };
}

async function handleTaskgroupMessage(
  ctx: Context,
  bot: Bot,
  config: TelegramConfig,
  saveConfig: () => void,
) {
  const chat = ctx.chat!;
  const chatIdStr = String(chat.id);

  // Already paired to this group
  if (config.taskgroup?.chatId === chatIdStr) {
    // Handle /disconnect in General topic
    if (ctx.message?.text === "/disconnect" && !ctx.message.message_thread_id) {
      config.taskgroup = undefined;
      saveConfig();
      await ctx.reply("Disconnected. Task topics will stay visible but I'll stop updating them.");
      log.info("telegram", `taskgroup disconnected: ${chatIdStr}`);
    }
    return;
  }

  // In ignored list → ignore
  if (config.ignoredGroups?.includes(chatIdStr)) return;

  // Already paired to a different group → silently ignore
  if (config.taskgroup?.chatId) return;

  // Pre-validation checks
  if (chat.type !== "supergroup") {
    await ctx.reply("Task board requires a supergroup.");
    return;
  }

  if (!(chat as any).is_forum) {
    await ctx.reply("Enable Topics in this group's settings to use it as a task board.");
    return;
  }

  // Check bot permissions
  try {
    const me = await bot.api.getMe();
    const member = await bot.api.getChatMember(chat.id, me.id);
    if (member.status !== "administrator" || !(member as any).can_manage_topics) {
      await ctx.reply("I need the 'Manage Topics' admin permission to create task topics.");
      return;
    }
  } catch (err) {
    log.warn("telegram", `failed to check bot permissions in ${chatIdStr}:`, (err as Error).message);
    await ctx.reply("I need the 'Manage Topics' admin permission to create task topics.");
    return;
  }

  // All checks pass — show pairing prompt
  const keyboard = new InlineKeyboard()
    .text("Yes, connect", `taskgroup:connect:${chatIdStr}`)
    .text("No thanks", `taskgroup:ignore:${chatIdStr}`);

  await ctx.reply(
    "Use this group as your task board?\nTask topics will be created here automatically.",
    { reply_markup: keyboard },
  );
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
