import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  loadTasks,
  getTask,
  createTask,
  updateTask,
  updateSteps,
  cancelTask,
  completeTask,
  loadHistory,
} from "#tasks/index.js";

describe("tasks storage", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-tasks-test-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("loadTasks", () => {
    it("returns empty array when no tasks file exists", () => {
      const tasks = loadTasks(testDir);
      expect(tasks).toEqual([]);
    });

    it("returns tasks from existing file", () => {
      const tasksDir = path.join(testDir, "tasks");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, "tasks.json"),
        JSON.stringify({
          tasks: [
            {
              id: "abc123",
              title: "Test task",
              description: "Test description",
              owner: "user",
              createdBy: "user",
              status: "active",
              steps: [],
              threadId: "thread123",
              createdAt: "2024-01-01T00:00:00Z",
              updatedAt: "2024-01-01T00:00:00Z",
            },
          ],
        }),
      );

      const tasks = loadTasks(testDir);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toBe("Test task");
    });
  });

  describe("createTask", () => {
    it("creates a new task with generated id", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "New task", description: "Description" },
        createdBy: "user",
      });

      expect(task.id).toHaveLength(12); // 6 bytes hex
      expect(task.title).toBe("New task");
      expect(task.description).toBe("Description");
      expect(task.owner).toBe("user");
      expect(task.createdBy).toBe("user");
      expect(task.status).toBe("active");
      expect(task.steps).toEqual([]);
      expect(task.threadId).toBeUndefined();
    });

    it("allows specifying a different owner", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "Agent task", description: "Desc", owner: "content-writer" },
        createdBy: "nova",
      });

      expect(task.owner).toBe("content-writer");
      expect(task.createdBy).toBe("nova");
    });

    it("persists task to file", () => {
      createTask({
        workspaceDir: testDir,
        input: { title: "Persisted task", description: "Desc" },
        createdBy: "user",
      });

      const tasks = loadTasks(testDir);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toBe("Persisted task");
    });
  });

  describe("getTask", () => {
    it("returns undefined for non-existent task", () => {
      const task = getTask(testDir, "nonexistent");
      expect(task).toBeUndefined();
    });

    it("returns task by id", () => {
      const created = createTask({
        workspaceDir: testDir,
        input: { title: "Find me", description: "Desc" },
        createdBy: "user",
      });

      const found = getTask(testDir, created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Find me");
    });
  });

  describe("updateTask", () => {
    it("updates task fields", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "Original", description: "Desc" },
        createdBy: "user",
      });

      const updated = updateTask(testDir, task.id, {
        title: "Updated",
        status: "waiting",
      });

      expect(updated).toBeDefined();
      expect(updated!.title).toBe("Updated");
      expect(updated!.status).toBe("waiting");
    });

    it("can set threadId after task creation", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "No thread yet", description: "Desc" },
        createdBy: "user",
      });

      expect(task.threadId).toBeUndefined();

      const updated = updateTask(testDir, task.id, {
        threadId: "thread123",
      });

      expect(updated).toBeDefined();
      expect(updated!.threadId).toBe("thread123");
    });

    it("moves task to history when status becomes done", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "Complete me", description: "Desc" },
        createdBy: "user",
      });

      updateTask(testDir, task.id, { status: "done" });

      // Task should no longer be in active list
      const tasks = loadTasks(testDir);
      expect(tasks).toHaveLength(0);

      // Task should be in history
      const history = loadHistory(testDir);
      expect(history).toHaveLength(1);
      expect(history[0]!.title).toBe("Complete me");
      expect(history[0]!.status).toBe("done");
      expect(history[0]!.archivedAt).toBeDefined();
    });

    it("moves task to history when status becomes canceled", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "Cancel via update", description: "Desc" },
        createdBy: "user",
      });

      updateTask(testDir, task.id, { status: "canceled" });

      const tasks = loadTasks(testDir);
      expect(tasks).toHaveLength(0);

      const history = loadHistory(testDir);
      expect(history).toHaveLength(1);
      expect(history[0]!.status).toBe("canceled");
    });

    it("returns undefined for non-existent task", () => {
      const result = updateTask(testDir, "nonexistent", { title: "New" });
      expect(result).toBeUndefined();
    });
  });

  describe("updateSteps", () => {
    it("replaces steps array", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "With steps", description: "Desc" },
        createdBy: "user",
      });

      const updated = updateSteps(testDir, task.id, [
        { title: "Step 1", done: true },
        { title: "Step 2", done: false },
      ]);

      expect(updated).toBeDefined();
      expect(updated!.steps).toHaveLength(2);
      expect(updated!.steps[0]!.title).toBe("Step 1");
      expect(updated!.steps[0]!.done).toBe(true);
    });
  });

  describe("cancelTask", () => {
    it("sets status to canceled and moves to history", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "Cancel me", description: "Desc" },
        createdBy: "user",
      });

      const result = cancelTask(testDir, task.id);
      expect(result).toBeDefined();
      expect(result!.status).toBe("canceled");

      const tasks = loadTasks(testDir);
      expect(tasks).toHaveLength(0);

      const history = loadHistory(testDir);
      expect(history).toHaveLength(1);
      expect(history[0]!.title).toBe("Cancel me");
      expect(history[0]!.status).toBe("canceled");
    });

    it("returns undefined for non-existent task", () => {
      const result = cancelTask(testDir, "nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("completeTask", () => {
    it("sets status to done and moves to history", () => {
      const task = createTask({
        workspaceDir: testDir,
        input: { title: "Complete me", description: "Desc" },
        createdBy: "user",
      });

      const result = completeTask(testDir, task.id);
      expect(result).toBeDefined();
      expect(result!.status).toBe("done");

      const tasks = loadTasks(testDir);
      expect(tasks).toHaveLength(0);

      const history = loadHistory(testDir);
      expect(history).toHaveLength(1);
      expect(history[0]!.title).toBe("Complete me");
      expect(history[0]!.status).toBe("done");
    });

    it("returns undefined for non-existent task", () => {
      const result = completeTask(testDir, "nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("loadHistory", () => {
    it("returns empty array when no history exists", () => {
      const history = loadHistory(testDir);
      expect(history).toEqual([]);
    });

    it("returns most recent items first", () => {
      // Create and complete multiple tasks
      for (let i = 1; i <= 3; i++) {
        const task = createTask({
          workspaceDir: testDir,
          input: { title: `Task ${i}`, description: "Desc" },
          createdBy: "user",
        });
        completeTask(testDir, task.id);
      }

      const history = loadHistory(testDir);
      expect(history).toHaveLength(3);
      expect(history[0]!.title).toBe("Task 3");
      expect(history[2]!.title).toBe("Task 1");
    });

    it("respects limit parameter", () => {
      for (let i = 1; i <= 5; i++) {
        const task = createTask({
          workspaceDir: testDir,
          input: { title: `Task ${i}`, description: "Desc" },
          createdBy: "user",
        });
        completeTask(testDir, task.id);
      }

      const history = loadHistory(testDir, 2);
      expect(history).toHaveLength(2);
    });
  });
});
