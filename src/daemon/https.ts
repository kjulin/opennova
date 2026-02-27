import http from "http";
import fs from "fs";
import path from "path";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { log } from "./logger.js";
import { getConsoleAccess } from "./workspace.js";
import { loadAgents } from "#core/agents/index.js";
import {
  loadTasks,
  getTask,
  createTask,
  updateTask,
  completeTask,
  cancelTask,
  loadHistory,
  isTaskInFlight,
  isValidOwner,
  runTaskNow,
} from "#tasks/index.js";
import { createThread } from "#core/threads.js";
import { createNotesRouter } from "#notes/index.js";
import { createConsoleAgentsRouter } from "#api/console-agents.js";
import { createConsoleTriggersRouter } from "#api/console-triggers.js";
import { createConsoleSkillsRouter } from "#api/console-skills.js";
import { createConsoleSecretsRouter } from "#api/console-secrets.js";
import { createConsoleUsageRouter } from "#api/console-usage.js";
import { createConfigRouter } from "#api/config.js";

const PORT = parseInt(process.env.NOVA_PORT || "3838", 10);

export interface DaemonServer {
  port: number;
  hostname: string;
  shutdown: () => void;
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  return types[ext] || "application/octet-stream";
}

function createStaticHandler(baseDir: string, basePath: string) {
  return (c: Context) => {
    let filePath = c.req.path;
    log.debug("https", `static: path=${filePath} basePath=${basePath} baseDir=${baseDir}`);

    if (filePath.startsWith(basePath)) {
      filePath = filePath.slice(basePath.length);
    }

    if (filePath === "" || filePath === "/") {
      filePath = "/index.html";
    }

    const fullPath = path.join(baseDir, filePath);
    log.debug("https", `static: resolved=${fullPath} exists=${fs.existsSync(fullPath)}`);

    if (!fullPath.startsWith(baseDir)) {
      return c.notFound();
    }

    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      return c.notFound();
    }

    const ext = path.extname(fullPath).toLowerCase();
    const content = fs.readFileSync(fullPath);
    c.header("Content-Type", getMimeType(ext));
    // Use slice to get only the file data, not the entire underlying ArrayBuffer
    return c.body(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength));
  };
}

export function createApp(workspaceDir: string): Hono {
  // Serve webapp from package dist
  const webappDir = path.resolve(import.meta.dirname, "..", "webapp");
  log.info("https", `webapp dir: ${webappDir}`);
  log.info("https", `webapp exists: ${fs.existsSync(webappDir)}`);

  const app = new Hono();

  // Request logging middleware
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    log.info("https", `${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
  });

  // CORS middleware
  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  });

  // API routes
  app.get("/api/health", (c) => c.json({ ok: true }));

  // Tasks API
  app.get("/api/tasks", (c) => {
    const tasks = loadTasks(workspaceDir);
    const agents = loadAgents();
    const agentList = Array.from(agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
    }));
    const inFlightIds = tasks.filter((t) => isTaskInFlight(t.id)).map((t) => t.id);
    return c.json({ tasks, agents: agentList, inFlightIds });
  });

  app.post("/api/tasks", async (c) => {
    const body = await c.req.json();
    const { title, description, owner } = body;

    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }

    if (owner && !isValidOwner(workspaceDir, owner)) {
      return c.json({ error: `Agent not found: ${owner}. Owner must be 'user' or an existing agent ID.` }, 400);
    }

    // Create the task
    const task = createTask({
      workspaceDir,
      input: { title, description: description ?? "", owner },
      createdBy: "user",
    });

    // Create dedicated thread for the task
    const ownerAgentDir = path.join(workspaceDir, "agents", task.owner);
    const threadId = createThread(ownerAgentDir, { taskId: task.id });

    // Update task with thread ID
    const updatedTask = updateTask(workspaceDir, task.id, { threadId });

    return c.json(updatedTask ?? task, 201);
  });

  app.get("/api/tasks/history", (c) => {
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const history = loadHistory(workspaceDir, limit);
    return c.json({ tasks: history });
  });

  app.get("/api/tasks/:id", (c) => {
    const task = getTask(workspaceDir, c.req.param("id"));
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(task);
  });

  app.patch("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();

    if (body.owner && !isValidOwner(workspaceDir, body.owner)) {
      return c.json({ error: `Agent not found: ${body.owner}. Owner must be 'user' or an existing agent ID.` }, 400);
    }

    const task = updateTask(workspaceDir, id, body);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(task);
  });

  app.post("/api/tasks/:id/complete", (c) => {
    const id = c.req.param("id");
    const task = completeTask(workspaceDir, id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(task);
  });

  app.post("/api/tasks/:id/cancel", (c) => {
    const id = c.req.param("id");
    const task = cancelTask(workspaceDir, id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(task);
  });

  app.post("/api/tasks/:id/run", (c) => {
    const id = c.req.param("id");
    const err = runTaskNow(workspaceDir, id);
    if (err === "task not found") return c.json({ error: err }, 404);
    if (err) return c.json({ error: err }, 409);
    return c.json({ ok: true });
  });

  app.get("/api/agents", (c) => {
    const agents = loadAgents();
    const agentList = Array.from(agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
    }));
    return c.json({ agents: agentList });
  });

  // Notes API
  app.route("/api/notes", createNotesRouter(workspaceDir));

  // Console API
  app.route("/api/console/agents", createConsoleAgentsRouter(workspaceDir));
  app.route("/api/console/triggers", createConsoleTriggersRouter(workspaceDir));
  app.route("/api/console/skills", createConsoleSkillsRouter(workspaceDir));
  app.route("/api/console/secrets", createConsoleSecretsRouter(workspaceDir));
  app.route("/api/console/usage", createConsoleUsageRouter(workspaceDir));

  // Config API
  app.route("/api/config", createConfigRouter(workspaceDir));

  // Webapp at /web/tasklist (for Telegram mini app compatibility)
  app.get("/web/tasklist", (c) => c.redirect("/web/tasklist/"));
  app.get("/web/tasklist/*", createStaticHandler(webappDir, "/web/tasklist"));

  // Console app
  const consoleDir = path.resolve(import.meta.dirname, "..", "console");
  // Console SPA at root (catch-all — must be last)
  const consoleStaticHandler = createStaticHandler(consoleDir, "");
  app.get("/*", (c) => {
    const result = consoleStaticHandler(c);
    // SPA fallback: if static file not found, serve index.html for client-side routing
    if (result instanceof Response && result.status === 404) {
      const indexPath = path.join(consoleDir, "index.html");
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath);
        c.header("Content-Type", "text/html");
        return c.body(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength));
      }
    }
    return result;
  });

  return app;
}

export function startServer(workspaceDir: string): DaemonServer | null {
  const mode = getConsoleAccess();

  if (mode === "cloud") {
    log.info("https", "console access is 'cloud' — HTTP server not started");
    return null;
  }

  const hostname = mode === "network" ? "0.0.0.0" : "127.0.0.1";
  const app = createApp(workspaceDir);

  const server = serve({
    fetch: app.fetch,
    port: PORT,
    hostname,
    createServer: http.createServer,
  });

  log.info("https", `server listening on http://${hostname}:${PORT} (${mode} mode)`);

  return {
    port: PORT,
    hostname,
    shutdown: () => {
      server.close();
    },
  };
}
