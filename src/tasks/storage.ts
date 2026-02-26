import fs from "fs";
import path from "path";
import type { Task, Step, Resource, CreateTaskInput, UpdateTaskInput } from "./types.js";

interface TasksData {
  tasks: Task[];
  nextId: number;
}

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

function loadTasksData(workspaceDir: string): TasksData {
  const file = tasksFile(workspaceDir);
  if (!fs.existsSync(file)) return { tasks: [], nextId: 1 };
  try {
    const content = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(content);
    return {
      tasks: Array.isArray(data.tasks)
        ? data.tasks.map((t: Task) => ({
            ...t,
            resources: Array.isArray(t.resources) ? t.resources : [],
          }))
        : [],
      nextId: typeof data.nextId === "number" ? data.nextId : 1,
    };
  } catch {
    return { tasks: [], nextId: 1 };
  }
}

export function loadTasks(workspaceDir: string): Task[] {
  return loadTasksData(workspaceDir).tasks;
}

function saveTasksData(workspaceDir: string, data: TasksData): void {
  ensureDir(workspaceDir);
  const file = tasksFile(workspaceDir);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function appendHistory(workspaceDir: string, task: Task): void {
  ensureDir(workspaceDir);
  const file = historyFile(workspaceDir);
  const entry = JSON.stringify({ ...task, archivedAt: new Date().toISOString() });
  fs.appendFileSync(file, entry + "\n");
}

/**
 * Check if an owner value is valid: either "user" or an existing agent
 * (a directory under agents/ with an agent.json file).
 */
export function isValidOwner(workspaceDir: string, owner: string): boolean {
  if (owner === "user") return true;
  const configPath = path.join(workspaceDir, "agents", owner, "agent.json");
  return fs.existsSync(configPath);
}

export function getTask(workspaceDir: string, id: string): Task | undefined {
  const tasks = loadTasks(workspaceDir);
  const active = tasks.find((t) => t.id === id);
  if (active) return active;
  // Fall back to history for completed/canceled tasks
  const history = loadHistory(workspaceDir);
  return history.find((t) => t.id === id);
}

export interface CreateTaskOptions {
  workspaceDir: string;
  input: CreateTaskInput;
  createdBy: string;
}

export function createTask(options: CreateTaskOptions): Task {
  const { workspaceDir, input, createdBy } = options;
  const now = new Date().toISOString();

  const data = loadTasksData(workspaceDir);
  const id = String(data.nextId);

  const task: Task = {
    id,
    title: input.title,
    description: input.description,
    owner: input.owner ?? createdBy,
    createdBy,
    status: input.status ?? "active",
    steps: [],
    resources: [],
    ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  data.tasks.push(task);
  data.nextId++;
  saveTasksData(workspaceDir, data);

  return task;
}

export function updateTask(
  workspaceDir: string,
  id: string,
  input: UpdateTaskInput,
): Task | undefined {
  const data = loadTasksData(workspaceDir);
  const index = data.tasks.findIndex((t) => t.id === id);
  if (index === -1) return undefined;

  const task = data.tasks[index]!;

  if (input.title !== undefined) task.title = input.title;
  if (input.description !== undefined) task.description = input.description;
  if (input.owner !== undefined) task.owner = input.owner;
  if (input.status !== undefined) task.status = input.status;
  if (input.threadId !== undefined) task.threadId = input.threadId;
  task.updatedAt = new Date().toISOString();

  // If status is done or canceled, move to history
  if (input.status === "done" || input.status === "canceled") {
    data.tasks.splice(index, 1);
    saveTasksData(workspaceDir, data);
    appendHistory(workspaceDir, task);
  } else {
    data.tasks[index] = task;
    saveTasksData(workspaceDir, data);
  }

  return task;
}

export function updateSteps(
  workspaceDir: string,
  id: string,
  steps: Step[],
): Task | undefined {
  const data = loadTasksData(workspaceDir);
  const index = data.tasks.findIndex((t) => t.id === id);
  if (index === -1) return undefined;

  const task = data.tasks[index]!;
  task.steps = steps;
  task.updatedAt = new Date().toISOString();
  data.tasks[index] = task;
  saveTasksData(workspaceDir, data);

  return task;
}

export function cancelTask(workspaceDir: string, id: string): Task | undefined {
  const data = loadTasksData(workspaceDir);
  const index = data.tasks.findIndex((t) => t.id === id);
  if (index === -1) return undefined;

  const task = data.tasks[index]!;
  task.status = "canceled";
  task.updatedAt = new Date().toISOString();

  // Collect subtask IDs from steps
  const subtaskIds = task.steps
    .filter((s) => s.taskId)
    .map((s) => s.taskId!);

  // Remove and archive the task
  data.tasks.splice(index, 1);
  saveTasksData(workspaceDir, data);
  appendHistory(workspaceDir, task);

  // Cascade cancel to subtasks
  for (const subtaskId of subtaskIds) {
    cancelTask(workspaceDir, subtaskId);
  }

  return task;
}

export function completeTask(workspaceDir: string, id: string): Task | undefined {
  const data = loadTasksData(workspaceDir);
  const index = data.tasks.findIndex((t) => t.id === id);
  if (index === -1) return undefined;

  const task = data.tasks[index]!;
  task.status = "done";
  task.updatedAt = new Date().toISOString();

  data.tasks.splice(index, 1);
  saveTasksData(workspaceDir, data);
  appendHistory(workspaceDir, task);

  return task;
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

export function addResource(
  workspaceDir: string,
  id: string,
  resource: Resource,
): Task | undefined {
  const data = loadTasksData(workspaceDir);
  const index = data.tasks.findIndex((t) => t.id === id);
  if (index === -1) return undefined;

  const task = data.tasks[index]!;
  task.resources.push(resource);
  task.updatedAt = new Date().toISOString();
  data.tasks[index] = task;
  saveTasksData(workspaceDir, data);

  return task;
}

export function removeResource(
  workspaceDir: string,
  id: string,
  resourceIndex: number,
): Task | undefined {
  const data = loadTasksData(workspaceDir);
  const index = data.tasks.findIndex((t) => t.id === id);
  if (index === -1) return undefined;

  const task = data.tasks[index]!;
  if (resourceIndex < 0 || resourceIndex >= task.resources.length) return undefined;

  task.resources.splice(resourceIndex, 1);
  task.updatedAt = new Date().toISOString();
  data.tasks[index] = task;
  saveTasksData(workspaceDir, data);

  return task;
}

/**
 * Find the parent task of a subtask by scanning active tasks' steps.
 * Fallback for pre-existing tasks without parentTaskId.
 */
export function findParentTask(
  workspaceDir: string,
  subtaskId: string,
): { taskId: string; owner: string } | undefined {
  const tasks = loadTasks(workspaceDir);
  for (const task of tasks) {
    for (const step of task.steps) {
      if (step.taskId === subtaskId) {
        return { taskId: task.id, owner: task.owner };
      }
    }
  }
  return undefined;
}

export function linkSubtask(
  workspaceDir: string,
  taskId: string,
  stepIndex: number,
  subtaskId: string,
): Task | undefined {
  const data = loadTasksData(workspaceDir);
  const index = data.tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return undefined;

  const task = data.tasks[index]!;
  const step = task.steps[stepIndex];
  if (!step) return undefined;

  if (step.taskId) {
    throw new Error(`Step ${stepIndex} already has a linked subtask (#${step.taskId})`);
  }

  step.taskId = subtaskId;
  task.updatedAt = new Date().toISOString();
  data.tasks[index] = task;
  saveTasksData(workspaceDir, data);

  return task;
}
