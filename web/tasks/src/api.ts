export interface Step {
  title: string;
  done: boolean;
  taskId?: string;  // Linked subtask
}

export interface Resource {
  type: "url" | "file";
  value: string;
  label?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  owner: string;
  createdBy: string;
  status: "active" | "waiting" | "done" | "canceled";
  steps: Step[];
  resources: Resource[];
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

export async function runTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${id}/run`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to run task");
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  owner?: string;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create task");
  return res.json();
}

// Notes API

export interface Note {
  agent: string;
  title: string;
  slug: string;
  content: string;
}

export async function fetchNote(agent: string, slug: string): Promise<Note> {
  const res = await fetch(`${API_BASE}/notes/${agent}/${slug}`);
  if (!res.ok) throw new Error("Note not found");
  return res.json();
}

export async function updateNote(agent: string, slug: string, content: string): Promise<Note> {
  const res = await fetch(`${API_BASE}/notes/${agent}/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to update note");
  return res.json();
}

export async function deleteNoteApi(agent: string, slug: string): Promise<void> {
  const res = await fetch(`${API_BASE}/notes/${agent}/${slug}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete note");
}
