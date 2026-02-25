import { EventEmitter } from "events";
interface DaemonEvents {
  "thread:response": [payload: {
    agentId: string;
    threadId: string;
    channel: string;
    text: string;
  }];
  "thread:error": [payload: {
    agentId: string;
    threadId: string;
    channel: string;
    error: string;
  }];
  "thread:file": [payload: {
    agentId: string;
    threadId: string;
    channel: string;
    filePath: string;
    caption?: string;
    fileType?: "document" | "photo" | "audio" | "video";
  }];
  "thread:note": [payload: {
    agentId: string;
    threadId: string;
    channel: string;
    title: string;
    slug: string;
    message?: string;
  }];
  "thread:pin": [payload: {
    agentId: string;
    channel: string;
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
