import { EventEmitter } from "events";
import type { ChannelType } from "@opennova/core";

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
