import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import { Config } from "../config.js";
import { bus } from "../events.js";
import { loadAgents } from "../agents.js";
import { runThread } from "../runner.js";
import { listThreads, createThread } from "../threads.js";
import { createTriggerMcpServer } from "../triggers.js";

interface TelegramConfig {
  token: string;
  chatId: string;
  activeAgentId: string;
  activeThreadId?: string;
}

function loadTelegramConfig(): TelegramConfig | null {
  const filePath = path.join(Config.workspaceDir, "telegram.json");
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function saveTelegramConfig(config: TelegramConfig): void {
  fs.writeFileSync(path.join(Config.workspaceDir, "telegram.json"), JSON.stringify(config, null, 2));
}

function resolveThreadId(config: TelegramConfig, agentDir: string): string {
  // Use active thread if it still exists on disk
  if (config.activeThreadId) {
    const file = path.join(agentDir, "threads", `${config.activeThreadId}.jsonl`);
    if (fs.existsSync(file)) return config.activeThreadId;
  }
  // Fall back to most recent telegram thread for this agent
  const threads = listThreads(agentDir)
    .filter((t) => t.manifest.channel === "telegram")
    .sort((a, b) => b.manifest.updatedAt.localeCompare(a.manifest.updatedAt));
  const id = threads.length > 0 ? threads[0]!.id : createThread(agentDir, "telegram");
  config.activeThreadId = id;
  saveTelegramConfig(config);
  return id;
}

export function startTelegram() {
  const config = loadTelegramConfig();
  if (!config) {
    console.log("telegram channel skipped (no telegram.json)");
    return null;
  }
  if (!config.chatId) {
    console.log("telegram channel skipped (chatId not configured)");
    return null;
  }

  const bot = new TelegramBot(config.token, { polling: true });
  console.log("telegram channel started");

  bus.on("thread:response", (payload) => {
    if (payload.channel !== "telegram") return;
    bot.sendMessage(config.chatId, payload.text, { parse_mode: "Markdown" }).catch((err) => {
      console.error("[telegram] failed to deliver thread:response:", err);
    });
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    let text = msg.text;
    const agents = loadAgents();

    if (!text) return;
    if (String(chatId) !== config.chatId) return;

    // Handle /new command
    if (text === "/new") {
      const agentDir = path.join(Config.workspaceDir, "agents", config.activeAgentId);
      const id = createThread(agentDir, "telegram");
      config.activeThreadId = id;
      saveTelegramConfig(config);
      await bot.sendMessage(chatId, "New thread started");
      return;
    }

    // Handle /agent command
    if (text.startsWith("/agent")) {
      const parts = text.split(/\s+/);
      const agentName = parts[1];

      if (!agentName) {
        const list = [...agents.values()]
          .map((a) => (a.id === config.activeAgentId ? `*${a.name}* (active)` : a.name))
          .join("\n");
        await bot.sendMessage(chatId, `*Agents:*\n${list}`, { parse_mode: "Markdown" });
        return;
      }

      if (!agents.has(agentName)) {
        await bot.sendMessage(chatId, `Unknown agent: ${agentName}`);
        return;
      }

      config.activeAgentId = agentName;
      delete config.activeThreadId;
      saveTelegramConfig(config);
      const switched = agents.get(agentName)!;
      await bot.sendMessage(chatId, `Switched to *${switched.name}*`, { parse_mode: "Markdown" });

      // Let the new agent greet the user
      text = "greet the user";
    }

    // Resolve active agent
    const agentId = config.activeAgentId;
    const agent = agents.get(agentId);
    if (!agent) {
      await bot.sendMessage(chatId, `Agent "${agentId}" not found. Use /agent to switch.`);
      return;
    }

    const agentDir = path.join(Config.workspaceDir, "agents", agent.id);
    const threadId = resolveThreadId(config, agentDir);

    console.log(`[telegram:${chatId}] [${agent.id}] ${text}`);

    const typingInterval = setInterval(() => {
      bot.sendChatAction(chatId, "typing");
    }, 4000);
    bot.sendChatAction(chatId, "typing");

    let statusMessageId: number | undefined;

    async function updateStatus(status: string) {
      const truncated = status.length > 100 ? status.slice(0, 100) + "…" : status;
      const formatted = `_${truncated}_`;
      if (statusMessageId) {
        await bot.editMessageText(formatted, { chat_id: chatId, message_id: statusMessageId, parse_mode: "Markdown" }).catch(() => {});
      } else {
        const sent = await bot.sendMessage(chatId, formatted, { parse_mode: "Markdown" }).catch(() => undefined);
        if (sent) statusMessageId = sent.message_id;
      }
    }

    async function deleteStatus() {
      if (statusMessageId) {
        await bot.deleteMessage(chatId, statusMessageId).catch(() => {});
        statusMessageId = undefined;
      }
    }

    try {
      await runThread(
        agentDir, threadId, text,
        {
          onAssistantMessage(text) {
            updateStatus(text);
          },
          onToolUse(_toolName, _input, summary) {
            updateStatus(summary);
          },
          onToolUseSummary(summary) {
            updateStatus(summary);
          },
        },
        { triggers: createTriggerMcpServer(agentDir, "telegram") },
      );
    } catch (err) {
      console.error("claude error:", err);
      await bot.sendMessage(chatId, `Error: ${(err as Error).message}`);
    } finally {
      clearInterval(typingInterval);
      await deleteStatus();
    }
  });

  return {
    bot,
    shutdown() {
      bot.stopPolling();
    },
  };
}
