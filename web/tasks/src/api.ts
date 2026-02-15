export interface Step {
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  owner: string;
  createdBy: string;
  status: "active" | "waiting" | "done" | "canceled";
  steps: Step[];
  threadId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArchivedTask extends Task {
  archivedAt: string;
}

export interface Agent {
  id: string;
  name: string;
}

export interface TasksResponse {
  tasks: Task[];
  agents: Agent[];
  inFlightIds: string[];
}

const API_BASE = "/api";

export async function fetchTasks(): Promise<TasksResponse> {
  const res = await fetch(`${API_BASE}/tasks`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json();
}

export async function fetchHistory(limit: number = 50): Promise<ArchivedTask[]> {
  const res = await fetch(`${API_BASE}/tasks/history?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch history");
  const data = await res.json();
  return data.tasks;
}

export async function updateTask(
  id: string,
  updates: Partial<Pick<Task, "title" | "description" | "status" | "owner">>
): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update task");
  return res.json();
}

export async function completeTask(id: string): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks/${id}/complete`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to complete task");
  return res.json();
}

export async function cancelTask(id: string): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks/${id}/cancel`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to cancel task");
  return res.json();
}
