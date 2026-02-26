import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { chatGuard } from "../../../src/daemon/channels/telegram-utils.js";
import { makeTextUpdate } from "./telegram-test-utils.js";

const PRIVATE_CHAT_ID = "12345";
const SUPERGROUP_CHAT_ID = -1001234567890;
const OTHER_SUPERGROUP_ID = -1009999999999;

let updateId = 1000;

function makeSupergroupUpdate(chatId: number, text: string, opts?: {
  isForum?: boolean;
  messageThreadId?: number;
}): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: chatId,
        type: "supergroup",
        title: "Test Group",
        ...(opts?.isForum !== undefined ? { is_forum: opts.isForum } : {}),
      } as any,
      from: { id: 111, is_bot: false, first_name: "Test" },
      text,
      ...(opts?.messageThreadId ? { message_thread_id: opts.messageThreadId } : {}),
    },
  };
}

function makeSupergroupCallbackUpdate(chatId: number, data: string): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: "test-callback",
      chat_instance: "test",
      from: { id: 111, is_bot: false, first_name: "Test" },
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: chatId,
          type: "supergroup",
          title: "Test Group",
          is_forum: true,
        } as any,
        from: { id: 0, is_bot: true, first_name: "Bot" },
        text: "original",
      },
      data,
    },
  };
}

const BOT_INFO = {
  id: 999, is_bot: true as const, first_name: "TestBot",
  username: "test_bot", can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

interface TestConfig {
  token: string;
  chatId: string;
  activeAgentId: string;
  supergroup?: { chatId: string; topicMappings: { taskId: string; topicId: number }[] };
  ignoredGroups?: string[];
}

function createTestBot(config: TestConfig) {
  const bot = new Bot("dummy:token", { botInfo: BOT_INFO });
  const saveTelegramConfig = vi.fn();
  const replies: { chatId: number; text: string; opts?: any }[] = [];
  const editedMessages: { text: string }[] = [];
  const answeredCallbacks: boolean[] = [];

  // Spy on bot API methods
  vi.spyOn(bot.api, "sendMessage").mockImplementation(async (chatId: any, text: any, opts?: any) => {
    replies.push({ chatId: Number(chatId), text: String(text), opts });
    return { message_id: 1, date: 0, chat: { id: Number(chatId), type: "private" as const } } as any;
  });

  vi.spyOn(bot.api, "editMessageText").mockImplementation(async (_chatId: any, _msgId: any, text: any) => {
    editedMessages.push({ text: String(text) });
    return true as any;
  });

  vi.spyOn(bot.api, "answerCallbackQuery").mockImplementation(async () => true as any);

  // --- Supergroup pairing helpers ---

  async function handleSupergroupMessage(ctx: any) {
    const chatIdStr = String(ctx.chat.id);

    if (config.supergroup?.chatId === chatIdStr) {
      if (ctx.message?.text === "/disconnect" && !ctx.message.message_thread_id) {
        config.supergroup = undefined;
        saveTelegramConfig(config);
        replies.push({ chatId: ctx.chat.id, text: "Disconnected. Task topics will stay visible but I'll stop updating them." });
      }
      return;
    }

    if (config.ignoredGroups?.includes(chatIdStr)) return;

    if (config.supergroup?.chatId) return;

    if (ctx.chat.type !== "supergroup") {
      replies.push({ chatId: ctx.chat.id, text: "Task board requires a supergroup." });
      return;
    }

    if (!ctx.chat.is_forum) {
      replies.push({ chatId: ctx.chat.id, text: "Enable Topics in this group's settings to use it as a task board." });
      return;
    }

    try {
      const me = await bot.api.getMe();
      const member = await bot.api.getChatMember(ctx.chat.id, me.id);
      if (member.status !== "administrator" || !(member as any).can_manage_topics) {
        replies.push({ chatId: ctx.chat.id, text: "I need the 'Manage Topics' admin permission to create task topics." });
        return;
      }
    } catch {
      replies.push({ chatId: ctx.chat.id, text: "I need the 'Manage Topics' admin permission to create task topics." });
      return;
    }

    replies.push({
      chatId: ctx.chat.id,
      text: "Use this group as your task board?\nTask topics will be created here automatically.",
      opts: { reply_markup: { inline_keyboard: [[
        { text: "Yes, connect", callback_data: `supergroup:connect:${chatIdStr}` },
        { text: "No thanks", callback_data: `supergroup:ignore:${chatIdStr}` },
      ]] } },
    });
  }

  async function handleSupergroupCallback(ctx: any) {
    const data = ctx.callbackQuery.data;

    if (data.startsWith("supergroup:connect:")) {
      const groupChatId = data.slice("supergroup:connect:".length);
      config.supergroup = { chatId: groupChatId, topicMappings: [] };
      saveTelegramConfig(config);
      editedMessages.push({ text: "Connected ✓ — task topics will appear here." });
      answeredCallbacks.push(true);
      return;
    }

    if (data.startsWith("supergroup:ignore:")) {
      const groupChatId = data.slice("supergroup:ignore:".length);
      if (!config.ignoredGroups) config.ignoredGroups = [];
      if (!config.ignoredGroups.includes(groupChatId)) {
        config.ignoredGroups.push(groupChatId);
      }
      saveTelegramConfig(config);
      editedMessages.push({ text: "Got it — I'll stay quiet here." });
      answeredCallbacks.push(true);
      return;
    }
  }

  // Supergroup middleware — BEFORE chatGuard
  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    if (!chat) return next();

    const chatIdStr = String(chat.id);

    if (chatIdStr === config.chatId) return next();

    if (ctx.callbackQuery?.data?.startsWith("supergroup:")) {
      await handleSupergroupCallback(ctx);
      return;
    }

    if (!ctx.message) return next();

    await handleSupergroupMessage(ctx);
  });

  bot.use(chatGuard(config.chatId));

  return { bot, config, saveTelegramConfig, replies, editedMessages, answeredCallbacks };
}

describe("telegram supergroup pairing", () => {
  it("shows pairing prompt for supergroup with forum + admin", async () => {
    const { bot, replies } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    vi.spyOn(bot.api, "getMe").mockResolvedValue(BOT_INFO as any);
    vi.spyOn(bot.api, "getChatMember").mockResolvedValue({
      status: "administrator",
      can_manage_topics: true,
      user: BOT_INFO,
    } as any);

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: true }));

    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("Use this group as your task board?");
    expect(replies[0]!.opts.reply_markup.inline_keyboard[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Yes, connect" }),
        expect.objectContaining({ text: "No thanks" }),
      ]),
    );
  });

  it("'Yes, connect' callback pairs group", async () => {
    const { bot, config, saveTelegramConfig, editedMessages, answeredCallbacks } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupCallbackUpdate(
      SUPERGROUP_CHAT_ID,
      `supergroup:connect:${SUPERGROUP_CHAT_ID}`,
    ));

    expect(config.supergroup).toEqual({
      chatId: String(SUPERGROUP_CHAT_ID),
      topicMappings: [],
    });
    expect(saveTelegramConfig).toHaveBeenCalledOnce();
    expect(editedMessages[0]!.text).toContain("Connected");
    expect(answeredCallbacks).toHaveLength(1);
  });

  it("'No thanks' callback ignores group", async () => {
    const { bot, config, saveTelegramConfig, editedMessages } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupCallbackUpdate(
      SUPERGROUP_CHAT_ID,
      `supergroup:ignore:${SUPERGROUP_CHAT_ID}`,
    ));

    expect(config.ignoredGroups).toContain(String(SUPERGROUP_CHAT_ID));
    expect(saveTelegramConfig).toHaveBeenCalledOnce();
    expect(editedMessages[0]!.text).toBe("Got it — I'll stay quiet here.");
  });

  it("already paired to different group → silent ignore", async () => {
    const { bot, replies } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      supergroup: { chatId: String(OTHER_SUPERGROUP_ID), topicMappings: [] },
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: true }));

    expect(replies).toHaveLength(0);
  });

  it("ignored group → silent", async () => {
    const { bot, replies } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      ignoredGroups: [String(SUPERGROUP_CHAT_ID)],
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: true }));

    expect(replies).toHaveLength(0);
  });

  it("non-supergroup → error message", async () => {
    const { bot, replies } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    // Send a "group" type message (not supergroup)
    const update: Update = {
      update_id: updateId++,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100555, type: "group", title: "Regular Group" } as any,
        from: { id: 111, is_bot: false, first_name: "Test" },
        text: "hello",
      },
    };
    await bot.handleUpdate(update);

    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toBe("Task board requires a supergroup.");
  });

  it("supergroup without topics → error message", async () => {
    const { bot, replies } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: false }));

    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("Enable Topics");
  });

  it("no admin permission → error message", async () => {
    const { bot, replies } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    vi.spyOn(bot.api, "getMe").mockResolvedValue(BOT_INFO as any);
    vi.spyOn(bot.api, "getChatMember").mockResolvedValue({
      status: "administrator",
      can_manage_topics: false,
      user: BOT_INFO,
    } as any);

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: true }));

    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("Manage Topics");
  });

  it("/disconnect in General topic clears config", async () => {
    const { bot, config, saveTelegramConfig, replies } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      supergroup: { chatId: String(SUPERGROUP_CHAT_ID), topicMappings: [] },
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "/disconnect", { isForum: true }));

    expect(config.supergroup).toBeUndefined();
    expect(saveTelegramConfig).toHaveBeenCalledOnce();
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("Disconnected");
  });

  it("/disconnect in non-General topic → no effect", async () => {
    const { bot, config, saveTelegramConfig, replies } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      supergroup: { chatId: String(SUPERGROUP_CHAT_ID), topicMappings: [] },
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "/disconnect", {
      isForum: true,
      messageThreadId: 42,
    }));

    expect(config.supergroup).toBeDefined();
    expect(saveTelegramConfig).not.toHaveBeenCalled();
    expect(replies).toHaveLength(0);
  });

  it("private chat still works through chatGuard", async () => {
    const { bot } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    const handler = vi.fn();
    bot.on("message:text", handler);
    await bot.init();

    await bot.handleUpdate(makeTextUpdate(Number(PRIVATE_CHAT_ID), "hello"));

    expect(handler).toHaveBeenCalledOnce();
  });
});
