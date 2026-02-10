import React, { useReducer, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import path from "path";
import {
  Config,
  loadAgents,
  getAgentRole,
  createThread,
  listThreads,
  loadMessages,
  runThread,
  type AgentConfig,
  type ThreadInfo,
  type ThreadRunnerCallbacks,
} from "#core/index.js";
import { Chat } from "./components/chat.js";
import { ThreadSelect } from "./components/thread-select.js";
import { AgentSelect } from "./components/agent-select.js";
import type { Message, Agent } from "./types.js";

type UIMode = "chat" | "select-thread" | "select-agent";

interface AppState {
  uiMode: UIMode;
  agents: Map<string, AgentConfig>;
  agent: Agent | null;
  threads: ThreadInfo[];
  threadId: string | null;
  messages: Message[];
  status: string | null;
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: "SET_UI_MODE"; uiMode: UIMode }
  | { type: "SET_AGENTS"; agents: Map<string, AgentConfig> }
  | { type: "SET_AGENT"; agent: Agent }
  | { type: "SET_THREADS"; threads: ThreadInfo[] }
  | { type: "SET_THREAD"; threadId: string; messages: Message[] }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "SET_STATUS"; status: string | null }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "CLEAR_THREAD"; threadId: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_UI_MODE":
      return { ...state, uiMode: action.uiMode };
    case "SET_AGENTS":
      return { ...state, agents: action.agents };
    case "SET_AGENT":
      return { ...state, agent: action.agent };
    case "SET_THREADS":
      return { ...state, threads: action.threads };
    case "SET_THREAD":
      return { ...state, threadId: action.threadId, messages: action.messages, uiMode: "chat" };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error, uiMode: "chat" };
    case "CLEAR_THREAD":
      return { ...state, threadId: action.threadId, messages: [], status: null, error: null, uiMode: "chat" };
    default:
      return state;
  }
}

const initialState: AppState = {
  uiMode: "chat",
  agents: new Map(),
  agent: null,
  threads: [],
  threadId: null,
  messages: [],
  status: null,
  loading: false,
  error: null,
};

interface Props {
  agentId?: string | undefined;
}

export function App({ agentId: initialAgentId }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const greetingRunRef = useRef(false);

  useInput((_input, key) => {
    if (key.escape) {
      // Cancel select mode
      if (state.uiMode === "select-thread" || state.uiMode === "select-agent") {
        dispatch({ type: "SET_UI_MODE", uiMode: "chat" });
        return;
      }
      // Abort running request
      if (state.loading && abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        dispatch({ type: "SET_LOADING", loading: false });
        dispatch({ type: "SET_STATUS", status: null });
        dispatch({
          type: "ADD_MESSAGE",
          message: { role: "assistant", text: "(stopped)", timestamp: new Date().toISOString() },
        });
      }
    }
  });

  const loadThreadsForAgent = useCallback((agentId: string) => {
    const agentDir = path.join(Config.workspaceDir, "agents", agentId);
    const threads = listThreads(agentDir);
    threads.sort((a, b) =>
      new Date(b.manifest.updatedAt).getTime() - new Date(a.manifest.updatedAt).getTime()
    );
    dispatch({ type: "SET_THREADS", threads });
    return threads;
  }, []);

  const loadThread = useCallback((agentId: string, threadId: string) => {
    const agentDir = path.join(Config.workspaceDir, "agents", agentId);
    const messages = loadMessages(path.join(agentDir, "threads", `${threadId}.jsonl`));
    dispatch({
      type: "SET_THREAD",
      threadId,
      messages: messages.map((m) => ({
        role: m.role,
        text: m.text,
        timestamp: m.timestamp,
      })),
    });
  }, []);

  const switchAgent = useCallback((agentId: string) => {
    const agentConfig = state.agents.get(agentId);
    if (!agentConfig) return;

    const agent: Agent = {
      id: agentId,
      name: agentConfig.name,
      role: getAgentRole(agentConfig),
    };
    dispatch({ type: "SET_AGENT", agent });

    // Load threads and pick most recent TUI thread
    const threads = loadThreadsForAgent(agentId);
    const tuiThreads = threads.filter((t) => t.manifest.channel === "tui");

    if (tuiThreads.length > 0) {
      loadThread(agentId, tuiThreads[0]!.id);
    } else {
      const agentDir = path.join(Config.workspaceDir, "agents", agentId);
      const threadId = createThread(agentDir, "tui");
      dispatch({ type: "CLEAR_THREAD", threadId });
      loadThreadsForAgent(agentId);
    }
  }, [state.agents, loadThreadsForAgent, loadThread]);

  useEffect(() => {
    try {
      const agents = loadAgents();
      if (agents.size === 0) {
        dispatch({ type: "SET_ERROR", error: "No agents found" });
        return;
      }
      dispatch({ type: "SET_AGENTS", agents });

      // Chat mode: auto-select agent
      const agentId = initialAgentId ?? "nova";
      const agentConfig = agents.get(agentId);
      if (!agentConfig) {
        dispatch({ type: "SET_ERROR", error: `Agent not found: ${agentId}` });
        return;
      }

      const agent: Agent = {
        id: agentId,
        name: agentConfig.name,
        role: getAgentRole(agentConfig),
      };
      dispatch({ type: "SET_AGENT", agent });

      const agentDir = path.join(Config.workspaceDir, "agents", agentId);
      const allThreads = listThreads(agentDir);
      allThreads.sort((a, b) =>
        new Date(b.manifest.updatedAt).getTime() - new Date(a.manifest.updatedAt).getTime()
      );
      dispatch({ type: "SET_THREADS", threads: allThreads });

      // Always start fresh with a new thread for TUI
      const threadId = createThread(agentDir, "tui");
      dispatch({ type: "CLEAR_THREAD", threadId });
      greetingRunRef.current = false; // Mark that we need to run greeting
    } catch (err) {
      dispatch({ type: "SET_ERROR", error: (err as Error).message });
    }
  }, [initialAgentId]);

  // Run TUI greeting when session starts
  useEffect(() => {
    if (greetingRunRef.current) return;
    if (!state.agent || !state.threadId) return;
    if (state.uiMode !== "chat") return;

    greetingRunRef.current = true;

    const agentDir = path.join(Config.workspaceDir, "agents", state.agent.id);
    const greetingMessage = "The user just started a chat session. Greet them briefly and mention what you can help with. Keep it short (1-2 sentences).";

    dispatch({ type: "SET_LOADING", loading: true });

    runThread(
      agentDir,
      state.threadId,
      greetingMessage,
      {
        onThinking() {
          dispatch({ type: "SET_STATUS", status: "Thinking..." });
        },
        onAssistantMessage(msg) {
          dispatch({ type: "SET_STATUS", status: msg });
        },
        onToolUse(_name, _input, summary) {
          dispatch({ type: "SET_STATUS", status: summary });
        },
      },
      undefined,
      undefined,
      undefined,
      { model: "haiku", maxTurns: 1 },
    ).then((result) => {
      if (result.text) {
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            role: "assistant",
            text: result.text,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }).catch((err) => {
      dispatch({ type: "SET_ERROR", error: (err as Error).message });
    }).finally(() => {
      dispatch({ type: "SET_STATUS", status: null });
      dispatch({ type: "SET_LOADING", loading: false });
    });
  }, [state.agent, state.threadId, state.uiMode]);

  const handleSubmit = useCallback(
    async (text: string) => {
      if (text === "/exit" || text === "/quit") {
        exit();
        return;
      }

      if (text === "/new") {
        if (!state.agent) return;
        try {
          const agentDir = path.join(Config.workspaceDir, "agents", state.agent.id);
          const threadId = createThread(agentDir, "tui");
          dispatch({ type: "CLEAR_THREAD", threadId });
          loadThreadsForAgent(state.agent.id);
        } catch (err) {
          dispatch({ type: "SET_ERROR", error: (err as Error).message });
        }
        return;
      }

      if (text === "/threads") {
        if (!state.agent) return;
        loadThreadsForAgent(state.agent.id);
        dispatch({ type: "SET_UI_MODE", uiMode: "select-thread" });
        return;
      }

      if (text === "/agents") {
        dispatch({ type: "SET_UI_MODE", uiMode: "select-agent" });
        return;
      }

      if (text === "/help") {
        dispatch({
          type: "ADD_MESSAGE",
          message: {
            role: "assistant",
            text: `Available commands:
  /new      - Start a new thread
  /threads  - Switch to a different thread
  /agents   - Switch to a different agent
  /help     - Show this help message
  /exit     - Exit the chat`,
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      if (!state.agent || !state.threadId) return;

      dispatch({
        type: "ADD_MESSAGE",
        message: { role: "user", text, timestamp: new Date().toISOString() },
      });
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });

      const agentDir = path.join(Config.workspaceDir, "agents", state.agent.id);

      const callbacks: ThreadRunnerCallbacks = {
        onThinking() {
          dispatch({ type: "SET_STATUS", status: "Thinking..." });
        },
        onAssistantMessage(msg) {
          dispatch({ type: "SET_STATUS", status: msg });
        },
        onToolUse(_name, _input, summary) {
          dispatch({ type: "SET_STATUS", status: summary });
        },
      };

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const result = await runThread(
          agentDir,
          state.threadId,
          text,
          callbacks,
          undefined,
          undefined,
          abortController,
        );

        // Only add message if not aborted
        if (!abortController.signal.aborted && result.text) {
          dispatch({
            type: "ADD_MESSAGE",
            message: {
              role: "assistant",
              text: result.text,
              timestamp: new Date().toISOString(),
            },
          });
        }
      } catch (err) {
        // Only show error if not aborted
        if (!abortController.signal.aborted) {
          dispatch({ type: "SET_ERROR", error: (err as Error).message });
        }
      } finally {
        abortControllerRef.current = null;
        dispatch({ type: "SET_STATUS", status: null });
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [state.agent, state.threadId, exit, loadThreadsForAgent],
  );

  const handleThreadSelect = useCallback((threadId: string) => {
    if (!state.agent) return;
    loadThread(state.agent.id, threadId);
  }, [state.agent, loadThread]);

  const handleAgentSelect = useCallback((agentId: string) => {
    switchAgent(agentId);
  }, [switchAgent]);

  const handleCancel = useCallback(() => {
    dispatch({ type: "SET_UI_MODE", uiMode: "chat" });
  }, []);

  const threadTitle = useMemo(() => {
    if (!state.threadId) return null;
    const thread = state.threads.find((t) => t.id === state.threadId);
    return thread?.manifest.title ?? null;
  }, [state.threadId, state.threads]);

  const selectComponent = state.uiMode === "select-thread" ? (
    <ThreadSelect
      threads={state.threads}
      onSelect={handleThreadSelect}
      onCancel={handleCancel}
    />
  ) : state.uiMode === "select-agent" ? (
    <AgentSelect
      agents={state.agents}
      currentAgentId={state.agent?.id ?? null}
      onSelect={handleAgentSelect}
      onCancel={handleCancel}
    />
  ) : null;

  return (
    <Box flexDirection="column" height="100%">
      <Chat
        agent={state.agent}
        threadTitle={threadTitle}
        messages={state.messages}
        status={state.status}
        loading={state.loading}
        error={state.error}
        onSubmit={handleSubmit}
        selectComponent={selectComponent}
      />
    </Box>
  );
}
