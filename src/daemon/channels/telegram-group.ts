/**
 * Telegram group chat — pairing, message logging, context building, and agent invocation.
 *
 * All group chat logic lives here. Both the main bot and agent bots register
 * the middleware exported from this module.
 */

import fs from "fs";
import path from "path";
import { Bot, InlineKeyboard } from "grammy";
import type { Context, NextFunction } from "grammy";
import {
  Config,
  agentStore,
  threadStore,
  runAgent,
  createTriggerMcpServer,
  type TelegramConfig,
} from "#core/index.js";
import { splitMessage, toTelegramMarkdown } from "./telegram-utils.js";
import { log } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupMessage {
  id: number;
  from: string;
  fromBot: boolean;
  text: string;
  ts: string;
}

interface GroupReset {
  type: "reset";
  ts: string;
}

type GroupLogEntry = GroupMessage | GroupReset;

// ---------------------------------------------------------------------------
// JSONL message log
// ---------------------------------------------------------------------------

/** Recent message IDs for dedup (chatId:messageId). */
const recentIds = new Set<string>();
const RECENT_IDS_MAX = 500;

function logPath(chatId: string): string {
  return path.join(Config.workspaceDir, "groups", chatId, "messages.jsonl");
}

export function appendGroupMessage(chatId: string, msg: GroupMessage): boolean {
  const key = `${chatId}:${msg.id}`;
  if (recentIds.has(key)) return false; // dedup

  recentIds.add(key);
  if (recentIds.size > RECENT_IDS_MAX) {
    const first = recentIds.values().next().value;
    if (first) recentIds.delete(first);
  }

  const filePath = logPath(chatId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(msg) + "\n");
  return true;
}

export function appendGroupReset(chatId: string): void {
  const filePath = logPath(chatId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const entry: GroupReset = { type: "reset", ts: new Date().toISOString() };
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
}

/**
 * Build group context for an agent. Reads JSONL backwards from end,
 * stops at the agent's own last message or a reset sentinel.
 */
export function buildGroupContext(chatId: string, agentId: string, groupName: string): string {
  const filePath = logPath(chatId);
  if (!fs.existsSync(filePath)) return "";

  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return "";

  const lines = raw.split("\n");
  const contextMessages: GroupMessage[] = [];

  // Read backwards
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]!) as GroupLogEntry;
      if ("type" in entry && entry.type === "reset") break;
      const msg = entry as GroupMessage;
      if (msg.fromBot && msg.from === agentId) break; // agent's own last message
      contextMessages.unshift(msg);
    } catch {
      // skip malformed lines
    }
  }

  if (contextMessages.length === 0) return "";

  const formatted = contextMessages
    .map((m) => `[${m.from}]: ${m.text}`)
    .join("\n");

  return `<GroupChat name="${groupName}">\nRecent messages:\n\n${formatted}\n</GroupChat>`;
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Group message middleware
// ---------------------------------------------------------------------------

/** Active abort controllers keyed by "chatId:agentId". */
const activeAbortControllers = new Map<string, AbortController>();

export interface GroupMessageOptions {
  bot: Bot;
  config: TelegramConfig;
  saveConfig: () => void;
  /** Return the agent to invoke. Null means no agent available. */
  resolveAgent: () => { agentId: string; agentDir: string } | null;
}

/**
 * Creates middleware that handles group messages: logging, @mention detection,
 * context building, agent invocation, and /new + /stop commands.
 *
 * Must be registered BEFORE chatGuard.
 */
export function groupMessageMiddleware(opts: GroupMessageOptions) {
  const { bot, config, saveConfig } = opts;

  return async (ctx: Context, next: NextFunction) => {
    const message = ctx.message;
    if (!message) return next();

    const chat = message.chat;
    if (chat.type !== "group" && chat.type !== "supergroup") return next();

    const chatIdStr = String(chat.id);
    if (!isAuthorizedGroup(config, chatIdStr)) return next();

    const text = message.text;
    if (!text) return; // only handle text messages in groups for v1

    const groupConfig = config.groups![chatIdStr]!;
    const fromName = message.from?.first_name ?? "Unknown";
    const fromBot = message.from?.is_bot ?? false;

    log.info("telegram-group", `[${chatIdStr}] [${fromName}] ${text.length > 100 ? text.slice(0, 100) + "…" : text}`);
    appendGroupMessage(chatIdStr, {
      id: message.message_id,
      from: fromBot ? (opts.resolveAgent()?.agentId ?? fromName) : fromName,
      fromBot,
      text,
      ts: new Date().toISOString(),
    });

    // Handle /new — reset context and rotate threads
    if (text === "/new") {
      appendGroupReset(chatIdStr);
      const agentNames: string[] = [];
      for (const agentId of Object.keys(groupConfig.threads)) {
        const agent = agentStore.list().get(agentId);
        const newThreadId = threadStore.create(agentId);
        groupConfig.threads[agentId] = newThreadId;
        agentNames.push(agent?.name ?? agentId);
      }
      saveConfig();
      const names = agentNames.length > 0 ? agentNames.join(", ") : "all agents";
      await bot.api.sendMessage(chat.id, `New conversation started for ${names}.`).catch(() => {});
      return;
    }

    // Handle /stop — abort all running agents in this group
    if (text === "/stop") {
      let stopped = 0;
      for (const [key, ac] of activeAbortControllers) {
        if (key.startsWith(`${chatIdStr}:`)) {
          ac.abort();
          activeAbortControllers.delete(key);
          stopped++;
        }
      }
      await bot.api.sendMessage(chat.id, stopped > 0 ? "Stopped." : "Nothing running.").catch(() => {});
      return;
    }

    // Check trigger conditions
    const botInfo = bot.botInfo;
    let triggered = false;

    // 1. @mention by username in entities
    if (botInfo.username && message.entities) {
      for (const entity of message.entities) {
        if (entity.type === "mention") {
          const mentionText = text.slice(entity.offset, entity.offset + entity.length);
          if (mentionText.toLowerCase() === `@${botInfo.username.toLowerCase()}`) {
            triggered = true;
            break;
          }
        }
      }
    }

    // 2. Reply to one of this bot's messages
    if (!triggered && message.reply_to_message?.from?.id === botInfo.id) {
      triggered = true;
    }

    if (!triggered) {
      log.debug("telegram-group", `[${chatIdStr}] not triggered (bot=${botInfo.username}, entities=${JSON.stringify(message.entities ?? [])})`);
      return;
    }

    // Resolve agent
    const resolved = opts.resolveAgent();
    if (!resolved) {
      log.warn("telegram-group", `[${chatIdStr}] triggered but no agent available`);
      return;
    }

    const { agentId, agentDir } = resolved;
    log.info("telegram-group", `[${chatIdStr}] triggered → invoking agent ${agentId}`);

    // Resolve thread
    let threadId = groupConfig.threads[agentId];
    if (threadId && !threadStore.get(threadId)) {
      threadId = undefined;
    }
    if (!threadId) {
      threadId = threadStore.create(agentId);
      groupConfig.threads[agentId] = threadId;
      saveConfig();
    }

    // Build context
    const context = buildGroupContext(chatIdStr, agentId, groupConfig.name);
    const groupPrompt = `<GroupChat>\nYou are participating in a Telegram group chat "${groupConfig.name}".\nMessages from other participants are provided as context above your prompt.\nWhen responding, you are speaking to the group — keep responses conversational and concise.\nYou can reference what other participants (including other agents) have said.\n</GroupChat>`;

    const contextualizedMessage = [context, groupPrompt, text].filter(Boolean).join("\n\n");

    // Run agent
    const abortKey = `${chatIdStr}:${agentId}`;
    const abortController = new AbortController();
    activeAbortControllers.set(abortKey, abortController);

    const groupChatId = chat.id;

    const typingInterval = setInterval(() => {
      bot.api.sendChatAction(groupChatId, "typing").catch(() => {});
    }, 4000);
    bot.api.sendChatAction(groupChatId, "typing").catch(() => {});

    runAgent(
      agentDir, threadId, contextualizedMessage,
      {
        onThinking() {},
        onAssistantMessage() {
          bot.api.sendChatAction(groupChatId, "typing").catch(() => {});
        },
        onToolUse() {
          bot.api.sendChatAction(groupChatId, "typing").catch(() => {});
        },
        onToolUseSummary() {},
        async onResponse(_agentId: string, _threadId: string, responseText: string) {
          // Deliver to group
          const formatted = toTelegramMarkdown(responseText);
          const chunks = splitMessage(formatted);
          for (const chunk of chunks) {
            await bot.api.sendMessage(groupChatId, chunk, { parse_mode: "Markdown" }).catch(() => {
              return bot.api.sendMessage(groupChatId, chunk).catch((err) => {
                log.error("telegram", `failed to deliver group response:`, err);
              });
            });
          }
          // Append agent response to JSONL
          appendGroupMessage(chatIdStr, {
            id: Date.now(), // No Telegram message ID for agent responses
            from: agentId,
            fromBot: true,
            text: responseText,
            ts: new Date().toISOString(),
          });
        },
        onNotifyUser(_agentId: string, _threadId: string, notifyMessage: string) {
          bot.api.sendMessage(groupChatId, notifyMessage).catch(() => {});
        },
      },
      { triggers: createTriggerMcpServer(agentId) },
      undefined,
      abortController,
      { source: "chat" },
    ).catch((err) => {
      if (!abortController.signal.aborted) {
        log.error("telegram", `group agent ${agentId} error:`, (err as Error).message);
      }
    }).finally(() => {
      clearInterval(typingInterval);
      if (activeAbortControllers.get(abortKey) === abortController) {
        activeAbortControllers.delete(abortKey);
      }
    });
  };
}
