import type { Agent, AgentsResponse } from "@/types";

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
