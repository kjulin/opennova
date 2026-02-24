// Manages Telegram pairing with a 2-step confirm/cancel flow.
// Only one pairing session can be active at a time.

import fs from "fs";
import path from "path";
import { Bot } from "grammy";
import { log } from "./logger.js";
import { safeParseJsonFile } from "#core/schemas.js";

interface TelegramJson {
  token?: string;
  chatId?: string;
  chatName?: string;
  activeAgentId?: string;
  activeThreadId?: string;
  agentBots?: Record<string, unknown>;
}

interface PendingUser {
  chatId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

type PairingState =
  | { status: "idle" }
  | { status: "waiting_for_message" }
  | { status: "message_received"; user: PendingUser }
  | { status: "error"; error: string };

export type PairingStatusResponse =
  | { status: "waiting_for_message" }
  | { status: "message_received"; user: PendingUser }
  | { status: "idle" }
  | { status: "error"; error: string };

let state: PairingState = { status: "idle" };
let activeBot: Bot | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

function readTelegram(workspaceDir: string): TelegramJson | null {
  const p = path.join(workspaceDir, "telegram.json");
  if (!fs.existsSync(p)) return null;
  const raw = safeParseJsonFile(p, "telegram.json");
  return (raw as TelegramJson) ?? null;
}

function writeTelegram(workspaceDir: string, data: TelegramJson): void {
  fs.writeFileSync(
    path.join(workspaceDir, "telegram.json"),
    JSON.stringify(data, null, 2) + "\n",
    { mode: 0o600 },
  );
}

function cleanupBot(): void {
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
  if (activeBot) {
    try {
      activeBot.stop();
    } catch {
      // ignore stop errors
    }
    activeBot = null;
  }
}

export async function startPairing(
  token: string,
  workspaceDir: string,
  onPaired?: () => void,
): Promise<{ status: "waiting_for_message" } | { error: string }> {
  // Stop any existing pairing session
  stopPairing();

  // Validate bot token via Telegram getMe API
  let getMeResult: { ok: boolean; result?: { first_name?: string } };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    getMeResult = await response.json() as typeof getMeResult;
  } catch {
    state = { status: "error", error: "Could not reach Telegram API. Check your internet connection." };
    return { error: state.error };
  }

  if (!getMeResult.ok) {
    state = { status: "error", error: "Invalid bot token — Telegram rejected it." };
    return { error: state.error };
  }

  // Save bot token to telegram.json immediately after validation
  const existing = readTelegram(workspaceDir) ?? {};
  writeTelegram(workspaceDir, { ...existing, token });

  log.info("pairing", "bot token validated, starting polling for first message");

  // Start a Grammy Bot to poll for the first message
  state = { status: "waiting_for_message" };

  const bot = new Bot(token);
  activeBot = bot;

  bot.on("message", (ctx) => {
    const from = ctx.message.from;
    if (!from || from.is_bot) return;

    const user: PendingUser = {
      chatId: ctx.chat.id,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
      username: from.username ?? null,
    };

    log.info("pairing", `message received from ${user.firstName} (chatId: ${user.chatId})`);
    state = { status: "message_received", user };

    // Stop polling after first message
    cleanupBot();
  });

  // 5-minute timeout
  timeoutTimer = setTimeout(() => {
    if (state.status === "waiting_for_message") {
      log.warn("pairing", "pairing timed out waiting for message");
      state = { status: "error", error: "Timed out waiting for a message. Please try again." };
      cleanupBot();
    }
  }, 5 * 60 * 1000);

  bot.start().catch((err) => {
    if (state.status === "waiting_for_message") {
      log.error("pairing", "bot polling error:", err);
      state = { status: "error", error: (err as Error).message };
      cleanupBot();
    }
  });

  return { status: "waiting_for_message" };
}

export function getPairingStatus(): PairingStatusResponse {
  return { ...state } as PairingStatusResponse;
}

export function confirmPairing(
  workspaceDir: string,
  onPaired?: () => void,
): { status: "paired"; chatId: number } | { error: string } {
  if (state.status !== "message_received") {
    return { error: "No pending pairing to confirm." };
  }

  const { user } = state;

  // Build chatName from user info
  let chatName = user.firstName;
  if (user.lastName) chatName += ` ${user.lastName}`;

  // Save chatId to telegram.json
  const existing = readTelegram(workspaceDir) ?? {};
  writeTelegram(workspaceDir, {
    ...existing,
    chatId: String(user.chatId),
    chatName,
  });

  log.info("pairing", `pairing confirmed for chatId ${user.chatId}`);
  state = { status: "idle" };

  if (onPaired) {
    try {
      onPaired();
    } catch (err) {
      log.error("pairing", "onPaired callback error:", err);
    }
  }

  return { status: "paired", chatId: user.chatId };
}

export function cancelPairing(): { status: "cancelled" } {
  log.info("pairing", "pairing cancelled");
  cleanupBot();
  state = { status: "idle" };
  return { status: "cancelled" };
}

export function unpair(workspaceDir: string): { status: "unpaired" } | { status: "not_paired" } {
  const existing = readTelegram(workspaceDir);
  if (!existing || (!existing.token && !existing.chatId)) {
    return { status: "not_paired" };
  }

  // Clear bot token and chatId
  const { token: _token, chatId: _chatId, chatName: _chatName, ...rest } = existing;
  writeTelegram(workspaceDir, rest);

  // Stop any running bot
  cleanupBot();
  state = { status: "idle" };

  log.info("pairing", "telegram unpaired");
  return { status: "unpaired" };
}

export function stopPairing(): void {
  cleanupBot();
  state = { status: "idle" };
}
