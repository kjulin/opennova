import { Hono } from "hono";
import {
  startPairing,
  getPairingStatus,
  confirmPairing,
  cancelPairing,
  unpair,
} from "../pairing-manager.js";

export function createTelegramPairRouter(workspaceDir: string, onPaired?: () => void): Hono {
  const app = new Hono();

  // POST /start — validate bot token, start polling
  app.post("/start", async (c) => {
    const { botToken } = await c.req.json<{ botToken: string }>();
    if (!botToken) {
      return c.json({ error: "botToken is required" }, 400);
    }
    const result = await startPairing(botToken, workspaceDir, onPaired);
    if ("error" in result) {
      return c.json(result, 400);
    }
    return c.json(result);
  });

  // GET /status — poll for message
  app.get("/status", (c) => {
    return c.json(getPairingStatus());
  });

  // POST /confirm — save chatId
  app.post("/confirm", (c) => {
    const result = confirmPairing(workspaceDir, onPaired);
    if ("error" in result) {
      return c.json(result, 400);
    }
    return c.json(result);
  });

  // POST /cancel — clear pairing without saving
  app.post("/cancel", (c) => {
    return c.json(cancelPairing());
  });

  return app;
}

export function createTelegramUnpairRouter(workspaceDir: string): Hono {
  const app = new Hono();

  // POST / — unpair completely
  app.post("/", (c) => {
    const result = unpair(workspaceDir);
    return c.json(result);
  });

  return app;
}
