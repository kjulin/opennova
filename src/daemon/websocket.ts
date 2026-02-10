import { WebSocketServer, WebSocket } from "ws";
import { bus } from "./events.js";
import { log } from "./logger.js";

const DEFAULT_PORT = 3737;

interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface WebSocketServerResult {
  port: number;
  shutdown: () => void;
}

export function startWebSocketServer(port = DEFAULT_PORT): WebSocketServerResult {
  const wss = new WebSocketServer({ port });
  const clients = new Set<WebSocket>();

  function broadcast(message: WebSocketMessage) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  wss.on("connection", (ws) => {
    clients.add(ws);
    log.info("websocket", `client connected (${clients.size} total)`);

    // Send connection confirmation
    ws.send(JSON.stringify({ type: "connected" }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WebSocketMessage;
        handleClientMessage(msg);
      } catch (err) {
        log.warn("websocket", "invalid message:", (err as Error).message);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      log.info("websocket", `client disconnected (${clients.size} remaining)`);
    });

    ws.on("error", (err) => {
      log.error("websocket", "client error:", err.message);
      clients.delete(ws);
    });
  });

  wss.on("error", (err) => {
    log.error("websocket", "server error:", err.message);
  });

  // Forward bus events to WebSocket clients
  bus.on("cowork:message", (payload) => {
    broadcast({ type: "cowork:message", ...payload });
  });

  bus.on("cowork:suggestion", (payload) => {
    broadcast({ type: "cowork:suggestion", ...payload });
  });

  bus.on("cowork:status", (payload) => {
    broadcast({ type: "cowork:status", ...payload });
  });

  log.info("websocket", `server started on port ${port}`);

  return {
    port,
    shutdown() {
      for (const client of clients) {
        client.close();
      }
      wss.close();
      log.info("websocket", "server stopped");
    },
  };
}

function handleClientMessage(msg: WebSocketMessage) {
  log.debug("websocket", `received: ${msg.type}`);

  switch (msg.type) {
    case "suggestion:apply":
      // TODO: Emit event for TUI/cowork session to apply suggestion
      bus.emit("cowork:status", { status: "working" });
      break;

    case "suggestion:reject":
      // TODO: Emit event for TUI/cowork session to reject suggestion
      break;

    case "cowork:run":
      // TODO: Trigger manual cowork run
      break;

    case "ping":
      // Keep-alive, no action needed
      break;

    default:
      log.warn("websocket", `unknown message type: ${msg.type}`);
  }
}
