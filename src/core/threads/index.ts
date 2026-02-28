// Internal I/O layer (re-exported for backwards compatibility)
export {
  threadPath,
  loadManifest,
  saveManifest,
  createThread,
  listThreads,
  loadMessages,
  deleteThread,
  appendMessage,
  appendEvent,
  loadEvents,
  withThreadLock,
  findThread,
  getThreadManifest,
  type ThreadManifest,
  type ThreadMessage,
  type ThreadInfo,
  type CreateThreadOptions,
  type ThreadEvent,
  type ThreadMessageEvent,
  type ThreadToolUseEvent,
  type ThreadAssistantTextEvent,
  type ThreadResultEvent,
} from "./io.js";

// Store
export { threadStore } from "./singleton.js";
export type { ThreadStore, SearchOptions, BackfillResult } from "./store.js";
