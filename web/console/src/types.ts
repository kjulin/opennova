export interface Trigger {
  id: string;
  cron: string;
  tz?: string;
  prompt: string;
  enabled: boolean;
  lastRun?: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  identity?: string;
  instructions?: string;
  security: string;
  model?: string;
  capabilities?: string[];
  directories?: string[];
  allowedAgents?: string[];
  skills: string[];
  triggers: Trigger[];
}

export interface AgentsResponse {
  agents: Agent[];
}

export interface Skill {
  name: string;
  description?: string;
  content?: string;
  assignedTo: string[];
  hasContent: boolean;
}

export interface SkillsResponse {
  skills: Skill[];
}
