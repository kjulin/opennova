export interface Step {
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  owner: string;           // Agent ID or "user"
  createdBy: string;       // Agent ID or "user"
  status: "active" | "waiting" | "done";
  steps: Step[];
  threadId: string;        // Dedicated thread, created with the task
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
  status?: "active" | "waiting" | "done";
  owner?: string;
}
