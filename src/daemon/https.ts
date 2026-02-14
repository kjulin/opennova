import https from "https";
import fs from "fs";
import path from "path";
import os from "os";
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { createTasklistRouter } from "#tasklist/index.js";
import { log } from "./logger.js";

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

    if (filePath.startsWith(basePath)) {
      filePath = filePath.slice(basePath.length);
    }

    if (filePath === "" || filePath === "/") {
      filePath = "/index.html";
    }

    const fullPath = path.join(baseDir, filePath);

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

  // Locate webapp directories
  const workspaceWebappDir = path.join(workspaceDir, "webapp");
  if (!fs.existsSync(workspaceWebappDir) || fs.readdirSync(workspaceWebappDir).length === 0) {
    const templateWebapp = path.resolve(import.meta.dirname, "..", "..", "workspace-template", "webapp");
    if (fs.existsSync(templateWebapp)) {
      fs.mkdirSync(workspaceWebappDir, { recursive: true });
      fs.cpSync(templateWebapp, workspaceWebappDir, { recursive: true });
      log.info("https", "copied webapp template to workspace");
    } else {
      fs.mkdirSync(workspaceWebappDir, { recursive: true });
      log.warn("https", "no webapp directory found, serving empty");
    }
  }

  // Tasklist webapp - check both dist (built) and workspace-template (fallback)
  const tasklistDistDir = path.resolve(import.meta.dirname, "..", "..", "web", "tasklist", "dist");
  const tasklistTemplateDir = path.resolve(import.meta.dirname, "..", "..", "workspace-template", "tasklist");
  const tasklistDir = fs.existsSync(tasklistDistDir) ? tasklistDistDir :
                      fs.existsSync(tasklistTemplateDir) ? tasklistTemplateDir : null;

  const app = new Hono();

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
  app.route("/api/tasklist", createTasklistRouter(workspaceDir));

  // Tasklist webapp
  if (tasklistDir) {
    app.get("/web/tasklist", (c) => c.redirect("/web/tasklist/"));
    app.get("/web/tasklist/*", createStaticHandler(tasklistDir, "/web/tasklist"));
  }

  // Root webapp (backwards compat)
  app.get("/*", createStaticHandler(workspaceWebappDir, ""));

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
