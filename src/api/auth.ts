import crypto from "crypto";
import { Hono } from "hono";
import { log } from "#daemon/logger.js";
import { getApiToken } from "#daemon/workspace.js";

// --- Setup Token Store ---

interface SetupTokenEntry {
  token: string;
  timeout: NodeJS.Timeout;
}

const setupTokens = new Map<string, SetupTokenEntry>();

const SETUP_TOKEN_TTL_MS = 120_000; // 120 seconds

/**
 * Generate a one-time setup token with 120-second TTL.
 * Returns the token string (base64url, 24 random bytes).
 */
export function generateSetupToken(): string {
  const token = crypto.randomBytes(24).toString("base64url");

  // Auto-expire after TTL
  const timeout = setTimeout(() => {
    setupTokens.delete(token);
    log.debug("auth", `setup token expired: ${token.slice(0, 8)}…`);
  }, SETUP_TOKEN_TTL_MS);

  // Prevent the timeout from keeping the process alive
  timeout.unref();

  setupTokens.set(token, { token, timeout });
  log.info("auth", `setup token created: ${token.slice(0, 8)}… (TTL ${SETUP_TOKEN_TTL_MS / 1000}s)`);

  return token;
}

// --- Auth Setup Router ---

export function createAuthRouter(): Hono {
  const router = new Hono();

  // POST /setup — exchange a one-time setup token for the API bearer token
  router.post("/setup", async (c) => {
    const body = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
    const token = body.token;

    if (!token || !setupTokens.has(token)) {
      return c.json({ error: "Invalid or expired setup token" }, 401);
    }

    // One-time use: delete the token
    const entry = setupTokens.get(token)!;
    clearTimeout(entry.timeout);
    setupTokens.delete(token);

    const apiToken = getApiToken();
    if (!apiToken) {
      log.error("auth", "setup token exchanged but no API token configured");
      return c.json({ error: "API token not configured" }, 500);
    }

    log.info("auth", `setup token exchanged: ${token.slice(0, 8)}…`);
    return c.json({ apiToken });
  });

  return router;
}
