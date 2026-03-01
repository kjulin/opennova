/**
 * Group chat pairing — authorizes Telegram groups for multi-agent chat.
 *
 * Phase 1: pairing only. When the main bot is added to a group,
 * it sends a DM confirmation to the user. On confirm, the group
 * is persisted in telegram.json under `groups`.
 */

import { Bot, InlineKeyboard } from "grammy";
import type { Context, NextFunction } from "grammy";
import type { TelegramConfig } from "#core/index.js";
import { log } from "../logger.js";

/** Pending group names keyed by chatId (callback data has a 64-byte limit). */
const pendingGroups = new Map<string, string>();

/**
 * Check whether a chat ID is an authorized group.
 */
export function isAuthorizedGroup(
  config: TelegramConfig,
  chatId: string,
): boolean {
  return !!config.groups?.[chatId];
}

/**
 * Creates middleware that handles group chat pairing.
 * Must be registered BEFORE chatGuard so `my_chat_member` updates
 * and `group:` callbacks are not silently dropped.
 */
export function groupPairingMiddleware(
  bot: Bot,
  config: TelegramConfig,
  saveConfig: () => void,
) {
  return async (ctx: Context, next: NextFunction) => {
    // Handle group: callback queries (from the DM confirmation)
    if (ctx.callbackQuery?.data?.startsWith("group:")) {
      await handleGroupCallback(ctx, bot, config, saveConfig);
      return;
    }

    // Handle my_chat_member updates (bot added/removed from group)
    if (ctx.myChatMember) {
      await handleMyChatMember(ctx, bot, config, saveConfig);
      return;
    }

    return next();
  };
}

async function handleMyChatMember(
  ctx: Context,
  bot: Bot,
  config: TelegramConfig,
  saveConfig: () => void,
) {
  const update = ctx.myChatMember!;
  const chat = update.chat;
  const newStatus = update.new_chat_member.status;
  const chatIdStr = String(chat.id);

  // Only handle group/supergroup chats
  if (chat.type !== "group" && chat.type !== "supergroup") return;

  // Bot removed from group — clean up
  if (newStatus === "left" || newStatus === "kicked") {
    if (config.groups?.[chatIdStr]) {
      delete config.groups[chatIdStr];
      if (Object.keys(config.groups).length === 0) {
        config.groups = undefined;
      }
      saveConfig();
      log.info("telegram", `group removed (bot left): ${chatIdStr}`);
    }
    return;
  }

  // Bot added or promoted — offer pairing
  if (newStatus !== "member" && newStatus !== "administrator") return;

  // Already authorized
  if (config.groups?.[chatIdStr]) return;

  // Already ignored
  if (config.ignoredGroups?.includes(chatIdStr)) return;

  // Already used as taskgroup
  if (config.taskgroup?.chatId === chatIdStr) return;

  const groupName = chat.title ?? "Unnamed group";
  pendingGroups.set(chatIdStr, groupName);

  const keyboard = new InlineKeyboard()
    .text("Yes, connect", `group:connect:${chatIdStr}`)
    .text("No thanks", `group:ignore:${chatIdStr}`);

  try {
    await bot.api.sendMessage(
      Number(config.chatId),
      `I was added to group *${groupName}*. Use it as a group chat?`,
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  } catch (err) {
    log.error("telegram", `failed to send group pairing prompt for ${chatIdStr}:`, (err as Error).message);
  }
}

async function handleGroupCallback(
  ctx: Context,
  bot: Bot,
  config: TelegramConfig,
  saveConfig: () => void,
) {
  const data = ctx.callbackQuery!.data!;

  if (data.startsWith("group:connect:")) {
    const groupChatId = data.slice("group:connect:".length);

    // Resolve group name from pending map or via API
    let groupName = pendingGroups.get(groupChatId);
    if (!groupName) {
      try {
        const chat = await bot.api.getChat(Number(groupChatId));
        groupName = ("title" in chat ? chat.title : undefined) ?? "Unnamed group";
      } catch {
        groupName = "Unnamed group";
      }
    }
    pendingGroups.delete(groupChatId);

    if (!config.groups) config.groups = {};
    config.groups[groupChatId] = { name: groupName, threads: {} };
    saveConfig();

    await ctx.editMessageText(`Connected — group chat enabled for *${groupName}*.`, { parse_mode: "Markdown" });
    await ctx.answerCallbackQuery();
    log.info("telegram", `group paired: ${groupChatId} (${groupName})`);
    return;
  }

  if (data.startsWith("group:ignore:")) {
    const groupChatId = data.slice("group:ignore:".length);
    pendingGroups.delete(groupChatId);

    if (!config.ignoredGroups) config.ignoredGroups = [];
    if (!config.ignoredGroups.includes(groupChatId)) {
      config.ignoredGroups.push(groupChatId);
    }
    saveConfig();

    await ctx.editMessageText("Got it — I'll ignore this group.");
    await ctx.answerCallbackQuery();
    log.info("telegram", `group ignored: ${groupChatId}`);
    return;
  }
}
