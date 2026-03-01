import { describe, it, expect, vi } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { chatGuard } from "../../../src/daemon/channels/telegram-utils.js";
import { groupPairingMiddleware, isAuthorizedGroup } from "../../../src/daemon/channels/telegram-group.js";
import { makeTextUpdate } from "./telegram-test-utils.js";

const PRIVATE_CHAT_ID = "12345";
const GROUP_CHAT_ID = -1001234567890;
const OTHER_GROUP_ID = -1009999999999;

let updateId = 2000;

function makeMyChatMemberUpdate(
  chatId: number,
  chatTitle: string,
  newStatus: "member" | "administrator" | "left" | "kicked",
  chatType: "group" | "supergroup" = "supergroup",
): Update {
  return {
    update_id: updateId++,
    my_chat_member: {
      chat: { id: chatId, type: chatType, title: chatTitle } as any,
      from: { id: 111, is_bot: false, first_name: "Test" },
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { status: "left", user: BOT_INFO } as any,
      new_chat_member: { status: newStatus, user: BOT_INFO } as any,
    },
  };
}

function makeGroupCallbackUpdate(data: string): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: "test-callback",
      chat_instance: "test",
      from: { id: 111, is_bot: false, first_name: "Test" },
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(PRIVATE_CHAT_ID), type: "private" } as any,
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
  groups?: Record<string, { name: string; threads: Record<string, string> }>;
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

  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });

    if (apiOverrides?.[method]) {
      return { ok: true, result: apiOverrides[method](payload) };
    }

    if (method === "sendMessage") {
      return { ok: true, result: { message_id: 1, date: 0, chat: { id: (payload as any).chat_id, type: "private" } } };
    }
    if (method === "editMessageText") {
      return { ok: true, result: true };
    }
    if (method === "answerCallbackQuery") {
      return { ok: true, result: true };
    }
    if (method === "getChat") {
      return { ok: true, result: { id: (payload as any).chat_id, type: "supergroup", title: "Fetched Group" } };
    }

    return { ok: true, result: {} };
  });

  bot.use(groupPairingMiddleware(bot, config as any, saveConfig));
  bot.use(chatGuard(config.chatId));

  return { bot, config, saveConfig, apiCalls };
}

describe("telegram group pairing", () => {
  it("bot added to group → sends DM confirmation prompt", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeMyChatMemberUpdate(GROUP_CHAT_ID, "Nova Team", "member"));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.payload.chat_id).toBe(Number(PRIVATE_CHAT_ID));
    expect(sendCalls[0]!.payload.text).toContain("Nova Team");
    expect(sendCalls[0]!.payload.text).toContain("group chat");
    const keyboard = (sendCalls[0]!.payload.reply_markup as any).inline_keyboard[0];
    expect(keyboard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Yes, connect" }),
        expect.objectContaining({ text: "No thanks" }),
      ]),
    );
  });

  it("bot promoted to admin → also sends DM confirmation", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeMyChatMemberUpdate(GROUP_CHAT_ID, "Nova Team", "administrator"));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.payload.text).toContain("Nova Team");
  });

  it("user confirms → group persisted in config.groups", async () => {
    const { bot, config, saveConfig, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    // First trigger the my_chat_member so the name is cached
    await bot.handleUpdate(makeMyChatMemberUpdate(GROUP_CHAT_ID, "Nova Team", "member"));

    await bot.handleUpdate(makeGroupCallbackUpdate(`group:connect:${GROUP_CHAT_ID}`));

    expect(config.groups?.[String(GROUP_CHAT_ID)]).toEqual({
      name: "Nova Team",
      threads: {},
    });
    expect(saveConfig).toHaveBeenCalled();
    const editCalls = apiCalls.filter(c => c.method === "editMessageText");
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0]!.payload.text).toContain("Connected");
    expect(editCalls[0]!.payload.text).toContain("Nova Team");
  });

  it("user confirms after restart → resolves name via API", async () => {
    const { bot, config, saveConfig } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    }, {
      getChat: () => ({ id: GROUP_CHAT_ID, type: "supergroup", title: "Resolved Group" }),
    });

    await bot.init();
    // No my_chat_member first — simulate restart where pendingGroups is empty
    await bot.handleUpdate(makeGroupCallbackUpdate(`group:connect:${GROUP_CHAT_ID}`));

    expect(config.groups?.[String(GROUP_CHAT_ID)]).toEqual({
      name: "Resolved Group",
      threads: {},
    });
    expect(saveConfig).toHaveBeenCalled();
  });

  it("user declines → chatId added to ignoredGroups", async () => {
    const { bot, config, saveConfig, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeGroupCallbackUpdate(`group:ignore:${GROUP_CHAT_ID}`));

    expect(config.ignoredGroups).toContain(String(GROUP_CHAT_ID));
    expect(saveConfig).toHaveBeenCalledOnce();
    const editCalls = apiCalls.filter(c => c.method === "editMessageText");
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0]!.payload.text).toContain("ignore");
  });

  it("already authorized group → no prompt", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_CHAT_ID)]: { name: "Nova Team", threads: {} } },
    });

    await bot.init();
    await bot.handleUpdate(makeMyChatMemberUpdate(GROUP_CHAT_ID, "Nova Team", "member"));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(0);
  });

  it("already ignored group → no prompt", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      ignoredGroups: [String(GROUP_CHAT_ID)],
    });

    await bot.init();
    await bot.handleUpdate(makeMyChatMemberUpdate(GROUP_CHAT_ID, "Nova Team", "member"));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(0);
  });

  it("group is taskgroup → no prompt", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      taskgroup: { chatId: String(GROUP_CHAT_ID), topicMappings: [] },
    });

    await bot.init();
    await bot.handleUpdate(makeMyChatMemberUpdate(GROUP_CHAT_ID, "Nova Team", "member"));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(0);
  });

  it("bot removed from group → entry removed from config.groups", async () => {
    const { bot, config, saveConfig } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_CHAT_ID)]: { name: "Nova Team", threads: {} } },
    });

    await bot.init();
    await bot.handleUpdate(makeMyChatMemberUpdate(GROUP_CHAT_ID, "Nova Team", "left"));

    expect(config.groups?.[String(GROUP_CHAT_ID)]).toBeUndefined();
    expect(saveConfig).toHaveBeenCalledOnce();
  });

  it("bot removed from group with no config → no error", async () => {
    const { bot, saveConfig } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    await bot.handleUpdate(makeMyChatMemberUpdate(GROUP_CHAT_ID, "Nova Team", "left"));

    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("non-group chat type → no prompt", async () => {
    const { bot, apiCalls } = createTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
    });

    await bot.init();
    // my_chat_member from a channel (not a group)
    const update: Update = {
      update_id: updateId++,
      my_chat_member: {
        chat: { id: -100555, type: "channel", title: "A Channel" } as any,
        from: { id: 111, is_bot: false, first_name: "Test" },
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: "left", user: BOT_INFO } as any,
        new_chat_member: { status: "member", user: BOT_INFO } as any,
      },
    };
    await bot.handleUpdate(update);

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(0);
  });

  it("private DM messages pass through middleware to chatGuard", async () => {
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

describe("isAuthorizedGroup", () => {
  it("returns true for authorized group", () => {
    const config = {
      token: "t", chatId: "123", activeAgentId: "main",
      groups: { "-100123": { name: "Test", threads: {} } },
    } as any;
    expect(isAuthorizedGroup(config, "-100123")).toBe(true);
  });

  it("returns false for unauthorized group", () => {
    const config = {
      token: "t", chatId: "123", activeAgentId: "main",
      groups: { "-100123": { name: "Test", threads: {} } },
    } as any;
    expect(isAuthorizedGroup(config, "-100999")).toBe(false);
  });

  it("returns false when no groups configured", () => {
    const config = {
      token: "t", chatId: "123", activeAgentId: "main",
    } as any;
    expect(isAuthorizedGroup(config, "-100123")).toBe(false);
  });
});
