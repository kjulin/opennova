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
  projectId?: string;
  phaseId?: string;
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

export async function getOrCreateTaskThread(
  id: string,
  agentId: string
): Promise<{ threadId: string; task: Task }> {
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

// Projects API

export interface Phase {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "review" | "done";
}

export interface Project {
  id: string;
  lead: string;
  title: string;
  description: string;
  status: "draft" | "active" | "completed" | "cancelled";
  artifacts: string[];
  phases: Phase[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewStatus {
  isRunning: boolean;
  lastRunStarted: string | null;
}

export interface ProjectsResponse {
  projects: Project[];
  agents: Agent[];
  reviewStatus: ReviewStatus;
}

const PROJECTS_API_BASE = "/api/projects";

export async function fetchProjects(): Promise<ProjectsResponse> {
  const res = await fetch(PROJECTS_API_BASE);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function runProjectReviews(): Promise<void> {
  const res = await fetch(`${PROJECTS_API_BASE}/run`, {
    method: "POST",
  });
  if (res.status === 409) {
    throw new Error("Project review already in progress");
  }
  if (!res.ok) throw new Error("Failed to start project reviews");
}

export interface CreateProjectData {
  lead: string;
  title: string;
  description: string;
  phases: { title: string; description: string }[];
}

export async function createProject(data: CreateProjectData): Promise<Project> {
  const res = await fetch(PROJECTS_API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create project");
  return res.json();
}

export async function updateProjectStatus(
  id: string,
  status: "active" | "completed" | "cancelled"
): Promise<Project> {
  const res = await fetch(`${PROJECTS_API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update project");
  return res.json();
}

export async function updateProject(
  id: string,
  data: { title?: string; description?: string }
): Promise<Project> {
  const res = await fetch(`${PROJECTS_API_BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update project");
  return res.json();
}

export async function updateProjectFull(
  id: string,
  data: { title: string; description: string; phases: { id?: string; title: string; description: string }[] }
): Promise<Project> {
  const res = await fetch(`${PROJECTS_API_BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update project");
  return res.json();
}

export async function updatePhaseStatus(
  projectId: string,
  phaseId: string,
  status: "pending" | "in_progress" | "review" | "done"
): Promise<Project> {
  const res = await fetch(`${PROJECTS_API_BASE}/${projectId}/phases/${phaseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update phase");
  return res.json();
}
