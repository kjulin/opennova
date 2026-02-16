import { EventEmitter } from "events";
import type { ChannelType } from "#core/index.js";

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
  "thread:file": [payload: {
    agentId: string;
    threadId: string;
    channel: ChannelType;
    filePath: string;
    caption?: string;
    fileType?: "document" | "photo" | "audio" | "video";
  }];
  "thread:note": [payload: {
    agentId: string;
    threadId: string;
    channel: ChannelType;
    title: string;
    slug: string;
    message?: string;
  }];
  "thread:pin": [payload: {
    agentId: string;
    channel: ChannelType;
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
