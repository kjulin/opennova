import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { resolveWorkspace } from "../workspace.js";
import { TrustLevel, TelegramConfigSchema, safeParseJsonFile } from "#core/index.js";
import { agentStore } from "#core/agents/index.js";
import { askRequired, pairTelegramChat } from "../telegram-pairing.js";

const VALID_LEVELS = TrustLevel.options;

export async function run() {
  const workspaceDir = resolveWorkspace();

  if (!fs.existsSync(workspaceDir)) {
    console.error(`No workspace found at ${workspaceDir}. Run 'nova init' first.`);
    process.exit(1);
  }

  const agentId = process.argv[3];

  // nova agent — list all agents
  if (!agentId) {
    const agents = agentStore.list();
    if (agents.size === 0) {
      console.log("No agents found.");
      return;
    }
    for (const [id, agent] of agents) {
      console.log(`${id}  ${agent.name} [${agent.trust}]`);
    }
    return;
  }

  // Verify agent exists
  const agent = agentStore.get(agentId);
  if (!agent) {
    console.error(`Agent not found: ${agentId}`);
    process.exit(1);
  }

  const subcommand = process.argv[4];

  // nova agent <id> — show agent details
  if (!subcommand) {
    console.log(`Name:       ${agent.name}`);
    console.log(`ID:         ${agentId}`);
    if (agent.description) console.log(`Desc:       ${agent.description}`);
    console.log(`Trust:      ${agent.trust}`);
    if ((agent as Record<string, unknown>).cwd) console.log(`Directory:  ${(agent as Record<string, unknown>).cwd}`);
    if (agent.directories && agent.directories.length > 0) {
      console.log(`Extra dirs: ${agent.directories.join(", ")}`);
    }
    if (agent.subagents) {
      console.log(`Subagents:  ${Object.keys(agent.subagents).join(", ")}`);
    }
    // Check for dedicated Telegram bot
    const telegramConfigPath = path.join(workspaceDir, "telegram.json");
    if (fs.existsSync(telegramConfigPath)) {
      const raw = safeParseJsonFile(telegramConfigPath, "telegram.json");
      if (raw) {
        const result = TelegramConfigSchema.safeParse(raw);
        if (result.success && result.data.agentBots?.[agentId]) {
          console.log(`Telegram:   dedicated bot`);
        }
      }
    }
    const agentDir = path.join(workspaceDir, "agents", agentId);
    const threadsDir = path.join(agentDir, "threads");
    if (fs.existsSync(threadsDir)) {
      const count = fs.readdirSync(threadsDir).filter((f) => f.endsWith(".jsonl")).length;
      console.log(`Threads:    ${count}`);
    }
    return;
  }

  // nova agent <id> trust <level>
  if (subcommand === "trust") {
    const level = process.argv[5];
    if (!level) {
      console.error("Usage: nova agent <id> trust <level>");
      console.error(`Levels: ${VALID_LEVELS.join(", ")}`);
      process.exit(1);
    }

    if (!VALID_LEVELS.includes(level as typeof VALID_LEVELS[number])) {
      console.error(`Invalid trust level: ${level}`);
      console.error(`Valid levels: ${VALID_LEVELS.join(", ")}`);
      process.exit(1);
    }

    agentStore.update(agentId, { trust: level as typeof VALID_LEVELS[number] });
    console.log(`Set ${agentId} trust to ${level}`);
    return;
  }

  // nova agent <id> telegram [remove]
  if (subcommand === "telegram") {
    const telegramConfigPath = path.join(workspaceDir, "telegram.json");
    const action = process.argv[5];

    if (action === "remove") {
      if (!fs.existsSync(telegramConfigPath)) {
        console.log("No Telegram configuration found.");
        return;
      }
      const raw = safeParseJsonFile(telegramConfigPath, "telegram.json");
      if (!raw) { console.error("Failed to read telegram.json"); process.exit(1); }
      const result = TelegramConfigSchema.safeParse(raw);
      if (!result.success) { console.error("Invalid telegram.json"); process.exit(1); }
      const telegramConfig = result.data;

      if (!telegramConfig.agentBots?.[agentId]) {
        console.log(`No dedicated Telegram bot configured for ${agentId}.`);
        return;
      }

      delete telegramConfig.agentBots[agentId];
      if (Object.keys(telegramConfig.agentBots).length === 0) {
        delete (telegramConfig as Record<string, unknown>).agentBots;
      }
      fs.writeFileSync(telegramConfigPath, JSON.stringify(telegramConfig, null, 2) + "\n", { mode: 0o600 });
      console.log(`Removed Telegram bot for ${agentId}.`);
      console.log("Restart the daemon for changes to take effect.");
      return;
    }

    // Setup flow
    const agentName = agent.name;

    console.log(`\n-- Telegram Bot Setup for ${agentName} --`);
    console.log("You'll need a bot token from @BotFather in Telegram.");
    console.log("Create a new bot (separate from your main Nova bot), then paste the token.\n");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const token = await askRequired(rl, "Bot token: ");
    rl.close();

    console.log("\nConnecting to Telegram...");
    const paired = await pairTelegramChat(token, `*${agentName} is connected!* \ud83c\udf89`);

    if (!paired) {
      console.log("Pairing timed out.");
      return;
    }

    console.log(`Paired with chat: ${paired.name} (${paired.chatId})`);

    // Read or create telegram.json
    let telegramConfig: Record<string, unknown> = {};
    if (fs.existsSync(telegramConfigPath)) {
      const raw = safeParseJsonFile(telegramConfigPath, "telegram.json");
      if (raw && typeof raw === "object") telegramConfig = raw as Record<string, unknown>;
    }

    const agentBots = (telegramConfig.agentBots as Record<string, unknown>) ?? {};
    agentBots[agentId] = { token, chatId: paired.chatId };
    telegramConfig.agentBots = agentBots;
    fs.writeFileSync(telegramConfigPath, JSON.stringify(telegramConfig, null, 2) + "\n", { mode: 0o600 });

    console.log(`\nDedicated bot configured for ${agentName}.`);
    console.log("Restart the daemon for changes to take effect.");
    return;
  }

  console.error(`Unknown subcommand: ${subcommand}`);
  console.error("Usage: nova agent [<id>] [trust <level>] [telegram [remove]]");
  process.exit(1);
}
