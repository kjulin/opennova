import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { resolveWorkspace } from "../workspace.js";
import { detectAuth, hasClaudeCode, storeApiKey } from "../auth.js";

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

  // --- Channel configuration ---
  const reconfigure = workspaceExists && (
    fs.existsSync(path.join(workspace, "telegram.json")) ||
    fs.existsSync(path.join(workspace, "api.json"))
  );

  let configureChannels = true;
  if (reconfigure) {
    console.log("\nExisting channel configuration found.");
    const reconfChoice = await askChoice(rl, "What would you like to do?", [
      "Reconfigure channels",
      "Keep existing configuration",
    ]);
    configureChannels = reconfChoice === 0;
  }

  let enableTelegram = false;
  let enableApi = false;
  let telegramToken = "";
  let telegramChatId = "";
  let apiPort = 3000;
  let apiSecret = "";

  if (configureChannels) {
    const channelChoice = await askChoice(rl, "\nWhich channels would you like to enable?", [
      "Telegram",
      "HTTP API",
      "Both",
    ]);

    enableTelegram = channelChoice === 0 || channelChoice === 2;
    enableApi = channelChoice === 1 || channelChoice === 2;

    if (enableTelegram) {
      console.log("\n-- Telegram Setup --");
      telegramToken = await askRequired(rl, "Bot token (from @BotFather): ");
      telegramChatId = (await rl.question("Chat ID (your Telegram chat ID): ")).trim();
    }

    if (enableApi) {
      console.log("\n-- HTTP API Setup --");
      apiPort = await askPort(rl);
      apiSecret = (await rl.question("API secret (optional, press enter to skip): ")).trim();
    }
  }

  rl.close();

  // Write workspace
  if (workspaceExists && !configureChannels) {
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

    if (enableApi) {
      const config: Record<string, unknown> = { port: apiPort };
      if (apiSecret) config.secret = apiSecret;
      fs.writeFileSync(path.join(workspace, "api.json"), JSON.stringify(config, null, 2) + "\n");
      console.log("  Created api.json");
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

  const channels: string[] = [];
  if (enableTelegram || (!configureChannels && fs.existsSync(path.join(workspace, "telegram.json")))) {
    channels.push("Telegram");
  }
  if (enableApi || (!configureChannels && fs.existsSync(path.join(workspace, "api.json")))) {
    channels.push("HTTP API");
  }
  console.log(`  Channels:   ${channels.length > 0 ? channels.join(", ") : "None"}`);

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

async function askPort(rl: readline.Interface): Promise<number> {
  while (true) {
    const portStr = (await rl.question("Port [3000]: ")).trim();
    if (!portStr) return 3000;
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port >= 1 && port <= 65535) return port;
    console.log("Please enter a valid port number (1-65535).");
  }
}
