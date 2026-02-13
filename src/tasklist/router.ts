import { Hono } from "hono";
import path from "path";
import { loadTasks, createTask, updateTask, getTask, archiveTask, deleteTask, loadArchivedTasks } from "./storage.js";
import { loadAgents } from "#core/agents.js";
import { createThread, findThread } from "#core/index.js";
import { runTask, getRunningTasks } from "./scheduler.js";

export function createTasklistRouter(workspaceDir: string): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const tasks = loadTasks(workspaceDir);
    const agents = loadAgents();
    const agentList = Array.from(agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
    }));
    const runningTaskIds = getRunningTasks();
    return c.json({ tasks, agents: agentList, runningTaskIds });
  });

  app.post("/:id/run", async (c) => {
    const id = c.req.param("id");
    const result = await runTask(id);

    if (!result.started) {
      if (result.reason === "already_running") {
        return c.json({ error: "Task already running" }, 409);
      }
      if (result.reason === "not_found") {
        return c.json({ error: "Task not found" }, 404);
      }
      if (result.reason === "not_open") {
        return c.json({ error: "Can only run open tasks" }, 400);
      }
      if (result.reason === "assigned_to_user") {
        return c.json({ error: "Cannot run tasks assigned to user" }, 400);
      }
      if (result.reason === "agent_not_found") {
        return c.json({ error: "Agent not found" }, 400);
      }
      if (result.reason === "start_failed") {
        return c.json({ error: "Failed to initialize task - check server logs" }, 500);
      }
      return c.json({ error: `Failed to start task: ${result.reason || "unknown"}` }, 500);
    }

    return c.json({ success: true });
  });

  app.get("/archived", (c) => {
    const days = parseInt(c.req.query("days") || "7", 10);
    const tasks = loadArchivedTasks(workspaceDir, days);
    return c.json({ tasks });
  });

  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { assignee, title, rationale, instructions } = body;

      if (!assignee || !title) {
        return c.json(
          { error: "Missing required fields: assignee, title" },
          400
        );
      }

      const task = createTask(workspaceDir, {
        agentId: "user",
        assignee,
        title,
        rationale: rationale || "",
        instructions: instructions || "",
      });

      return c.json(task, 201);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const task = getTask(workspaceDir, id);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    try {
      const body = await c.req.json();
      const { status, remarks, title } = body;

      if (status && !["open", "review", "done", "dismissed"].includes(status)) {
        return c.json({ error: "Invalid status" }, 400);
      }

      const updated = updateTask(workspaceDir, id, { status, remarks, title });
      return c.json(updated);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  app.post("/:id/thread", async (c) => {
    const id = c.req.param("id");
    const task = getTask(workspaceDir, id);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // If task already has a thread, find it and return
    if (task.threadId) {
      const manifest = findThread(workspaceDir, task.threadId);
      if (!manifest?.agentId) {
        return c.json({ error: "Thread not found" }, 404);
      }
      return c.json({ threadId: task.threadId, agentId: manifest.agentId, task });
    }

    try {
      const body = await c.req.json();
      const { agentId } = body;

      if (!agentId) {
        return c.json({ error: "Missing required field: agentId" }, 400);
      }

      // Create thread in the agent's directory
      const agentDir = path.join(workspaceDir, "agents", agentId);
      const threadId = createThread(agentDir, "telegram");

      // Update task with threadId
      const updated = updateTask(workspaceDir, id, { threadId });

      return c.json({ threadId, agentId, task: updated });
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  app.post("/:id/archive", (c) => {
    const id = c.req.param("id");
    const task = getTask(workspaceDir, id);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const archived = archiveTask(workspaceDir, id);
    if (!archived) {
      return c.json({ error: "Failed to archive task" }, 500);
    }

    return c.json({ success: true });
  });

  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    const task = getTask(workspaceDir, id);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const deleted = deleteTask(workspaceDir, id);
    if (!deleted) {
      return c.json({ error: "Failed to delete task" }, 500);
    }

    return c.json({ success: true });
  });

  return app;
}
