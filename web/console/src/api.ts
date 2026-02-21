import type { Agent, AgentsResponse, Skill, SkillsResponse } from "@/types";

const API_BASE = "/api/console";

export async function fetchAgents(): Promise<AgentsResponse> {
  const res = await fetch(`${API_BASE}/agents`);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

export async function fetchAgent(id: string): Promise<Agent> {
  const res = await fetch(`${API_BASE}/agents/${id}`);
  if (!res.ok) throw new Error("Agent not found");
  return res.json();
}

export async function patchAgent(
  id: string,
  fields: Partial<Agent>,
): Promise<Agent> {
  const res = await fetch(`${API_BASE}/agents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error("Failed to save");
  return res.json();
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/agents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete agent");
}

export async function fetchSkills(): Promise<SkillsResponse> {
  const res = await fetch(`${API_BASE}/skills`);
  if (!res.ok) throw new Error("Failed to fetch skills");
  return res.json();
}

export async function fetchSkill(name: string): Promise<Skill> {
  const res = await fetch(`${API_BASE}/skills/${name}`);
  if (!res.ok) throw new Error("Skill not found");
  return res.json();
}

export async function createSkill(data: { name: string; description?: string; content: string }): Promise<Skill> {
  const res = await fetch(`${API_BASE}/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create skill" }));
    throw new Error(err.error || "Failed to create skill");
  }
  return res.json();
}

export async function updateSkill(name: string, data: { description?: string; content?: string }): Promise<Skill> {
  const res = await fetch(`${API_BASE}/skills/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save");
  return res.json();
}

export async function deleteSkill(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/skills/${name}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete skill");
}

export async function assignSkill(name: string, agents: string[]): Promise<{ assignedTo: string[] }> {
  const res = await fetch(`${API_BASE}/skills/${name}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agents }),
  });
  if (!res.ok) throw new Error("Failed to assign skill");
  return res.json();
}

export async function unassignSkill(name: string, agents: string[]): Promise<{ assignedTo: string[] }> {
  const res = await fetch(`${API_BASE}/skills/${name}/unassign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agents }),
  });
  if (!res.ok) throw new Error("Failed to unassign skill");
  return res.json();
}
