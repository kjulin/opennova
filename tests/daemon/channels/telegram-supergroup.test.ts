import { describe, it, expect, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { chatGuard } from "../../../src/daemon/channels/telegram-utils.js";
import { taskgroupMiddleware } from "../../../src/daemon/channels/telegram-taskgroup.js";
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
  taskgroup?: { chatId: string; topicMappings: { taskId: string; topicId: number }[] };
  ignoredGroups?: string[];
}

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

function createTestBot(config: TestConfig, apiOverrides?: Record<string, (payload: any) => any>) {
  const apiCalls: ApiCall[] = [];
  const saveConfig = vi.fn();

  const bot = new Bot("dummy:token", { botInfo: BOT_INFO });

  // Intercept ALL API calls via grammY's transformer
  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });

    // Check for overrides
    if (apiOverrides?.[method]) {
      return { ok: true, result: apiOverrides[method](payload) };
    }

    // Default responses for common methods
    if (method === "sendMessage") {
      return { ok: true, result: { message_id: 1, date: 0, chat: { id: (payload as any).chat_id, type: "supergroup" } } };
    }
    if (method === "editMessageText") {
      return { ok: true, result: true };
    }
    if (method === "answerCallbackQuery") {
      return { ok: true, result: true };
    }
    if (method === "getMe") {
      return { ok: true, result: BOT_INFO };
    }
    if (method === "getChatMember") {
      return { ok: true, result: { status: "member", user: BOT_INFO } };
    }

    return { ok: true, result: {} };
  });

  // Register taskgroup middleware (before chatGuard, like production)
  bot.use(taskgroupMiddleware(bot, config as any, saveConfig));
  bot.use(chatGuard(config.chatId));

  return { bot, config, saveConfig, apiCalls };
}

describe("telegram taskgroup pairing", () => {
  it("shows pairing prompt for supergroup with forum + admin", async () => {
    const { bot, apiCalls } = createTestBot(
      { token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main" },
      {
        getChatMember: () => ({ status: "administrator", can_manage_topics: true, user: BOT_INFO }),
      },
    );

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: true }));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.payload.text).toContain("Use this group as your task board?");
    const keyboard = (sendCalls[0]!.payload.reply_markup as any).inline_keyboard[0];
    expect(keyboard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Yes, connect" }),
        expect.objectContaining({ text: "No thanks" }),
      ]),
    );
  });

  it("'Yes, connect' callback pairs group", async () => {
    const { bot, config, saveConfig, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupCallbackUpdate(
      SUPERGROUP_CHAT_ID,
      `taskgroup:connect:${SUPERGROUP_CHAT_ID}`,
    ));

    expect(config.taskgroup).toEqual({
      chatId: String(SUPERGROUP_CHAT_ID),
      topicMappings: [],
    });
    expect(saveConfig).toHaveBeenCalledOnce();
    const editCalls = apiCalls.filter(c => c.method === "editMessageText");
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0]!.payload.text).toContain("Connected");
  });

  it("'No thanks' callback ignores group", async () => {
    const { bot, config, saveConfig, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupCallbackUpdate(
      SUPERGROUP_CHAT_ID,
      `taskgroup:ignore:${SUPERGROUP_CHAT_ID}`,
    ));

    expect(config.ignoredGroups).toContain(String(SUPERGROUP_CHAT_ID));
    expect(saveConfig).toHaveBeenCalledOnce();
    const editCalls = apiCalls.filter(c => c.method === "editMessageText");
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0]!.payload.text).toBe("Got it — I'll stay quiet here.");
  });

  it("already paired to different group → silent ignore", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      taskgroup: { chatId: String(OTHER_SUPERGROUP_ID), topicMappings: [] },
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: true }));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(0);
  });

  it("ignored group → silent", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      ignoredGroups: [String(SUPERGROUP_CHAT_ID)],
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: true }));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(0);
  });

  it("non-supergroup → error message", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
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

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.payload.text).toBe("Task board requires a supergroup.");
  });

  it("supergroup without topics → error message", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: false }));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.payload.text).toContain("Enable Topics");
  });

  it("no admin permission → error message", async () => {
    const { bot, apiCalls } = createTestBot(
      { token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main" },
      {
        getChatMember: () => ({ status: "administrator", can_manage_topics: false, user: BOT_INFO }),
      },
    );

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "hello", { isForum: true }));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.payload.text).toContain("Manage Topics");
  });

  it("/disconnect in General topic clears config", async () => {
    const { bot, config, saveConfig, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      taskgroup: { chatId: String(SUPERGROUP_CHAT_ID), topicMappings: [] },
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "/disconnect", { isForum: true }));

    expect(config.taskgroup).toBeUndefined();
    expect(saveConfig).toHaveBeenCalledOnce();
    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.payload.text).toContain("Disconnected");
  });

  it("/disconnect in non-General topic → no effect", async () => {
    const { bot, config, saveConfig, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      taskgroup: { chatId: String(SUPERGROUP_CHAT_ID), topicMappings: [] },
    });

    await bot.init();
    await bot.handleUpdate(makeSupergroupUpdate(SUPERGROUP_CHAT_ID, "/disconnect", {
      isForum: true,
      messageThreadId: 42,
    }));

    expect(config.taskgroup).toBeDefined();
    expect(saveConfig).not.toHaveBeenCalled();
    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(0);
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
