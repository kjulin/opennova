export interface Task {
  id: string;
  agentId: string;
  assignee: string;
  title: string;
  rationale: string;
  instructions: string;
  remarks?: string;
  status: "open" | "done" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
}

export interface TasklistResponse {
  tasks: Task[];
  agents: Agent[];
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
  status: "done" | "dismissed"
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
