import crypto from "crypto";
import { createMiddleware } from "hono/factory";
import { validateWebAppData } from "@grammyjs/validator";
import { getApiToken } from "../workspace.js";

// --- Types ---

interface TelegramConfig {
  token?: string;
  chatId?: string;
  chatName?: string;
}

// --- Bearer Token Auth ---

function verifyBearer(authHeader: string | undefined, apiToken: string): boolean {
  if (!authHeader) return false;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return false;
  const provided = parts[1]!;

  // Constant-time comparison
  const a = Buffer.from(provided);
  const b = Buffer.from(apiToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Telegram initData Auth ---

/**
 * Validate Telegram Web App initData using @grammyjs/validator.
 * After HMAC validation, also check that the chat_id matches the paired chat.
 */
function verifyTelegramInitData(
  initData: string,
  botToken: string,
  expectedChatId: string,
): boolean {
  try {
    const params = new URLSearchParams(initData);

    // HMAC-SHA-256 validation via grammy validator
    if (!validateWebAppData(botToken, params)) return false;

    // Verify chat_id matches paired chat (if present in initData)
    const chatId = params.get("chat_instance") || params.get("chat_id");
    if (chatId && chatId !== expectedChatId) return false;

    return true;
  } catch {
    return false;
  }
}

// --- Middleware ---

/**
 * Create the auth middleware.
 * Requires workspaceDir to read telegram.json for initData validation.
 */
export function createAuthMiddleware(workspaceDir: string, readTelegramConfig: () => TelegramConfig | null) {
  return createMiddleware(async (c, next) => {
    // Skip auth for GET /api/health (monitoring/readiness probes)
    if (c.req.method === "GET" && c.req.path === "/api/health") {
      return next();
    }

    // 1. Try Bearer token
    const apiToken = getApiToken();
    if (apiToken) {
      const authHeader = c.req.header("Authorization");
      if (verifyBearer(authHeader, apiToken)) {
        return next();
      }
    }

    // 2. Try Telegram initData
    const initData = c.req.header("X-Telegram-Init-Data");
    if (initData) {
      const telegram = readTelegramConfig();
      if (telegram?.token && telegram?.chatId) {
        if (verifyTelegramInitData(initData, telegram.token, telegram.chatId)) {
          return next();
        }
      }
    }

    // 3. Neither → 401
    c.header("WWW-Authenticate", "Bearer");
    return c.json({ error: "Unauthorized" }, 401);
  });
}
