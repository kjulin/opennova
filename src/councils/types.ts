export interface CouncilManifest {
  id: string;
  topic: string;                    // What this council is about
  coordinator: string;              // Agent ID or "user"
  participants: string[];           // Agent IDs (includes coordinator if agent)
  status: "active" | "closed";
  createdAt: string;
  updatedAt: string;
  // Telegram (populated in Phase 2)
  telegramTopicId?: number;         // message_thread_id in the forum supergroup
  telegramGroupId?: number;         // chat_id of the forum supergroup
  // Per-participant state
  participantState: Record<string, {
    threadId: string;               // Persistent thread for this agent
    lastSeenIndex: number;          // Last transcript index they saw
  }>;
  // Output
  memoNoteTitle?: string;           // Note title when memo is saved on close
}

export interface CouncilMessage {
  type: "message";
  agentId: string;                  // Who said it (or "user" / "system")
  agentName: string;                // Display name
  text: string;
  timestamp: string;
  index: number;                    // Sequential index for catch-up tracking
}

export interface CouncilConfig {
  telegramForumGroupId: number;     // Chat ID of the forum supergroup
}
