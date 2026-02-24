// Manages a single active Telegram pairing session.
// Only one pairing can be active at a time.

import fs from "fs";
import path from "path";
import { pairTelegramChat } from "./telegram-pairing.js";
import { log } from "./logger.js";
import { safeParseJsonFile } from "#core/schemas.js";

export interface PairingState {
  status: "idle" | "waiting" | "paired" | "error";
  chatId?: string;
  chatName?: string;
  error?: string;
}

interface TelegramJson {
  token?: string;
  chatId?: string;
  chatName?: string;
  activeAgentId?: string;
  activeThreadId?: string;
  agentBots?: Record<string, unknown>;
}

let state: PairingState = { status: "idle" };
let abortController: AbortController | null = null;

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

export function startPairing(
  token: string,
  workspaceDir: string,
  onPaired?: () => void,
): void {
  // Stop any existing pairing session
  stopPairing();

  state = { status: "waiting" };
  abortController = new AbortController();
  const { signal } = abortController;

  log.info("pairing", "starting Telegram pairing session");

  // Suppress console.log output from pairTelegramChat in daemon context
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    log.debug("pairing", String(args[0]), ...args.slice(1));
  };

  pairTelegramChat(token)
    .then((result) => {
      console.log = originalLog;

      if (signal.aborted) return;

      if (result) {
        log.info("pairing", `paired with chat ${result.chatId} (${result.name})`);

        // Merge into telegram.json
        const existing = readTelegram(workspaceDir) ?? {};
        writeTelegram(workspaceDir, {
          ...existing,
          chatId: result.chatId,
          chatName: result.name,
        });

        state = {
          status: "paired",
          chatId: result.chatId,
          chatName: result.name,
        };

        if (onPaired) {
          try {
            onPaired();
          } catch (err) {
            log.error("pairing", "onPaired callback error:", err);
          }
        }
      } else {
        log.warn("pairing", "pairing timed out or failed");
        state = { status: "error", error: "Pairing timed out. Please try again." };
      }
    })
    .catch((err) => {
      console.log = originalLog;

      if (signal.aborted) return;

      log.error("pairing", "pairing error:", err);
      state = { status: "error", error: (err as Error).message };
    });
}

export function getPairingStatus(): PairingState {
  return { ...state };
}

export function stopPairing(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  state = { status: "idle" };
}
