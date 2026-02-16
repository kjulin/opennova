import path from "path";
import { Hono, type Context } from "hono";
import { loadAllNotes, readNote, writeNote, deleteNote, unslugify } from "./storage.js";

export function createNotesRouter(workspaceDir: string): Hono {
  const app = new Hono();

  // List all notes across all agents
  app.get("/", (c) => {
    const notes = loadAllNotes(workspaceDir);
    return c.json({ notes });
  });

  // Read a single note
  app.get("/:agent/:slug", (c) => {
    const { agent, slug } = c.req.param();
    const agentDir = path.join(workspaceDir, "agents", agent);
    const content = readNote(agentDir, slug);
    if (content === null) {
      return c.json({ error: "Note not found" }, 404);
    }
    return c.json({ agent, title: unslugify(slug), slug, content });
  });

  // Update a note (PUT for normal saves, POST for sendBeacon flush on close)
  const handleUpdate = async (c: Context) => {
    const agent = c.req.param("agent")!;
    const slug = c.req.param("slug")!;
    const body = await c.req.json();
    const { content } = body;
    if (typeof content !== "string") {
      return c.json({ error: "content is required" }, 400);
    }
    const agentDir = path.join(workspaceDir, "agents", agent);
    writeNote(agentDir, slug, content);
    return c.json({ agent, title: unslugify(slug), slug, content });
  };
  app.put("/:agent/:slug", handleUpdate);
  app.post("/:agent/:slug", handleUpdate);

  // Delete a note
  app.delete("/:agent/:slug", (c) => {
    const { agent, slug } = c.req.param();
    const agentDir = path.join(workspaceDir, "agents", agent);
    if (!deleteNote(agentDir, slug)) {
      return c.json({ error: "Note not found" }, 404);
    }
    return c.json({ ok: true });
  });

  return app;
}
