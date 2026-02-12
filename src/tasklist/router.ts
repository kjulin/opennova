import { Hono } from "hono";
import { loadTasks, createTask, updateTask, getTask, archiveTask } from "./storage.js";
import { loadAgents } from "#core/agents.js";

export function createTasklistRouter(workspaceDir: string): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const tasks = loadTasks(workspaceDir);
    const agents = loadAgents();
    const agentList = Array.from(agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
    }));
    return c.json({ tasks, agents: agentList });
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
      const { status, remarks } = body;

      if (status && !["open", "done", "dismissed"].includes(status)) {
        return c.json({ error: "Invalid status" }, 400);
      }

      const updated = updateTask(workspaceDir, id, { status, remarks });
      return c.json(updated);
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

  return app;
}
