import crypto from "crypto";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "#core/supabase.js";
import { getConsoleAccess, getWorkspaceId, getConfigValue, resolveWorkspace } from "./workspace.js";
import { createApp } from "./https.js";
import { log } from "./logger.js";
import type { Hono } from "hono";

export interface CloudRelay {
  shutdown: () => void;
}

interface RelayRequest {
  id: string;
  bearer: string;
  method: string;
  path: string;
  body: string | null;
}

function getCloudBearer(): string | null {
  const value = getConfigValue(resolveWorkspace(), "settings.cloudBearer");
  return typeof value === "string" && value ? value : null;
}

function validateBearer(bearer: string): boolean {
  const expected = getCloudBearer();
  if (!expected) return false;

  const a = Buffer.from(bearer);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handleRequest(app: Hono, channel: RealtimeChannel, payload: { payload: RelayRequest }) {
  const { id, bearer, method, path, body } = payload.payload;

  if (!validateBearer(bearer)) {
    channel.send({
      type: "broadcast",
      event: "response",
      payload: { id, status: 401, headers: {}, body: JSON.stringify({ error: "unauthorized" }) },
    });
    return;
  }

  try {
    const url = new URL(path, "http://localhost");
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body && method !== "GET" && method !== "HEAD") {
      init.body = body;
    }

    const request = new Request(url, init);
    const response = await app.fetch(request);

    const responseBody = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    channel.send({
      type: "broadcast",
      event: "response",
      payload: { id, status: response.status, headers: responseHeaders, body: responseBody },
    });
  } catch (err) {
    log.error("cloud-relay", `request ${id} failed:`, err);
    channel.send({
      type: "broadcast",
      event: "response",
      payload: { id, status: 500, headers: {}, body: JSON.stringify({ error: "internal error" }) },
    });
  }
}

export function startCloudRelay(workspaceDir: string): CloudRelay | null {
  if (getConsoleAccess() !== "cloud") return null;

  const workspaceId = getWorkspaceId(workspaceDir);
  const app = createApp(workspaceDir);

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { heartbeatIntervalMs: 25000 },
  });

  const channelName = `nova:${workspaceId}`;
  const channel = supabase.channel(channelName);

  channel
    .on("broadcast", { event: "request" }, (payload) => {
      handleRequest(app, channel, payload as unknown as { payload: RelayRequest });
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        log.info("cloud-relay", `subscribed to ${channelName}`);
      } else if (status === "CHANNEL_ERROR") {
        log.error("cloud-relay", `channel error on ${channelName}`);
      }
    });

  return {
    shutdown: () => {
      channel.unsubscribe();
      supabase.removeAllChannels();
      log.info("cloud-relay", "shutdown");
    },
  };
}
