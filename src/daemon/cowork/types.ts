import type { EditSuggestion } from "#core/index.js";

export interface CoworkSessionConfig {
  vaultPath: string;
  agentId: string;
  focusId: string;
  model?: "haiku" | "opus";
  debounceMs?: number;  // default 4000
}

export interface CoworkSessionState {
  status: "starting" | "watching" | "processing" | "idle" | "error";
  pendingFiles: string[];
  currentSuggestion: EditSuggestion | null;
  threadId: string | null;
  agentId: string;
  focusId: string;
}
