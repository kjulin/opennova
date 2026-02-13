import { Hono } from "hono";
import { loadProjects, getProject, createProject, updateProject, updateProjectFull, updatePhase } from "./storage.js";
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

  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { lead, title, description, phases } = body;

      if (!lead || !title || !phases || !Array.isArray(phases) || phases.length === 0) {
        return c.json(
          { error: "Missing required fields: lead, title, phases" },
          400
        );
      }

      const project = createProject(workspaceDir, {
        lead,
        title,
        description: description || "",
        phases: phases.map((p: { title: string; description?: string }) => ({
          title: p.title,
          description: p.description || "",
        })),
      });

      return c.json(project, 201);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const project = getProject(workspaceDir, id);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    try {
      const body = await c.req.json();
      const { status, title, description } = body;

      if (status && !["draft", "active", "completed", "cancelled"].includes(status)) {
        return c.json({ error: "Invalid status" }, 400);
      }

      const updated = updateProject(workspaceDir, id, { status, title, description });
      return c.json(updated);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const project = getProject(workspaceDir, id);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    if (project.status !== "draft") {
      return c.json({ error: "Can only edit draft projects" }, 400);
    }

    try {
      const body = await c.req.json();
      const { title, description, phases } = body;

      if (!title || !phases || !Array.isArray(phases) || phases.length === 0) {
        return c.json(
          { error: "Missing required fields: title, phases" },
          400
        );
      }

      const updated = updateProjectFull(workspaceDir, id, {
        title,
        description: description || "",
        phases: phases.map((p: { id?: string; title: string; description?: string }) => ({
          id: p.id,
          title: p.title,
          description: p.description || "",
        })),
      });

      if (!updated) {
        return c.json({ error: "Failed to update project" }, 500);
      }

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

    if (project.status !== "active") {
      return c.json({ error: "Can only update phases on active projects" }, 400);
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

      // CEO can set any valid status - no transition restrictions
      const updated = updatePhase(workspaceDir, id, phaseId, { status });
      return c.json(updated);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  return app;
}
