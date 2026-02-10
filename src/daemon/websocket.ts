import { WebSocketServer, WebSocket } from "ws";
import { loadAgents, loadFocuses } from "#core/index.js";
import { bus } from "./events.js";
import { log } from "./logger.js";
import {
  startCoworkSession,
  stopCoworkSession,
  getActiveSession,
  getActiveSessionState,
} from "./cowork/index.js";

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

  function sendTo(ws: WebSocket, message: WebSocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  wss.on("connection", (ws) => {
    clients.add(ws);
    log.info("websocket", `client connected (${clients.size} total)`);

    // Send connection confirmation
    ws.send(JSON.stringify({ type: "connected" }));

    // If there's an active cowork session, send its state
    const sessionState = getActiveSessionState();
    if (sessionState) {
      sendTo(ws, {
        type: "cowork:started",
        threadId: sessionState.threadId,
        agentId: sessionState.agentId,
        focusId: sessionState.focusId,
      });
    }

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WebSocketMessage;
        handleClientMessage(ws, msg, broadcast);
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

  bus.on("cowork:started", (payload) => {
    broadcast({ type: "cowork:started", ...payload });
  });

  bus.on("cowork:stopped", () => {
    broadcast({ type: "cowork:stopped" });
  });

  bus.on("cowork:error", (payload) => {
    broadcast({ type: "cowork:error", ...payload });
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

async function handleClientMessage(
  ws: WebSocket,
  msg: WebSocketMessage,
  broadcast: (message: WebSocketMessage) => void,
) {
  log.debug("websocket", `received: ${msg.type}`);

  switch (msg.type) {
    case "cowork:start": {
      const { vaultPath, agentId, focusId } = msg as {
        vaultPath?: string;
        agentId?: string;
        focusId?: string;
      };

      if (!vaultPath) {
        ws.send(JSON.stringify({ type: "cowork:error", error: "vaultPath is required" }));
        return;
      }

      // Default agent and focus if not provided
      const agents = loadAgents();
      const focuses = loadFocuses();
      const resolvedAgentId = agentId ?? (agents.has("coworker") ? "coworker" : Array.from(agents.keys())[0]);
      const resolvedFocusId = focusId ?? (focuses.has("collaborator") ? "collaborator" : Array.from(focuses.keys())[0]);

      if (!resolvedAgentId) {
        ws.send(JSON.stringify({ type: "cowork:error", error: "No agents found" }));
        return;
      }
      if (!resolvedFocusId) {
        ws.send(JSON.stringify({ type: "cowork:error", error: "No focuses found" }));
        return;
      }

      try {
        await startCoworkSession({
          vaultPath,
          agentId: resolvedAgentId,
          focusId: resolvedFocusId,
        });

        const state = getActiveSessionState();
        bus.emit("cowork:started", {
          threadId: state?.threadId ?? "",
          agentId: resolvedAgentId,
          focusId: resolvedFocusId,
        });
      } catch (err) {
        bus.emit("cowork:error", { error: (err as Error).message });
      }
      break;
    }

    case "cowork:stop": {
      await stopCoworkSession();
      bus.emit("cowork:stopped", {});
      break;
    }

    case "cowork:run": {
      const session = getActiveSession();
      if (session) {
        session.manualTrigger();
      }
      break;
    }

    case "suggestion:apply": {
      const { id } = msg as { id?: string };
      if (!id) return;

      const session = getActiveSession();
      if (session) {
        await session.applySuggestion(id);
      }
      break;
    }

    case "suggestion:reject": {
      const { id } = msg as { id?: string };
      if (!id) return;

      const session = getActiveSession();
      if (session) {
        session.rejectSuggestion(id);
      }
      break;
    }

    case "cowork:list-agents": {
      const agents = loadAgents();
      const agentList = Array.from(agents.values()).map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
      }));
      ws.send(JSON.stringify({ type: "cowork:agents", agents: agentList }));
      break;
    }

    case "cowork:list-focuses": {
      const focuses = loadFocuses();
      const focusList = Array.from(focuses.values()).map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
      }));
      ws.send(JSON.stringify({ type: "cowork:focuses", focuses: focusList }));
      break;
    }

    case "cowork:state": {
      const state = getActiveSessionState();
      if (state) {
        ws.send(JSON.stringify({
          type: "cowork:state",
          ...state,
        }));
      } else {
        ws.send(JSON.stringify({ type: "cowork:state", active: false }));
      }
      break;
    }

    case "ping":
      // Keep-alive, no action needed
      break;

    default:
      log.warn("websocket", `unknown message type: ${msg.type}`);
  }
}
