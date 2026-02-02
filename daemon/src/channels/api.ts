import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { Config } from "../config.js";
import { loadAgents } from "../agents.js";
import { runThread } from "../runner.js";
import {
  listThreads,
  createThread,
  loadManifest,
  loadMessages,
  deleteThread,
  threadPath,
} from "../threads.js";
import { ApiConfigSchema, safeParseJsonFile, type ApiConfig } from "../schemas.js";

function loadApiConfig(): ApiConfig | null {
  const filePath = path.join(Config.workspaceDir, "api.json");
  if (!fs.existsSync(filePath)) return null;
  const raw = safeParseJsonFile(filePath, "api.json");
  if (raw === null) return null;
  const result = ApiConfigSchema.safeParse(raw);
  if (!result.success) {
    console.warn(`[api] invalid api.json: ${result.error.message}`);
    return null;
  }
  return result.data;
}

export function startApi() {
  const config = loadApiConfig();
  if (!config) {
    console.log("api channel skipped (no api.json)");
    return null;
  }

  const app = new Hono();
  const validId = /^[a-zA-Z0-9_-]+$/;

  // Auth middleware
  if (config.secret) {
    app.use("*", async (c, next) => {
      if (c.req.path === "/health") return next();
      const auth = c.req.header("Authorization");
      if (auth !== `Bearer ${config.secret}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    });
  }

  // GET /health
  app.get("/health", (c) => c.json({ ok: true }));

  // GET /agents
  app.get("/agents", (c) => {
    const agents = loadAgents();
    const list = [...agents.values()].map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
    }));
    return c.json(list);
  });

  // GET /agents/:id/threads
  app.get("/agents/:id/threads", (c) => {
    const agentId = c.req.param("id");
    if (!validId.test(agentId)) return c.json({ error: "Invalid agent ID" }, 400);
    const agentDir = path.join(Config.workspaceDir, "agents", agentId);
    if (!fs.existsSync(agentDir)) {
      return c.json({ error: "Agent not found" }, 404);
    }
    const threads = listThreads(agentDir).filter((t) => t.manifest.channel === "api");
    return c.json(threads);
  });

  // POST /agents/:id/threads
  app.post("/agents/:id/threads", (c) => {
    const agentId = c.req.param("id");
    if (!validId.test(agentId)) return c.json({ error: "Invalid agent ID" }, 400);
    const agentDir = path.join(Config.workspaceDir, "agents", agentId);
    if (!fs.existsSync(agentDir)) {
      return c.json({ error: "Agent not found" }, 404);
    }
    const threadId = createThread(agentDir, "api");
    return c.json({ id: threadId, agentId }, 201);
  });

  // GET /threads/:id — find thread across all agents
  app.get("/threads/:id", (c) => {
    const threadId = c.req.param("id");
    if (!validId.test(threadId)) return c.json({ error: "Invalid thread ID" }, 400);
    const result = findThread(threadId);
    if (!result) return c.json({ error: "Thread not found" }, 404);
    return c.json({
      id: threadId,
      agentId: result.agentId,
      manifest: result.manifest,
    });
  });

  // GET /threads/:id/messages
  app.get("/threads/:id/messages", (c) => {
    const threadId = c.req.param("id");
    if (!validId.test(threadId)) return c.json({ error: "Invalid thread ID" }, 400);
    const result = findThread(threadId);
    if (!result) return c.json({ error: "Thread not found" }, 404);
    const messages = loadMessages(result.filePath);
    return c.json(messages);
  });

  // DELETE /threads/:id
  app.delete("/threads/:id", (c) => {
    const threadId = c.req.param("id");
    if (!validId.test(threadId)) return c.json({ error: "Invalid thread ID" }, 400);
    const result = findThread(threadId);
    if (!result) return c.json({ error: "Thread not found" }, 404);
    deleteThread(result.agentDir, threadId);
    return c.json({ ok: true });
  });

  // POST /threads/:id/messages — SSE stream
  app.post("/threads/:id/messages", async (c) => {
    const threadId = c.req.param("id");
    if (!validId.test(threadId)) return c.json({ error: "Invalid thread ID" }, 400);
    const result = findThread(threadId);
    if (!result) return c.json({ error: "Thread not found" }, 404);
    if (result.manifest.channel !== "api") {
      return c.json({ error: "Cannot write to non-api thread" }, 403);
    }

    let body: { message: string };
    try {
      body = await c.req.json<{ message: string }>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!body.message) return c.json({ error: "message is required" }, 400);

    return streamSSE(c, async (stream) => {
      try {
        const res = await runThread(
          result.agentDir,
          threadId,
          body.message,
          {
            onAssistantMessage(text) {
              stream.writeSSE({ event: "status", data: JSON.stringify({ text }) });
            },
            onToolUse(_toolName, _input, summary) {
              stream.writeSSE({ event: "status", data: JSON.stringify({ text: summary }) });
            },
            onToolUseSummary(summary) {
              stream.writeSSE({ event: "status", data: JSON.stringify({ text: summary }) });
            },
          },
        );
        await stream.writeSSE({ event: "done", data: JSON.stringify({ text: res.text }) });
      } catch (err) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ text: (err as Error).message }),
        });
      }
    });
  });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`api channel started on port ${info.port}`);
  });

  return {
    app,
    server,
    port: config.port,
    shutdown() {
      server.close();
    },
  };
}

function findThread(threadId: string) {
  const agentsDir = path.join(Config.workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return null;

  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const agentDir = path.join(agentsDir, entry.name);
    const filePath = threadPath(agentDir, threadId);
    if (fs.existsSync(filePath)) {
      return {
        agentId: entry.name,
        agentDir,
        filePath,
        manifest: loadManifest(filePath),
      };
    }
  }
  return null;
}
