import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { log } from "./logger.js";

const PORT = 3838;

export interface HttpsServer {
  port: number;
  hostname: string;
  shutdown: () => void;
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

  // Locate webapp directory
  const webappDir = path.join(workspaceDir, "webapp");
  if (!fs.existsSync(webappDir) || fs.readdirSync(webappDir).length === 0) {
    // Copy from template if it exists (go up two levels: dist/daemon -> dist -> root)
    const templateWebapp = path.resolve(import.meta.dirname, "..", "..", "workspace-template", "webapp");
    if (fs.existsSync(templateWebapp)) {
      fs.mkdirSync(webappDir, { recursive: true });
      fs.cpSync(templateWebapp, webappDir, { recursive: true });
      log.info("https", "copied webapp template to workspace");
    } else {
      fs.mkdirSync(webappDir, { recursive: true });
      log.warn("https", "no webapp directory found, serving empty");
    }
  }

  const server = https.createServer({ cert, key }, (req, res) => {
    handleRequest(req, res, webappDir);
  });

  server.listen(PORT, () => {
    log.info("https", `server listening on https://${certName}:${PORT}`);
  });

  server.on("error", (err) => {
    log.error("https", "server error:", err);
  });

  return {
    port: PORT,
    hostname: certName,
    shutdown: () => {
      server.close();
    },
  };
}

function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  webappDir: string
): void {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // CORS headers for all responses
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle preflight
  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // API routes
  if (url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Static file serving
  let filePath = url === "/" ? "/index.html" : url;
  filePath = path.join(webappDir, filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(webappDir)) {
    res.writeHead(403, corsHeaders);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, corsHeaders);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  const contentType = contentTypes[ext] || "application/octet-stream";

  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType, ...corsHeaders });
  res.end(content);
}
