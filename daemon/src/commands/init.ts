import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { Bot } from "grammy";
import { resolveWorkspace } from "../workspace.js";
import { detectAuth, hasClaudeCode, storeApiKey } from "../auth.js";
import { TELEGRAM_HELP_MESSAGE } from "../channels/telegram-help.js";

export async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\nWelcome to Nova! Let's set up your workspace.\n");

  const workspace = resolveWorkspace();

  // Create workspace from template if it doesn't exist
  const workspaceExists = fs.existsSync(workspace);
  if (!workspaceExists) {
    const templateDir = path.resolve(import.meta.dirname, "..", "..", "workspace-template");
    fs.cpSync(templateDir, workspace, { recursive: true });
  }

  // --- Auth detection ---
  console.log("\n-- Authentication --");
  const auth = detectAuth(workspace);
  let authMethod = auth.method;

  if (auth.method === "claude-code") {
    console.log("Found Claude Code installation — nova will use your existing authentication.");
  } else if (auth.method === "api-key") {
    console.log(`Using ${auth.detail}.`);
  } else {
    // No auth found — check if they want to install Claude Code or provide an API key
    if (hasClaudeCode()) {
      console.log("Found Claude Code installation — nova will use your existing authentication.");
      authMethod = "claude-code";
    } else {
      console.log("Claude Code not found on this system.");
      console.log("Nova works best with Claude Code installed (included with your Anthropic subscription).");
      console.log("Install it from: https://docs.anthropic.com/en/docs/claude-code\n");

      const authChoice = await askChoice(rl, "How would you like to authenticate?", [
        "I'll install Claude Code first (recommended)",
        "Enter an Anthropic API key",
        "Skip for now",
      ]);

      if (authChoice === 0) {
        console.log("\nInstall Claude Code, then run 'nova daemon' to start.");
        authMethod = "none";
      } else if (authChoice === 1) {
        console.log("\nNote: API key usage is billed per token, which is significantly more");
        console.log("expensive than using Claude Code with an Anthropic subscription.\n");
        const apiKey = (await rl.question("Anthropic API key: ")).trim();
        if (apiKey) {
          storeApiKey(workspace, apiKey);
          authMethod = "api-key";
          console.log("API key saved.");
        } else {
          console.log("No key entered, skipping.");
          authMethod = "none";
        }
      } else {
        authMethod = "none";
      }
    }
  }

  // --- Telegram configuration ---
  const reconfigure = workspaceExists && fs.existsSync(path.join(workspace, "telegram.json"));

  let configureTelegram = true;
  if (reconfigure) {
    console.log("\nExisting Telegram configuration found.");
    const reconfChoice = await askChoice(rl, "What would you like to do?", [
      "Reconfigure Telegram",
      "Keep existing configuration",
    ]);
    configureTelegram = reconfChoice === 0;
  }

  let enableTelegram = false;
  let telegramToken = "";
  let telegramChatId = "";

  if (configureTelegram) {
    const channelChoice = await askChoice(rl, "\nEnable Telegram?", [
      "Yes",
      "No, skip for now",
    ]);

    enableTelegram = channelChoice === 0;

    if (enableTelegram) {
      console.log("\n-- Telegram Setup --");
      console.log("You'll need a bot token from @BotFather in Telegram.");
      console.log("Create a bot or use an existing one, then paste the token here.\n");
      telegramToken = await askRequired(rl, "Bot token: ");

      console.log("\nConnecting to Telegram...");
      const paired = await pairTelegramChat(telegramToken);
      if (paired) {
        telegramChatId = paired.chatId;
        console.log(`Paired with chat: ${paired.name} (${paired.chatId})`);
      } else {
        console.log("Pairing timed out. You can set the chat ID later with:");
        console.log("  nova config set telegram.chatId <your-chat-id>");
      }
    }
  }

  // --- Security level ---
  console.log("\n-- Security Level --");
  console.log("This controls what tools agents can use by default.");
  console.log("You can override this per agent later with: nova agent <id> security <level>\n");
  const securityChoice = await askChoice(rl, "Default security level:", [
    "sandbox       — Chat and web search only, no local file access",
    "standard      — File access and web, no shell commands",
    "unrestricted  — Full access including shell commands",
  ]);
  const securityLevel = (["sandbox", "standard", "unrestricted"] as const)[securityChoice];

  rl.close();

  // Write workspace
  if (workspaceExists && !configureTelegram) {
    console.log(`\nWorkspace at ${workspace} — keeping existing configuration.`);
  } else {
    if (workspaceExists) {
      console.log(`\nUpdating workspace at ${workspace}...`);
    } else {
      console.log(`\nCreating workspace at ${workspace}...`);
      console.log("  Copied default agents (nova, agent-builder).");
    }

    if (enableTelegram) {
      const config: Record<string, unknown> = {
        token: telegramToken,
        chatId: telegramChatId,
        activeAgentId: "nova",
      };
      fs.writeFileSync(path.join(workspace, "telegram.json"), JSON.stringify(config, null, 2) + "\n");
      console.log("  Created telegram.json");
    }
  }

  // Always write settings.json (security level is always chosen)
  fs.writeFileSync(
    path.join(workspace, "settings.json"),
    JSON.stringify({ defaultSecurity: securityLevel }, null, 2) + "\n",
  );
  console.log("  Saved settings.json");

  // --- Summary ---
  console.log("\n-- Setup Complete --\n");
  console.log(`  Workspace:  ${workspace}`);

  if (authMethod === "claude-code") {
    console.log("  Auth:       Claude Code (subscription)");
  } else if (authMethod === "api-key") {
    console.log("  Auth:       Anthropic API key");
  } else {
    console.log("  Auth:       Not configured");
  }

  console.log(`  Security:   ${securityLevel}`);

  const hasTelegram = enableTelegram || (!configureTelegram && fs.existsSync(path.join(workspace, "telegram.json")));
  console.log(`  Telegram:   ${hasTelegram ? "Configured" : "Not configured"}`);

  if (authMethod === "none") {
    console.log("\nNext: Install Claude Code or run 'nova init' again to configure authentication.");
  } else {
    console.log("\nNext: Start the daemon with 'nova daemon'");
  }
  console.log();
}

async function askChoice(rl: readline.Interface, question: string, options: string[]): Promise<number> {
  console.log(question);
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}. ${options[i]}`);
  }
  while (true) {
    const answer = (await rl.question("> ")).trim();
    const idx = parseInt(answer, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < options.length) {
      return idx;
    }
    console.log(`Please enter a number between 1 and ${options.length}.`);
  }
}

async function askRequired(rl: readline.Interface, prompt: string): Promise<string> {
  while (true) {
    const value = (await rl.question(prompt)).trim();
    if (value) return value;
    console.log("This field is required.");
  }
}

async function pairTelegramChat(
  token: string,
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

      await bot.api.sendMessage(ctx.chat.id, "*Nova is connected!* 🎉", { parse_mode: "Markdown" }).catch(() => {});
      await bot.api.sendMessage(ctx.chat.id, TELEGRAM_HELP_MESSAGE, { parse_mode: "Markdown" }).catch(() => {});
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
