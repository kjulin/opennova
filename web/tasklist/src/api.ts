export interface Task {
  id: string;
  agentId: string;
  assignee: string;
  title: string;
  rationale: string;
  instructions: string;
  remarks?: string;
  status: "open" | "in_progress" | "review" | "done" | "failed" | "dismissed";
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

export interface TasklistResponse {
  tasks: Task[];
  agents: Agent[];
  runningTaskIds: string[];
}

const API_BASE = "/api/tasklist";

export async function fetchTasks(): Promise<TasklistResponse> {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json();
}

export interface CreateTaskData {
  assignee: string;
  title: string;
  rationale: string;
  instructions: string;
}

export async function createTask(data: CreateTaskData): Promise<Task> {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create task");
  return res.json();
}

export async function updateTaskStatus(
  id: string,
  status: "open" | "review" | "done" | "dismissed"
): Promise<Task> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update task");
  return res.json();
}

export async function updateTaskRemarks(
  id: string,
  remarks: string
): Promise<Task> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remarks }),
  });
  if (!res.ok) throw new Error("Failed to update remarks");
  return res.json();
}

export async function updateTaskTitle(
  id: string,
  title: string
): Promise<Task> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to update title");
  return res.json();
}

export async function updateTaskAssignee(
  id: string,
  assignee: string
): Promise<Task> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignee }),
  });
  if (!res.ok) throw new Error("Failed to reassign task");
  return res.json();
}

export async function runTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}/run`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to start task");
  }
}

export async function getOrCreateTaskThread(
  id: string,
  agentId: string
): Promise<{ threadId: string; agentId: string; task: Task }> {
  const res = await fetch(`${API_BASE}/${id}/thread`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
  if (!res.ok) throw new Error("Failed to get/create task thread");
  return res.json();
}

export async function archiveTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}/archive`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to archive task");
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete task");
}

export async function fetchArchivedTasks(days: number = 7): Promise<ArchivedTask[]> {
  const res = await fetch(`${API_BASE}/archived?days=${days}`);
  if (!res.ok) throw new Error("Failed to fetch archived tasks");
  const data = await res.json();
  return data.tasks;
}
