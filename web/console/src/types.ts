export interface Trigger {
  id: string;
  agentId?: string;
  agentName?: string;
  cron: string;
  tz?: string;
  prompt: string;
  lastRun?: string;
}

export interface Responsibility {
  title: string;
  content: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  identity?: string;
  instructions?: string;
  responsibilities?: Responsibility[];
  trust: string;
  security?: string; // deprecated, use trust
  model?: string;
  capabilities?: Record<string, { tools?: string[] }>;
  directories?: string[];
  skills: string[];
  triggers: Trigger[];
}

export interface AgentsResponse {
  agents: Agent[];
}

export interface CapabilityToolDescriptor {
  name: string;
  description: string;
}

export interface CapabilityDescriptor {
  key: string;
  tools: CapabilityToolDescriptor[];
}

export interface CapabilitiesResponse {
  capabilities: CapabilityDescriptor[];
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

export interface UsageBucket {
  label: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  byAgent: Array<{
    agentId: string;
    messages: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    durationMs: number;
  }>;
}

export interface UsageResponse {
  buckets: UsageBucket[];
}

export interface ConfigResponse {
  workspace: { path: string };
  auth: { method: string; detail?: string };
  telegram: {
    configured: boolean;
    token?: string;
    chatId?: string;
    chatName?: string;
    activeAgentId?: string;
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
