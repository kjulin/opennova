import React, { useReducer, useEffect, useCallback, useMemo } from "react";
import { Box, useApp } from "ink";
import path from "path";
import {
  Config,
  loadAgents,
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

type Mode = "chat" | "select-thread" | "select-agent";

interface AppState {
  mode: Mode;
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
  | { type: "SET_MODE"; mode: Mode }
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
    case "SET_MODE":
      return { ...state, mode: action.mode };
    case "SET_AGENTS":
      return { ...state, agents: action.agents };
    case "SET_AGENT":
      return { ...state, agent: action.agent };
    case "SET_THREADS":
      return { ...state, threads: action.threads };
    case "SET_THREAD":
      return { ...state, threadId: action.threadId, messages: action.messages, mode: "chat" };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error, mode: "chat" };
    case "CLEAR_THREAD":
      return { ...state, threadId: action.threadId, messages: [], status: null, error: null, mode: "chat" };
    default:
      return state;
  }
}

const initialState: AppState = {
  mode: "chat",
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
      role: agentConfig.role,
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

      const agentId = initialAgentId ?? "nova";
      const agentConfig = agents.get(agentId);
      if (!agentConfig) {
        dispatch({ type: "SET_ERROR", error: `Agent not found: ${agentId}` });
        return;
      }

      const agent: Agent = {
        id: agentId,
        name: agentConfig.name,
        role: agentConfig.role,
      };
      dispatch({ type: "SET_AGENT", agent });

      const agentDir = path.join(Config.workspaceDir, "agents", agentId);
      const allThreads = listThreads(agentDir);
      allThreads.sort((a, b) =>
        new Date(b.manifest.updatedAt).getTime() - new Date(a.manifest.updatedAt).getTime()
      );
      dispatch({ type: "SET_THREADS", threads: allThreads });

      const tuiThreads = allThreads.filter((t) => t.manifest.channel === "tui");

      if (tuiThreads.length > 0) {
        const thread = tuiThreads[0]!;
        const messages = loadMessages(path.join(agentDir, "threads", `${thread.id}.jsonl`));
        dispatch({
          type: "SET_THREAD",
          threadId: thread.id,
          messages: messages.map((m) => ({
            role: m.role,
            text: m.text,
            timestamp: m.timestamp,
          })),
        });
      } else {
        const threadId = createThread(agentDir, "tui");
        dispatch({ type: "CLEAR_THREAD", threadId });
      }
    } catch (err) {
      dispatch({ type: "SET_ERROR", error: (err as Error).message });
    }
  }, [initialAgentId]);

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
        dispatch({ type: "SET_MODE", mode: "select-thread" });
        return;
      }

      if (text === "/agents") {
        dispatch({ type: "SET_MODE", mode: "select-agent" });
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
        onAssistantMessage(msg) {
          dispatch({ type: "SET_STATUS", status: msg });
        },
        onToolUse(_name, _input, summary) {
          dispatch({ type: "SET_STATUS", status: summary });
        },
      };

      try {
        const result = await runThread(
          agentDir,
          state.threadId,
          text,
          callbacks,
        );

        dispatch({
          type: "ADD_MESSAGE",
          message: {
            role: "assistant",
            text: result.text,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err) {
        dispatch({ type: "SET_ERROR", error: (err as Error).message });
      } finally {
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
    dispatch({ type: "SET_MODE", mode: "chat" });
  }, []);

  if (state.mode === "select-thread") {
    return (
      <Box flexDirection="column" height="100%">
        <ThreadSelect
          threads={state.threads}
          onSelect={handleThreadSelect}
          onCancel={handleCancel}
        />
      </Box>
    );
  }

  if (state.mode === "select-agent") {
    return (
      <Box flexDirection="column" height="100%">
        <AgentSelect
          agents={state.agents}
          currentAgentId={state.agent?.id ?? null}
          onSelect={handleAgentSelect}
          onCancel={handleCancel}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Chat
        agent={state.agent}
        threadId={state.threadId}
        messages={state.messages}
        status={state.status}
        loading={state.loading}
        error={state.error}
        onSubmit={handleSubmit}
      />
    </Box>
  );
}
