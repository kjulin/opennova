import React, { useReducer, useEffect, useCallback } from "react";
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
  type ThreadRunnerCallbacks,
} from "#core/index.js";
import { Chat } from "./components/chat.js";
import type { Message, Agent } from "./types.js";

interface AppState {
  agent: Agent | null;
  threadId: string | null;
  messages: Message[];
  status: string | null;
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: "SET_AGENT"; agent: Agent }
  | { type: "SET_THREAD"; threadId: string; messages: Message[] }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "SET_STATUS"; status: string | null }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "CLEAR_THREAD"; threadId: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_AGENT":
      return { ...state, agent: action.agent };
    case "SET_THREAD":
      return { ...state, threadId: action.threadId, messages: action.messages };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "CLEAR_THREAD":
      return { ...state, threadId: action.threadId, messages: [], status: null, error: null };
    default:
      return state;
  }
}

const initialState: AppState = {
  agent: null,
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

  useEffect(() => {
    (async () => {
      try {
        const agents = loadAgents();
        if (agents.size === 0) {
          dispatch({ type: "SET_ERROR", error: "No agents found" });
          return;
        }

        // Use provided agent or default to 'nova'
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

        // Load or create thread
        const agentDir = path.join(Config.workspaceDir, "agents", agentId);
        const threads = listThreads(agentDir);

        if (threads.length > 0) {
          // Sort by updatedAt, pick most recent
          threads.sort((a, b) =>
            new Date(b.manifest.updatedAt).getTime() - new Date(a.manifest.updatedAt).getTime()
          );
          const thread = threads[0]!;
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
    })();
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
        } catch (err) {
          dispatch({ type: "SET_ERROR", error: (err as Error).message });
        }
        return;
      }

      if (!state.agent || !state.threadId) return;

      // Add user message
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
    [state.agent, state.threadId, exit],
  );

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
