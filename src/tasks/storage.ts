import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import type { Task, Step, CreateTaskInput, UpdateTaskInput } from "./types.js";

function tasksDir(workspaceDir: string): string {
  return path.join(workspaceDir, "tasks");
}

function tasksFile(workspaceDir: string): string {
  return path.join(tasksDir(workspaceDir), "tasks.json");
}

function historyFile(workspaceDir: string): string {
  return path.join(tasksDir(workspaceDir), "history.jsonl");
}

function ensureDir(workspaceDir: string): void {
  const dir = tasksDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadTasks(workspaceDir: string): Task[] {
  const file = tasksFile(workspaceDir);
  if (!fs.existsSync(file)) return [];
  try {
    const content = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(content);
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch {
    return [];
  }
}

function saveTasks(workspaceDir: string, tasks: Task[]): void {
  ensureDir(workspaceDir);
  const file = tasksFile(workspaceDir);
  fs.writeFileSync(file, JSON.stringify({ tasks }, null, 2));
}

function appendHistory(workspaceDir: string, task: Task): void {
  ensureDir(workspaceDir);
  const file = historyFile(workspaceDir);
  const entry = JSON.stringify({ ...task, archivedAt: new Date().toISOString() });
  fs.appendFileSync(file, entry + "\n");
}

export function getTask(workspaceDir: string, id: string): Task | undefined {
  const tasks = loadTasks(workspaceDir);
  return tasks.find((t) => t.id === id);
}

export interface CreateTaskOptions {
  workspaceDir: string;
  input: CreateTaskInput;
  createdBy: string;
  threadId: string;  // Thread must be created before task
}

export function createTask(options: CreateTaskOptions): Task {
  const { workspaceDir, input, createdBy, threadId } = options;
  const now = new Date().toISOString();

  const task: Task = {
    id: randomBytes(6).toString("hex"),
    title: input.title,
    description: input.description,
    owner: input.owner ?? createdBy,
    createdBy,
    status: "active",
    steps: [],
    threadId,
    createdAt: now,
    updatedAt: now,
  };

  const tasks = loadTasks(workspaceDir);
  tasks.push(task);
  saveTasks(workspaceDir, tasks);

  return task;
}

export function updateTask(
  workspaceDir: string,
  id: string,
  input: UpdateTaskInput,
): Task | undefined {
  const tasks = loadTasks(workspaceDir);
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return undefined;

  const task = tasks[index]!;
  const previousStatus = task.status;

  if (input.title !== undefined) task.title = input.title;
  if (input.description !== undefined) task.description = input.description;
  if (input.owner !== undefined) task.owner = input.owner;
  if (input.status !== undefined) task.status = input.status;
  task.updatedAt = new Date().toISOString();

  // If status changed to done, move to history
  if (input.status === "done" && previousStatus !== "done") {
    tasks.splice(index, 1);
    saveTasks(workspaceDir, tasks);
    appendHistory(workspaceDir, task);
  } else {
    tasks[index] = task;
    saveTasks(workspaceDir, tasks);
  }

  return task;
}

export function updateSteps(
  workspaceDir: string,
  id: string,
  steps: Step[],
): Task | undefined {
  const tasks = loadTasks(workspaceDir);
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return undefined;

  const task = tasks[index]!;
  task.steps = steps;
  task.updatedAt = new Date().toISOString();
  tasks[index] = task;
  saveTasks(workspaceDir, tasks);

  return task;
}

export function cancelTask(workspaceDir: string, id: string): boolean {
  const tasks = loadTasks(workspaceDir);
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;

  const task = tasks[index]!;
  tasks.splice(index, 1);
  saveTasks(workspaceDir, tasks);
  appendHistory(workspaceDir, task);

  return true;
}

export function loadHistory(
  workspaceDir: string,
  limit: number = 50,
): (Task & { archivedAt: string })[] {
  const file = historyFile(workspaceDir);
  if (!fs.existsSync(file)) return [];

  try {
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const history = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse(); // Most recent first

    return history.slice(0, limit);
  } catch {
    return [];
  }
}
