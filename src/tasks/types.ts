export interface Step {
  title: string;                  // Short label (max 60 chars)
  details?: string | undefined;   // Expanded description
  done: boolean;
  taskId?: string;                // Linked subtask
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
  status: "draft" | "active" | "done" | "canceled";
  steps: Step[];
  resources: Resource[];
  parentTaskId?: string;   // Parent task (set on subtasks)
  threadId?: string;       // Dedicated thread, created after task
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
}

export interface CreateTaskInput {
  title: string;
  description: string;
  owner?: string;          // Defaults to creating agent
  status?: "draft" | "active"; // Defaults to "active"
  parentTaskId?: string;   // Parent task ID (for subtasks)
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: "draft" | "active" | "done" | "canceled";
  owner?: string;
  threadId?: string;
}
