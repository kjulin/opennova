import fs from "fs";
import path from "path";

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, 100);
}

export function unslugify(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function notesDir(agentDir: string): string {
  return path.join(agentDir, "notes");
}

export function listNotes(agentDir: string): Array<{ title: string; slug: string }> {
  const dir = notesDir(agentDir);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      return { title: unslugify(slug), slug };
    });
}

export function readNote(agentDir: string, slug: string): string | null {
  const filePath = path.join(notesDir(agentDir), `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

export function writeNote(agentDir: string, slug: string, content: string): void {
  const dir = notesDir(agentDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.md`), content);
}

export function deleteNote(agentDir: string, slug: string): boolean {
  const filePath = path.join(notesDir(agentDir), `${slug}.md`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function noteExists(agentDir: string, slug: string): boolean {
  return fs.existsSync(path.join(notesDir(agentDir), `${slug}.md`));
}

export function loadAllNotes(workspaceDir: string): Array<{ agent: string; title: string; slug: string }> {
  const agentsDir = path.join(workspaceDir, "agents");
  if (!fs.existsSync(agentsDir)) return [];

  const results: Array<{ agent: string; title: string; slug: string }> = [];
  for (const agentId of fs.readdirSync(agentsDir)) {
    const agentDir = path.join(agentsDir, agentId);
    if (!fs.statSync(agentDir).isDirectory()) continue;
    for (const note of listNotes(agentDir)) {
      results.push({ agent: agentId, ...note });
    }
  }
  return results;
}
