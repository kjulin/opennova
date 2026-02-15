import https from "https";
import fs from "fs";
import path from "path";
import os from "os";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { log } from "./logger.js";
import { loadAgents } from "#core/agents.js";
import {
  loadTasks,
  getTask,
  createTask,
  updateTask,
  completeTask,
  cancelTask,
  loadHistory,
  isTaskInFlight,
} from "#tasks/index.js";
import { createThread } from "#core/threads.js";

const PORT = 3838;

export interface HttpsServer {
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

export function startHttpsServer(workspaceDir: string): HttpsServer | null {
  const certDir = path.join(os.homedir(), ".nova", "certs");

  if (!fs.existsSync(certDir)) {
    log.debug("https", "no certs directory found");
    return null;
  }

  const certFiles = fs.readdirSync(certDir).filter((f) => f.endsWith(".crt"));

  if (certFiles.length === 0) {
    log.debug("https", "no Tailscale certs found in ~/.nova/certs/");
    return null;
  }

  const certName = certFiles[0]!.replace(".crt", "");
  const certPath = path.join(certDir, `${certName}.crt`);
  const keyPath = path.join(certDir, `${certName}.key`);

  if (!fs.existsSync(keyPath)) {
    log.warn("https", `key file not found for cert: ${certName}`);
    return null;
  }

  const cert = fs.readFileSync(certPath);
  const key = fs.readFileSync(keyPath);

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
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
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

    // Create the task
    const task = createTask({
      workspaceDir,
      input: { title, description: description ?? "", owner },
      createdBy: "user",
    });

    // Create dedicated thread for the task
    const ownerAgentDir = path.join(workspaceDir, "agents", task.owner);
    const threadId = createThread(ownerAgentDir, "telegram", { taskId: task.id });

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

  app.get("/api/agents", (c) => {
    const agents = loadAgents();
    const agentList = Array.from(agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
    }));
    return c.json({ agents: agentList });
  });

  // Webapp at /web/tasklist (for Telegram mini app compatibility)
  app.get("/web/tasklist", (c) => c.redirect("/web/tasklist/"));
  app.get("/web/tasklist/*", createStaticHandler(webappDir, "/web/tasklist"));

  const server = serve({
    fetch: app.fetch,
    port: PORT,
    createServer: https.createServer,
    serverOptions: { cert, key },
  });

  log.info("https", `server listening on https://${certName}:${PORT}`);

  return {
    port: PORT,
    hostname: certName,
    shutdown: () => {
      server.close();
    },
  };
}
