import readline from "readline/promises";
import { Bot } from "grammy";

export async function askRequired(rl: readline.Interface, prompt: string): Promise<string> {
  while (true) {
    const value = (await rl.question(prompt)).trim();
    if (value) return value;
    console.log("This field is required.");
  }
}

export async function pairTelegramChat(
  token: string,
  welcomeMessage = "*Nova is connected!* \ud83c\udf89",
  timeoutMs = 120_000,
): Promise<{ chatId: string; name: string } | null> {
  const bot = new Bot(token);

  console.log("Waiting for a message from you in Telegram...");
  console.log("Open your bot and send any message (e.g. /start).\n");

  return new Promise<{ chatId: string; name: string } | null>((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      bot.stop();
      resolve(null);
    }, timeoutMs);

    bot.on("message:text", async (ctx) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);

      const chatId = String(ctx.chat.id);
      const name =
        ctx.chat.title ||
        [ctx.chat.first_name, ctx.chat.last_name].filter(Boolean).join(" ") ||
        chatId;

      await bot.api.sendMessage(ctx.chat.id, welcomeMessage, { parse_mode: "Markdown" }).catch(() => {});
      bot.stop();
      resolve({ chatId, name });
    });

    bot.catch((err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      bot.stop();
      console.log(`Telegram error: ${err.message}`);
      resolve(null);
    });

    bot.start().catch((err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      console.log(`Failed to connect — ${err.message}`);
      resolve(null);
    });
  });
}
