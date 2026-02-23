import type { Agent, AgentsResponse, Skill, SkillsResponse, Trigger, TriggersResponse, SecretsResponse, ConfigResponse } from "@/types";

const API_BASE = "/api/console";
const CONFIG_API = "/api/config";

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

// Triggers

export async function fetchTriggers(): Promise<TriggersResponse> {
  const res = await fetch(`${API_BASE}/triggers`);
  if (!res.ok) throw new Error("Failed to fetch triggers");
  return res.json();
}

export async function createTrigger(agentId: string, data: { cron: string; tz?: string; prompt: string }): Promise<Trigger> {
  const res = await fetch(`${API_BASE}/triggers/agent/${agentId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create trigger" }));
    throw new Error(err.error || "Failed to create trigger");
  }
  return res.json();
}

export async function patchTrigger(triggerId: string, data: Partial<{ cron: string; tz: string; prompt: string }>): Promise<Trigger> {
  const res = await fetch(`${API_BASE}/triggers/${triggerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save");
  return res.json();
}

export async function deleteTrigger(triggerId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/triggers/${triggerId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete trigger");
}

// Secrets

export async function fetchSecrets(): Promise<SecretsResponse> {
  const res = await fetch(`${API_BASE}/secrets`);
  if (!res.ok) throw new Error("Failed to fetch secrets");
  return res.json();
}

export async function createSecret(name: string, value: string): Promise<void> {
  const res = await fetch(`${API_BASE}/secrets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, value }),
  });
  if (!res.ok) throw new Error("Failed to create secret");
}

export async function updateSecret(name: string, value: string): Promise<void> {
  const res = await fetch(`${API_BASE}/secrets/${name}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error("Failed to update secret");
}

export async function deleteSecret(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/secrets/${name}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete secret");
}

// Config

export async function fetchConfig(): Promise<ConfigResponse> {
  const res = await fetch(`${CONFIG_API}`);
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export async function updateDaemon(autoStart: boolean): Promise<{ ok: true; autoStart: boolean }> {
  const res = await fetch(`${CONFIG_API}/daemon`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoStart }),
  });
  if (!res.ok) throw new Error("Failed to update daemon settings");
  return res.json();
}

export async function pairTelegram(): Promise<{ ok: true }> {
  const res = await fetch(`${CONFIG_API}/telegram/pair`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to re-pair Telegram");
  return res.json();
}

export async function updateTtsKey(openaiKey: string): Promise<{ ok: true }> {
  const res = await fetch(`${CONFIG_API}/audio/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ openaiKey }),
  });
  if (!res.ok) throw new Error("Failed to update TTS settings");
  return res.json();
}

export async function setupTailscale(): Promise<{ ok: true; hostname: string }> {
  const res = await fetch("/api/setup/tailscale", { method: "POST" });
  if (!res.ok) throw new Error("Failed to set up Tailscale");
  return res.json();
}

export async function deleteWorkspace(confirm: string): Promise<{ ok: true }> {
  const res = await fetch(`${CONFIG_API}/workspace`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm }),
  });
  if (!res.ok) throw new Error("Failed to remove workspace");
  return res.json();
}
