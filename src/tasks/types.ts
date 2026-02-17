export interface Step {
  title: string;
  done: boolean;
  taskId?: string;  // Linked subtask
}

export interface Resource {
  type: "url" | "file";
  value: string;           // URL or absolute file path
  label?: string;          // Display name
}

export interface Task {
  id: string;
  title: string;
  description: string;
  owner: string;           // Agent ID or "user"
  createdBy: string;       // Agent ID or "user"
  status: "active" | "waiting" | "done" | "canceled";
  steps: Step[];
  resources: Resource[];
  threadId?: string;       // Dedicated thread, created after task
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
}

export interface CreateTaskInput {
  title: string;
  description: string;
  owner?: string;          // Defaults to creating agent
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: "active" | "waiting" | "done" | "canceled";
  owner?: string;
  threadId?: string;
}
