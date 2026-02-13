import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ProjectSchema, type Project, type Phase } from "./types.js";

function projectsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "projects");
}

function projectsPath(workspaceDir: string): string {
  return path.join(projectsDir(workspaceDir), "projects.json");
}

export function loadProjects(workspaceDir: string): Project[] {
  const filePath = projectsPath(workspaceDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const result = ProjectSchema.array().safeParse(raw);
    if (!result.success) {
      console.warn("Invalid projects.json:", result.error.message);
      return [];
    }
    return result.data;
  } catch {
    return [];
  }
}

export function saveProjects(workspaceDir: string, projects: Project[]): void {
  const dir = projectsDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(projectsPath(workspaceDir), JSON.stringify(projects, null, 2));
}

export interface CreateProjectData {
  lead: string;
  title: string;
  description: string;
  phases: { title: string; description: string }[];
}

export function createProject(workspaceDir: string, data: CreateProjectData): Project {
  const projects = loadProjects(workspaceDir);
  const now = new Date().toISOString();
  const project: Project = {
    id: crypto.randomUUID(),
    lead: data.lead,
    title: data.title,
    description: data.description,
    status: "draft",
    artifacts: [],
    phases: data.phases.map((p) => ({
      id: crypto.randomUUID(),
      title: p.title,
      description: p.description,
      status: "pending" as const,
    })),
    createdAt: now,
    updatedAt: now,
  };
  projects.push(project);
  saveProjects(workspaceDir, projects);
  return project;
}

export interface UpdateProjectData {
  title?: string | undefined;
  description?: string | undefined;
  status?: "draft" | "active" | "completed" | "cancelled" | undefined;
  artifacts?: string[] | undefined;
}

export function updateProject(
  workspaceDir: string,
  id: string,
  updates: UpdateProjectData
): Project | null {
  const projects = loadProjects(workspaceDir);
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) return null;

  const project = projects[index]!;
  if (updates.title !== undefined) project.title = updates.title;
  if (updates.description !== undefined) project.description = updates.description;
  if (updates.status !== undefined) project.status = updates.status;
  if (updates.artifacts !== undefined) project.artifacts = updates.artifacts;
  project.updatedAt = new Date().toISOString();

  saveProjects(workspaceDir, projects);
  return project;
}

export interface UpdatePhaseData {
  status?: "pending" | "in_progress" | "review" | "done" | undefined;
  description?: string | undefined;
}

export function updatePhase(
  workspaceDir: string,
  projectId: string,
  phaseId: string,
  updates: UpdatePhaseData
): Project | null {
  const projects = loadProjects(workspaceDir);
  const projectIndex = projects.findIndex((p) => p.id === projectId);
  if (projectIndex === -1) return null;

  const project = projects[projectIndex]!;
  const phaseIndex = project.phases.findIndex((p) => p.id === phaseId);
  if (phaseIndex === -1) return null;

  const phase = project.phases[phaseIndex]!;
  if (updates.status !== undefined) phase.status = updates.status;
  if (updates.description !== undefined) phase.description = updates.description;
  project.updatedAt = new Date().toISOString();

  saveProjects(workspaceDir, projects);
  return project;
}

export function getProject(workspaceDir: string, id: string): Project | null {
  const projects = loadProjects(workspaceDir);
  return projects.find((p) => p.id === id) ?? null;
}
