import { EventEmitter } from "events";
import type { ChannelType, EditSuggestion } from "#core/index.js";

interface DaemonEvents {
  "thread:response": [payload: {
    agentId: string;
    threadId: string;
    channel: ChannelType;
    text: string;
  }];
  "thread:error": [payload: {
    agentId: string;
    threadId: string;
    channel: ChannelType;
    error: string;
  }];
  // Cowork events for WebSocket clients
  "cowork:message": [payload: {
    text: string;
    importance: "high" | "low";
  }];
  "cowork:suggestion": [payload: EditSuggestion];
  "cowork:status": [payload: {
    status: "thinking" | "working" | "idle";
    pendingFiles?: string[];
  }];
}

class TypedEmitter extends EventEmitter {
  emit<K extends keyof DaemonEvents>(event: K, ...args: DaemonEvents[K]): boolean {
    return super.emit(event, ...args);
  }
  on<K extends keyof DaemonEvents>(event: K, listener: (...args: DaemonEvents[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
}

export const bus = new TypedEmitter();
