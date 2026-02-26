import { EventEmitter } from "events";

export type TaskEventType = "task:created" | "task:started" | "task:completed" | "task:canceled";

export interface TaskEventPayload {
  taskId: string;
}

interface TaskEvents {
  "task:created": [payload: TaskEventPayload];
  "task:started": [payload: TaskEventPayload];
  "task:completed": [payload: TaskEventPayload];
  "task:canceled": [payload: TaskEventPayload];
}

class TaskEventBus extends EventEmitter {
  emit<K extends keyof TaskEvents>(event: K, ...args: TaskEvents[K]): boolean {
    return super.emit(event, ...args);
  }
  on<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
}

export const taskBus = new TaskEventBus();
