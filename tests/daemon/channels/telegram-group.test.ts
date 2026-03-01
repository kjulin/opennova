import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { chatGuard } from "../../../src/daemon/channels/telegram-utils.js";
import {
  groupPairingMiddleware,
  groupMessageMiddleware,
  isAuthorizedGroup,
  appendGroupMessage,
  appendGroupReset,
  buildGroupContext,
} from "../../../src/daemon/channels/telegram-group.js";
import { makeTextUpdate } from "./telegram-test-utils.js";

// Mock core modules used by groupMessageMiddleware
const mockRunAgent = vi.fn().mockResolvedValue(undefined);
const mockThreadStoreCreate = vi.fn().mockReturnValue("new-thread-id");
const mockThreadStoreGet = vi.fn().mockReturnValue({ id: "t1", title: "Thread" });
const mockAgentStoreList = vi.fn().mockReturnValue(new Map([["agent-1", { id: "agent-1", name: "TestAgent" }]]));
const mockCreateTriggerMcpServer = vi.fn().mockReturnValue(undefined);

vi.mock("#core/index.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    Config: { workspaceDir: "" }, // overridden per test via setWorkspaceDir
    runAgent: (...args: unknown[]) => mockRunAgent(...args),
    threadStore: {
      create: (...args: unknown[]) => mockThreadStoreCreate(...args),
      get: (...args: unknown[]) => mockThreadStoreGet(...args),
      list: () => [],
    },
    agentStore: {
      list: () => mockAgentStoreList(),
    },
    createTriggerMcpServer: (...args: unknown[]) => mockCreateTriggerMcpServer(...args),
  };
});

// Access the mocked Config to change workspaceDir per test
import { Config } from "#core/index.js";

function setWorkspaceDir(dir: string) {
  (Config as any).workspaceDir = dir;
}

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

// ---------------------------------------------------------------------------
// Phase 2: JSONL message logging, context building, group message middleware
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-group-test-"));
  setWorkspaceDir(tmpDir);
  mockRunAgent.mockReset().mockResolvedValue(undefined);
  mockThreadStoreCreate.mockReset().mockReturnValue("new-thread-id");
  mockThreadStoreGet.mockReset().mockReturnValue({ id: "t1", title: "Thread" });
  mockAgentStoreList.mockReset().mockReturnValue(new Map([["agent-1", { id: "agent-1", name: "TestAgent" }]]));
  mockCreateTriggerMcpServer.mockReset().mockReturnValue(undefined);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("JSONL message log", () => {
  it("appendGroupMessage writes to file", () => {
    appendGroupMessage("-100999", { id: 1, from: "Alice", fromBot: false, text: "hello", ts: "2026-01-01T00:00:00Z" });
    const filePath = path.join(tmpDir, "groups", "-100999", "messages.jsonl");
    expect(fs.existsSync(filePath)).toBe(true);
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const msg = JSON.parse(lines[0]!);
    expect(msg.from).toBe("Alice");
    expect(msg.text).toBe("hello");
  });

  it("appendGroupMessage deduplicates by message ID", () => {
    const msg = { id: 42, from: "Alice", fromBot: false, text: "hello", ts: "2026-01-01T00:00:00Z" };
    const first = appendGroupMessage("-100999", msg);
    const second = appendGroupMessage("-100999", msg);
    expect(first).toBe(true);
    expect(second).toBe(false);
    const filePath = path.join(tmpDir, "groups", "-100999", "messages.jsonl");
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("appendGroupReset writes reset sentinel", () => {
    appendGroupReset("-100999");
    const filePath = path.join(tmpDir, "groups", "-100999", "messages.jsonl");
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.type).toBe("reset");
  });
});

describe("buildGroupContext", () => {
  it("returns empty string when no log file exists", () => {
    const result = buildGroupContext("-100999", "agent-1", "Test Group");
    expect(result).toBe("");
  });

  it("returns all messages for first interaction", () => {
    appendGroupMessage("-100888", { id: 1, from: "Alice", fromBot: false, text: "hey", ts: "2026-01-01T00:00:00Z" });
    appendGroupMessage("-100888", { id: 2, from: "Bob", fromBot: false, text: "yo", ts: "2026-01-01T00:00:01Z" });

    const result = buildGroupContext("-100888", "agent-1", "My Group");
    expect(result).toContain("<GroupChat");
    expect(result).toContain("My Group");
    expect(result).toContain("[Alice]: hey");
    expect(result).toContain("[Bob]: yo");
  });

  it("stops at agent's own last message", () => {
    appendGroupMessage("-100777", { id: 1, from: "Alice", fromBot: false, text: "old", ts: "2026-01-01T00:00:00Z" });
    appendGroupMessage("-100777", { id: 2, from: "agent-1", fromBot: true, text: "agent reply", ts: "2026-01-01T00:00:01Z" });
    appendGroupMessage("-100777", { id: 3, from: "Bob", fromBot: false, text: "new", ts: "2026-01-01T00:00:02Z" });

    const result = buildGroupContext("-100777", "agent-1", "Group");
    expect(result).toContain("[Bob]: new");
    expect(result).not.toContain("old");
    expect(result).not.toContain("agent reply");
  });

  it("stops at reset sentinel", () => {
    appendGroupMessage("-100666", { id: 1, from: "Alice", fromBot: false, text: "before reset", ts: "2026-01-01T00:00:00Z" });
    appendGroupReset("-100666");
    appendGroupMessage("-100666", { id: 2, from: "Bob", fromBot: false, text: "after reset", ts: "2026-01-01T00:00:02Z" });

    const result = buildGroupContext("-100666", "agent-1", "Group");
    expect(result).toContain("[Bob]: after reset");
    expect(result).not.toContain("before reset");
  });

  it("includes messages from other agents", () => {
    appendGroupMessage("-100555", { id: 1, from: "agent-2", fromBot: true, text: "other agent", ts: "2026-01-01T00:00:00Z" });
    appendGroupMessage("-100555", { id: 2, from: "Alice", fromBot: false, text: "reply", ts: "2026-01-01T00:00:01Z" });

    const result = buildGroupContext("-100555", "agent-1", "Group");
    expect(result).toContain("[agent-2]: other agent");
    expect(result).toContain("[Alice]: reply");
  });
});

// ---------------------------------------------------------------------------
// groupMessageMiddleware tests
// ---------------------------------------------------------------------------

const GROUP_MSG_CHAT_ID = -1001111111111;
let msgUpdateId = 5000;

function makeGroupTextUpdate(
  chatId: number,
  text: string,
  opts?: {
    fromBot?: boolean;
    fromId?: number;
    firstName?: string;
    messageId?: number;
    entities?: Array<{ type: string; offset: number; length: number }>;
    replyToMessageFromId?: number;
  },
): Update {
  return {
    update_id: msgUpdateId++,
    message: {
      message_id: opts?.messageId ?? msgUpdateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "supergroup", title: "Test Group" } as any,
      from: {
        id: opts?.fromId ?? 111,
        is_bot: opts?.fromBot ?? false,
        first_name: opts?.firstName ?? "TestUser",
      },
      text,
      ...(opts?.entities ? { entities: opts.entities } : {}),
      ...(opts?.replyToMessageFromId !== undefined ? {
        reply_to_message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: "supergroup" } as any,
          from: { id: opts.replyToMessageFromId, is_bot: true, first_name: "Bot" },
          text: "previous",
        },
      } : {}),
    },
  };
}

interface GroupTestConfig {
  token: string;
  chatId: string;
  activeAgentId: string;
  groups?: Record<string, { name: string; threads: Record<string, string> }>;
}

function createGroupTestBot(config: GroupTestConfig) {
  const apiCalls: ApiCall[] = [];
  const saveConfig = vi.fn();
  const resolveAgent = vi.fn().mockReturnValue({ agentId: "agent-1", agentDir: "/tmp/agents/agent-1" });

  const bot = new Bot("dummy:token", { botInfo: BOT_INFO });

  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage") {
      return { ok: true, result: { message_id: 1, date: 0, chat: { id: (payload as any).chat_id, type: "supergroup" } } };
    }
    if (method === "sendChatAction") {
      return { ok: true, result: true };
    }
    return { ok: true, result: {} };
  });

  bot.use(groupMessageMiddleware({ bot, config: config as any, saveConfig, resolveAgent }));
  bot.use(chatGuard(config.chatId));

  // Catch-all handler to avoid grammY unhandled update errors
  bot.on("message", () => {});

  return { bot, config, saveConfig, apiCalls, resolveAgent };
}

describe("groupMessageMiddleware", () => {
  it("unauthorized group message passes through to next (not intercepted)", async () => {
    const { bot } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      // no groups configured → not authorized
    });

    await bot.init();

    // Send a group message from an unauthorized group — middleware should call next()
    const unauthorizedGroupId = -1009999999998;
    await bot.handleUpdate(makeGroupTextUpdate(unauthorizedGroupId, "hello from unauthorized"));

    // No JSONL written for unauthorized group
    const filePath = path.join(tmpDir, "groups", String(unauthorizedGroupId), "messages.jsonl");
    expect(fs.existsSync(filePath)).toBe(false);

    // No agent invocation
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it("message in authorized group without mention → only logged, no agent invocation", async () => {
    const { bot } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: {} } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "just chatting"));

    // Message should be logged to JSONL
    const filePath = path.join(tmpDir, "groups", String(GROUP_MSG_CHAT_ID), "messages.jsonl");
    expect(fs.existsSync(filePath)).toBe(true);

    // Agent should NOT be invoked
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it("@mention triggers agent invocation", async () => {
    const { bot } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: {} } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "@test_bot what's up?", {
      entities: [{ type: "mention", offset: 0, length: 9 }],
    }));

    expect(mockRunAgent).toHaveBeenCalledOnce();
    // First arg is agentDir, second is threadId, third is the contextualized message
    const callArgs = mockRunAgent.mock.calls[0]!;
    expect(callArgs[0]).toBe("/tmp/agents/agent-1");
    expect(callArgs[2]).toContain("@test_bot what's up?");
  });

  it("reply to bot message triggers agent invocation", async () => {
    const { bot } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: {} } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "yes, exactly", {
      replyToMessageFromId: BOT_INFO.id,
    }));

    expect(mockRunAgent).toHaveBeenCalledOnce();
  });

  it("reply to non-bot message does not trigger", async () => {
    const { bot } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: {} } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "replying to human", {
      replyToMessageFromId: 777, // some other user, not the bot
    }));

    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it("creates new thread when none exists for agent", async () => {
    const { bot, config, saveConfig } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: {} } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "@test_bot hello", {
      entities: [{ type: "mention", offset: 0, length: 9 }],
    }));

    expect(mockThreadStoreCreate).toHaveBeenCalledWith("agent-1");
    expect(config.groups![String(GROUP_MSG_CHAT_ID)]!.threads["agent-1"]).toBe("new-thread-id");
    expect(saveConfig).toHaveBeenCalled();
  });

  it("reuses existing thread for agent", async () => {
    const { bot, saveConfig } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: { "agent-1": "existing-thread" } } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "@test_bot hello", {
      entities: [{ type: "mention", offset: 0, length: 9 }],
    }));

    expect(mockThreadStoreCreate).not.toHaveBeenCalled();
    // runAgent called with existing thread
    const callArgs = mockRunAgent.mock.calls[0]!;
    expect(callArgs[1]).toBe("existing-thread");
  });

  it("/new command resets context and rotates threads", async () => {
    const { bot, config, saveConfig, apiCalls } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: { "agent-1": "old-thread" } } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "/new"));

    // Thread rotated
    expect(mockThreadStoreCreate).toHaveBeenCalledWith("agent-1");
    expect(config.groups![String(GROUP_MSG_CHAT_ID)]!.threads["agent-1"]).toBe("new-thread-id");
    expect(saveConfig).toHaveBeenCalled();

    // Response sent to group
    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    expect(sendCalls.length).toBeGreaterThan(0);
    const text = sendCalls.find(c => (c.payload.text as string).includes("New conversation"))?.payload.text;
    expect(text).toContain("TestAgent");

    // Reset sentinel written to JSONL
    const filePath = path.join(tmpDir, "groups", String(GROUP_MSG_CHAT_ID), "messages.jsonl");
    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    const hasReset = lines.some(l => JSON.parse(l).type === "reset");
    expect(hasReset).toBe(true);
  });

  it("/stop command responds 'Nothing running.' when idle", async () => {
    const { bot, apiCalls } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: {} } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "/stop"));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    const stopMsg = sendCalls.find(c => (c.payload.text as string).includes("Nothing running"));
    expect(stopMsg).toBeDefined();
  });

  it("agent response is delivered to group chat, not DM", async () => {
    // Make runAgent call onResponse synchronously
    mockRunAgent.mockImplementation(async (_dir: string, _tid: string, _msg: string, callbacks: any) => {
      await callbacks.onResponse("agent-1", "t1", "Hello from agent!");
    });

    const { bot, apiCalls } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: { "agent-1": "t1" } } },
    });

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "@test_bot hi", {
      entities: [{ type: "mention", offset: 0, length: 9 }],
    }));

    // Wait a tick for the async runAgent to complete
    await new Promise(r => setTimeout(r, 50));

    const sendCalls = apiCalls.filter(c => c.method === "sendMessage");
    const responseMsgs = sendCalls.filter(c => (c.payload.text as string).includes("Hello from agent"));
    expect(responseMsgs.length).toBeGreaterThan(0);
    // Delivered to group chat, not DM
    expect(responseMsgs[0]!.payload.chat_id).toBe(GROUP_MSG_CHAT_ID);
  });

  it("resolveAgent returning null → no agent invocation", async () => {
    const { bot, resolveAgent } = createGroupTestBot({
      token: "t", chatId: PRIVATE_CHAT_ID, activeAgentId: "main",
      groups: { [String(GROUP_MSG_CHAT_ID)]: { name: "Test Group", threads: {} } },
    });

    resolveAgent.mockReturnValue(null);

    await bot.init();
    await bot.handleUpdate(makeGroupTextUpdate(GROUP_MSG_CHAT_ID, "@test_bot hello", {
      entities: [{ type: "mention", offset: 0, length: 9 }],
    }));

    expect(mockRunAgent).not.toHaveBeenCalled();
  });
});
