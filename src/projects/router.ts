import { Hono } from "hono";
import { loadProjects, getProject, updateProject, updatePhase } from "./storage.js";
import { loadAgents } from "#core/agents.js";

export function createProjectsRouter(workspaceDir: string): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const projects = loadProjects(workspaceDir);
    const agents = loadAgents();
    const agentList = Array.from(agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
    }));
    return c.json({ projects, agents: agentList });
  });

  app.get("/:id", (c) => {
    const id = c.req.param("id");
    const project = getProject(workspaceDir, id);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json(project);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const project = getProject(workspaceDir, id);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    try {
      const body = await c.req.json();
      const { status } = body;

      if (status && !["draft", "active", "completed", "cancelled"].includes(status)) {
        return c.json({ error: "Invalid status" }, 400);
      }

      const updated = updateProject(workspaceDir, id, { status });
      return c.json(updated);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  app.patch("/:id/phases/:phaseId", async (c) => {
    const id = c.req.param("id");
    const phaseId = c.req.param("phaseId");
    const project = getProject(workspaceDir, id);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const phase = project.phases.find((p) => p.id === phaseId);
    if (!phase) {
      return c.json({ error: "Phase not found" }, 404);
    }

    try {
      const body = await c.req.json();
      const { status } = body;

      if (status && !["pending", "in_progress", "review", "done"].includes(status)) {
        return c.json({ error: "Invalid status" }, 400);
      }

      const updated = updatePhase(workspaceDir, id, phaseId, { status });
      return c.json(updated);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  return app;
}
