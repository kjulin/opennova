import fs from "fs";
import path from "path";
import readline from "readline/promises";
import { resolveWorkspace } from "../workspace.js";
import { SecurityLevel, TelegramConfigSchema, safeParseJsonFile } from "../schemas.js";
import { askRequired, pairTelegramChat } from "../telegram-pairing.js";

const VALID_LEVELS = SecurityLevel.options;

export async function run() {
  const workspaceDir = resolveWorkspace();
  const agentsDir = path.join(workspaceDir, "agents");

  if (!fs.existsSync(workspaceDir)) {
    console.error(`No workspace found at ${workspaceDir}. Run 'nova init' first.`);
    process.exit(1);
  }

  const agentId = process.argv[3];

  // nova agent — list all agents
  if (!agentId) {
    if (!fs.existsSync(agentsDir)) {
      console.log("No agents found.");
      return;
    }
    const dirs = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const dir of dirs) {
      const configPath = path.join(agentsDir, dir.name, "agent.json");
      if (!fs.existsSync(configPath)) continue;
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const security = config.security ? ` [${config.security}]` : "";
        console.log(`${dir.name}  ${config.name || dir.name}${security}`);
      } catch {
        console.log(dir.name);
      }
    }
    return;
  }

  // Verify agent exists
  const agentDir = path.join(agentsDir, agentId);
  const configPath = path.join(agentDir, "agent.json");
  if (!fs.existsSync(configPath)) {
    console.error(`Agent not found: ${agentId}`);
    process.exit(1);
  }

  const subcommand = process.argv[4];

  // nova agent <id> — show agent details
  if (!subcommand) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    console.log(`Name:       ${config.name || agentId}`);
    console.log(`ID:         ${agentId}`);
    if (config.description) console.log(`Desc:       ${config.description}`);
    console.log(`Security:   ${config.security || "(global default)"}`);
    if (config.cwd) console.log(`Directory:  ${config.cwd}`);
    if (config.directories && config.directories.length > 0) {
      console.log(`Extra dirs: ${config.directories.join(", ")}`);
    }
    if (config.allowedAgents && config.allowedAgents.length > 0) {
      console.log(`Delegates:  ${config.allowedAgents.join(", ")}`);
    }
    if (config.subagents) {
      console.log(`Subagents:  ${Object.keys(config.subagents).join(", ")}`);
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
    const threadsDir = path.join(agentDir, "threads");
    if (fs.existsSync(threadsDir)) {
      const count = fs.readdirSync(threadsDir).filter((f) => f.endsWith(".jsonl")).length;
      console.log(`Threads:    ${count}`);
    }
    return;
  }

  // nova agent <id> security <level>
  if (subcommand === "security") {
    const level = process.argv[5];
    if (!level) {
      console.error("Usage: nova agent <id> security <level>");
      console.error(`Levels: ${VALID_LEVELS.join(", ")}`);
      process.exit(1);
    }

    if (!VALID_LEVELS.includes(level as typeof VALID_LEVELS[number])) {
      console.error(`Invalid security level: ${level}`);
      console.error(`Valid levels: ${VALID_LEVELS.join(", ")}`);
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.security = level;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`Set ${agentId} security to ${level}`);
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
    const agentConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const agentName = agentConfig.name || agentId;

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
  console.error("Usage: nova agent [<id>] [security <level>] [telegram [remove]]");
  process.exit(1);
}
