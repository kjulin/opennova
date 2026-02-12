import fs from "fs";
import path from "path";
import crypto from "crypto";
import { TaskSchema, type Task } from "./types.js";

function tasksDir(workspaceDir: string): string {
  return path.join(workspaceDir, "tasks");
}

function tasksPath(workspaceDir: string): string {
  return path.join(tasksDir(workspaceDir), "tasks.json");
}

export function loadTasks(workspaceDir: string): Task[] {
  const filePath = tasksPath(workspaceDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const result = TaskSchema.array().safeParse(raw);
    if (!result.success) {
      console.warn("Invalid tasks.json:", result.error.message);
      return [];
    }
    return result.data;
  } catch {
    return [];
  }
}

export function saveTasks(workspaceDir: string, tasks: Task[]): void {
  const dir = tasksDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tasksPath(workspaceDir), JSON.stringify(tasks, null, 2));
}

export interface CreateTaskData {
  agentId: string;
  assignee: string;
  title: string;
  rationale: string;
  instructions: string;
}

export function createTask(workspaceDir: string, data: CreateTaskData): Task {
  const tasks = loadTasks(workspaceDir);
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    agentId: data.agentId,
    assignee: data.assignee,
    title: data.title,
    rationale: data.rationale,
    instructions: data.instructions,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  saveTasks(workspaceDir, tasks);
  return task;
}

export interface UpdateTaskData {
  title?: string | undefined;
  rationale?: string | undefined;
  instructions?: string | undefined;
  remarks?: string | undefined;
  status?: "open" | "in_progress" | "done" | "failed" | "dismissed" | undefined;
  threadId?: string | undefined;
}

export function updateTask(
  workspaceDir: string,
  id: string,
  updates: UpdateTaskData
): Task | null {
  const tasks = loadTasks(workspaceDir);
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const task = tasks[index]!;
  if (updates.title !== undefined) task.title = updates.title;
  if (updates.rationale !== undefined) task.rationale = updates.rationale;
  if (updates.instructions !== undefined) task.instructions = updates.instructions;
  if (updates.remarks !== undefined) task.remarks = updates.remarks;
  if (updates.status !== undefined) task.status = updates.status;
  if (updates.threadId !== undefined) task.threadId = updates.threadId;
  task.updatedAt = new Date().toISOString();

  saveTasks(workspaceDir, tasks);
  return task;
}

export function deleteTask(workspaceDir: string, id: string): boolean {
  const tasks = loadTasks(workspaceDir);
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;

  tasks.splice(index, 1);
  saveTasks(workspaceDir, tasks);
  return true;
}

export function getTask(workspaceDir: string, id: string): Task | null {
  const tasks = loadTasks(workspaceDir);
  return tasks.find((t) => t.id === id) ?? null;
}

function historyPath(workspaceDir: string): string {
  return path.join(tasksDir(workspaceDir), "history.jsonl");
}

export function archiveTask(workspaceDir: string, id: string): boolean {
  const tasks = loadTasks(workspaceDir);
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;

  const task = tasks[index]!;
  const archivedTask = { ...task, archivedAt: new Date().toISOString() };

  // Append to history.jsonl
  const dir = tasksDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(historyPath(workspaceDir), JSON.stringify(archivedTask) + "\n");

  // Remove from tasks
  tasks.splice(index, 1);
  saveTasks(workspaceDir, tasks);

  return true;
}

export interface ArchivedTask extends Task {
  archivedAt: string;
}

export function loadArchivedTasks(workspaceDir: string, days: number = 7): ArchivedTask[] {
  const filePath = historyPath(workspaceDir);
  if (!fs.existsSync(filePath)) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const tasks: ArchivedTask[] = [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const task = JSON.parse(line) as ArchivedTask;
      if (new Date(task.archivedAt) >= cutoff) {
        tasks.push(task);
      }
    } catch {
      // Skip invalid lines
    }
  }

  return tasks.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}
