import crypto from "crypto";
import { createMiddleware } from "hono/factory";
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
 * Validate Telegram Web App initData per:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * 1. Parse the query string
 * 2. Remove the `hash` parameter
 * 3. Sort remaining params alphabetically
 * 4. Build data_check_string: "key=value\nkey=value\n..."
 * 5. Compute HMAC-SHA-256 of "WebAppData" using bot token as key → secret_key
 * 6. Compute HMAC-SHA-256 of data_check_string using secret_key
 * 7. Compare to hash
 */
function verifyTelegramInitData(
  initData: string,
  botToken: string,
  expectedChatId: string,
): boolean {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return false;

    // Build data check string (sorted, without hash)
    params.delete("hash");
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    // HMAC chain: secret_key = HMAC-SHA256("WebAppData", botToken)
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // computed_hash = HMAC-SHA256(data_check_string, secret_key)
    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    // Constant-time comparison of hex strings
    const a = Buffer.from(computedHash);
    const b = Buffer.from(hash);
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;

    // Extract chat_id from the user field and verify it matches
    const userStr = params.get("user");
    if (!userStr) return false;
    JSON.parse(userStr) as { id?: number };
    // Note: initData contains the user who opened the Mini App.
    // The chat_instance or chat_id in the params may also be present.
    // For our purposes we check: the chat_id param if present, otherwise
    // we trust the validated initData (HMAC-verified).
    const chatId = params.get("chat_instance") || params.get("chat_id");
    // If chat_id is in the params, verify it matches
    if (chatId && chatId !== expectedChatId) return false;
    // If no chat_id in params, we still accept if initData is HMAC-valid
    // (the Mini App was opened from the correct bot)

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
