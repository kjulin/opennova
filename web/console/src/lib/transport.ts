import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://gkvurdzesutqxvvairkt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_YUzXBFiUBQGQpVRUg7X8nw_Q0X3viqm";

const REQUEST_TIMEOUT_MS = 30_000;

interface CloudSession {
  workspaceId: string;
  bearer: string;
}

// --- Session management ---

const SESSION_KEY = "nova_cloud_session";

export function getCloudSession(): CloudSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.workspaceId === "string" && typeof parsed.bearer === "string") {
      return parsed as CloudSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function setCloudSession(session: CloudSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearCloudSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

// --- Mode detection ---

export function isCloudMode(): boolean {
  return window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
}

// --- Supabase channel singleton ---

let supabase: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let channelWorkspaceId: string | null = null;
type ResponseHandler = (payload: { payload: { id: string; status: number; headers: Record<string, string>; body: string } }) => void;
const responseHandlers = new Set<ResponseHandler>();

function getChannel(session: CloudSession): RealtimeChannel {
  if (channel && channelWorkspaceId === session.workspaceId) return channel;

  // Clean up old channel
  if (channel) {
    channel.unsubscribe();
  }
  if (supabase) {
    supabase.removeAllChannels();
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { heartbeatIntervalMs: 25000 },
  });

  const channelName = `nova:${session.workspaceId}`;
  channel = supabase.channel(channelName);
  channelWorkspaceId = session.workspaceId;

  channel
    .on("broadcast", { event: "response" }, (payload) => {
      for (const handler of responseHandlers) {
        handler(payload as unknown as Parameters<ResponseHandler>[0]);
      }
    })
    .on("broadcast", { event: "pair_response" }, (payload) => {
      for (const handler of responseHandlers) {
        handler(payload as unknown as Parameters<ResponseHandler>[0]);
      }
    })
    .subscribe();

  return channel;
}

// --- Cloud fetch ---

async function cloudFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = getCloudSession();
  if (!session) throw new Error("Not paired — open pairing link from Telegram /admin");

  const id = crypto.randomUUID();
  const ch = getChannel(session);

  return new Promise<Response>((resolve, reject) => {
    const timeout = setTimeout(() => {
      responseHandlers.delete(handler);
      reject(new Error("Request timeout — daemon may be offline"));
    }, REQUEST_TIMEOUT_MS);

    const handler: ResponseHandler = (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = payload.payload as any;
      if (data.id !== id) return;

      clearTimeout(timeout);
      responseHandlers.delete(handler);

      if (data.status === 401) {
        clearCloudSession();
      }

      resolve(new Response(data.body, {
        status: data.status,
        headers: data.headers,
      }));
    };

    responseHandlers.add(handler);

    ch.send({
      type: "broadcast",
      event: "request",
      payload: {
        id,
        bearer: session.bearer,
        method: init?.method ?? "GET",
        path,
        body: init?.body ? String(init.body) : null,
      },
    });
  });
}

// --- Public API ---

/**
 * Drop-in replacement for fetch() that auto-detects local vs cloud mode.
 * In local mode, uses regular fetch. In cloud mode, routes through Supabase Broadcast.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!isCloudMode()) {
    return fetch(path, init);
  }
  return cloudFetch(path, init);
}

// --- Pairing ---

export async function exchangePairingCode(workspaceId: string, code: string): Promise<string> {
  // Create a temporary session just for the pairing channel
  const tempSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { heartbeatIntervalMs: 25000 },
  });

  const channelName = `nova:${workspaceId}`;
  const ch = tempSupabase.channel(channelName);

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ch.unsubscribe();
      tempSupabase.removeAllChannels();
      reject(new Error("Pairing timed out — code may have expired or daemon is offline"));
    }, 15_000);

    ch
      .on("broadcast", { event: "pair_response" }, (payload) => {
        clearTimeout(timeout);
        ch.unsubscribe();
        tempSupabase.removeAllChannels();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (payload as any).payload;
        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve(data.bearer as string);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          ch.send({
            type: "broadcast",
            event: "pair",
            payload: { code },
          });
        }
      });
  });
}
