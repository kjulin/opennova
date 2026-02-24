import { describe, it, expect, vi } from "vitest";
import { Bot } from "grammy";
import { chatGuard } from "../../../src/daemon/channels/telegram-utils.js";
import { makeTextUpdate, makeCallbackUpdate } from "./telegram-test-utils.js";

const AUTHORIZED_CHAT = "12345";
const UNAUTHORIZED_CHAT = 99999;

describe("telegram chat guard", () => {
  function createGuardedBot() {
    const bot = new Bot("dummy:token", { botInfo: {
      id: 0, is_bot: true, first_name: "Test",
      username: "test_bot", can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    }});
    bot.use(chatGuard(AUTHORIZED_CHAT));
    return bot;
  }

  it("allows messages from authorized chat", async () => {
    const bot = createGuardedBot();
    const handler = vi.fn();
    bot.on("message:text", handler);
    await bot.init();

    await bot.handleUpdate(makeTextUpdate(Number(AUTHORIZED_CHAT), "hello"));

    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects messages from unauthorized chat", async () => {
    const bot = createGuardedBot();
    const handler = vi.fn();
    bot.on("message:text", handler);
    await bot.init();

    await bot.handleUpdate(makeTextUpdate(UNAUTHORIZED_CHAT, "hello"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects callback queries from unauthorized chat", async () => {
    const bot = createGuardedBot();
    const handler = vi.fn();
    bot.on("callback_query:data", handler);
    await bot.init();

    await bot.handleUpdate(makeCallbackUpdate(UNAUTHORIZED_CHAT, "agent:test"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects updates with no chat", async () => {
    const bot = createGuardedBot();
    const handler = vi.fn();
    bot.on("message:text", handler);
    await bot.init();

    // Minimal update with no chat context
    await bot.handleUpdate({ update_id: 999 });

    expect(handler).not.toHaveBeenCalled();
  });
});
