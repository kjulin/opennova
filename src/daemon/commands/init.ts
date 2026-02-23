import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { resolveWorkspace } from "../workspace.js";
import { detectAuth, hasClaudeCode, storeApiKey } from "../auth.js";
import { askRequired, pairTelegramChat } from "../telegram-pairing.js";
import { TELEGRAM_HELP_MESSAGE } from "../channels/telegram-help.js";
import { Config } from "#core/config.js";
import { downloadEmbeddingModel, isModelAvailable } from "#core/episodic/index.js";

function parseInitArgs(): { workspace: string | undefined; nonInteractive: boolean } {
  const args = process.argv.slice(3); // skip node, cli.js, "init"
  let workspace: string | undefined;
  let nonInteractive = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace" && i + 1 < args.length) {
      workspace = args[++i];
    } else if (args[i] === "--non-interactive") {
      nonInteractive = true;
    }
  }

  return { workspace, nonInteractive };
}

export async function run() {
  const flags = parseInitArgs();
  const workspace = resolveWorkspace(flags.workspace);

  if (flags.nonInteractive) {
    await runNonInteractive(workspace);
  } else {
    await runInteractive(workspace);
  }
}

async function runNonInteractive(workspace: string) {
  console.log("\nNova init (non-interactive)\n");

  // Create workspace from template if it doesn't exist
  const workspaceExists = fs.existsSync(workspace);
  if (!workspaceExists) {
    const templateDir = path.resolve(import.meta.dirname, "..", "..", "workspace-template");
    fs.cpSync(templateDir, workspace, { recursive: true });
    console.log(`  Created workspace at ${workspace}`);
  } else {
    console.log(`  Workspace already exists at ${workspace}`);
  }

  // Detect auth (report only, don't ask)
  const auth = detectAuth(workspace);
  let authMethod = auth.method;
  if (auth.method === "none" && hasClaudeCode()) {
    authMethod = "claude-code";
  }

  // Download embedding model
  Config.workspaceDir = workspace;
  if (!isModelAvailable()) {
    console.log("  Downloading embedding model (all-MiniLM-L6-v2, ~80MB)...");
    try {
      let lastPercent = 0;
      await downloadEmbeddingModel((file, percent) => {
        if (percent >= lastPercent + 10) {
          process.stdout.write(`  ${file}: ${percent}%\r`);
          lastPercent = percent;
        }
      });
      console.log("  Embedding model downloaded successfully.");
    } catch (err) {
      console.log(`  Warning: Failed to download embedding model: ${(err as Error).message}`);
    }
  }

  // Summary
  console.log("\n-- Setup Complete --\n");
  console.log(`  Workspace:  ${workspace}`);
  if (authMethod === "claude-code") {
    console.log("  Auth:       Claude Code (subscription)");
  } else if (authMethod === "api-key") {
    console.log("  Auth:       Anthropic API key");
  } else {
    console.log("  Auth:       Not configured");
  }
  console.log("  Telegram:   Skipped (non-interactive)");
  console.log();
}

async function runInteractive(workspace: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\nWelcome to Nova! Let's set up your workspace.\n");

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
      const paired = await pairTelegramChat(telegramToken, `*Nova is connected!* \ud83c\udf89\n\n${TELEGRAM_HELP_MESSAGE}`);
      if (paired) {
        telegramChatId = paired.chatId;
        console.log(`Paired with chat: ${paired.name} (${paired.chatId})`);
      } else {
        console.log("Pairing timed out. You can set the chat ID later with:");
        console.log("  nova config set telegram.chatId <your-chat-id>");
      }
    }
  }

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
      fs.writeFileSync(path.join(workspace, "telegram.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
      console.log("  Created telegram.json");
    }
  }

  // --- Embedding model ---
  Config.workspaceDir = workspace;
  if (!isModelAvailable()) {
    console.log("\n-- Episodic Memory --");
    console.log("Downloading embedding model (all-MiniLM-L6-v2, ~80MB)...");
    try {
      let lastPercent = 0;
      await downloadEmbeddingModel((file, percent) => {
        if (percent >= lastPercent + 10) {
          process.stdout.write(`  ${file}: ${percent}%\r`);
          lastPercent = percent;
        }
      });
      console.log("  Embedding model downloaded successfully.");
    } catch (err) {
      console.log(`  Warning: Failed to download embedding model: ${(err as Error).message}`);
      console.log("  Episodic memory will be unavailable until the model is downloaded.");
    }
  }

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
