import type { Update } from "grammy/types";

let updateId = 1;

export function makeTextUpdate(chatId: number, text: string): Update {
  return {
    update_id: updateId++,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private" },
      from: { id: chatId, is_bot: false, first_name: "Test" },
      text,
    },
  };
}

export function makeCallbackUpdate(chatId: number, data: string): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: "test-callback",
      chat_instance: "test",
      from: { id: chatId, is_bot: false, first_name: "Test" },
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private" },
        from: { id: 0, is_bot: true, first_name: "Bot" },
        text: "original",
      },
      data,
    },
  };
}
