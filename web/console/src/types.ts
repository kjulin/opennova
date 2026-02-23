export interface Trigger {
  id: string;
  agentId?: string;
  agentName?: string;
  cron: string;
  tz?: string;
  prompt: string;
  lastRun?: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  identity?: string;
  instructions?: string;
  trust: string;
  security?: string; // deprecated, use trust
  model?: string;
  capabilities?: string[];
  directories?: string[];
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

export interface TriggersResponse {
  triggers: Trigger[];
}

export interface SecretsResponse {
  secrets: string[];
}

export interface ConfigResponse {
  workspace: { path: string };
  auth: { method: string; detail?: string };
  telegram: {
    configured: boolean;
    token?: string;
    chatId?: string;
    activeAgentId?: string;
  };
  tailscale: {
    installed: boolean;
    connected: boolean;
    hostname: string | null;
    certsReady: boolean;
    url?: string;
  };
  audio: {
    transcription: {
      modelAvailable: boolean;
    };
    tts: {
      openaiKeyConfigured: boolean;
    };
  };
  daemon: {
    version: string;
    uptime: number;
    autoStart: boolean;
  };
}
