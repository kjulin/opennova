import React, { useReducer, useEffect, useCallback, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import path from "path";
import {
  Config,
  loadAgents,
  loadFocuses,
  buildCoworkPrompt,
  parseCoworkResponse,
  createThread,
  listThreads,
  loadMessages,
  runThread,
  type AgentConfig,
  type Focus,
  type ThreadInfo,
  type ThreadRunnerCallbacks,
} from "#core/index.js";
import { Chat } from "./components/chat.js";
import { ThreadSelect } from "./components/thread-select.js";
import { AgentSelect } from "./components/agent-select.js";
import { FocusSelect } from "./components/focus-select.js";
import {
  useFileWatcher,
  useCoordinator,
  CoworkAgentSelect,
  CoworkStatusBar,
} from "./cowork/index.js";
import type { Message, Agent } from "./types.js";
import type { AppMode } from "./index.js";

type UIMode =
  | "chat"
  | "select-thread"
  | "select-agent"
  | "cowork-select-agent"
  | "cowork-select-focus"
  | "cowork";

interface AppState {
  uiMode: UIMode;
  agents: Map<string, AgentConfig>;
  agent: Agent | null;
  focuses: Map<string, Focus>;
  focus: Focus | null;
  threads: ThreadInfo[];
  threadId: string | null;
  messages: Message[];
  status: string | null;
  loading: boolean;
  error: string | null;
  minimalMode: boolean;
  fastMode: boolean; // false = Deep Mode (opus), true = Fast Mode (haiku)
}

type Action =
  | { type: "SET_UI_MODE"; uiMode: UIMode }
  | { type: "SET_AGENTS"; agents: Map<string, AgentConfig> }
  | { type: "SET_AGENT"; agent: Agent }
  | { type: "SET_FOCUSES"; focuses: Map<string, Focus> }
  | { type: "SET_FOCUS"; focus: Focus }
  | { type: "SET_THREADS"; threads: ThreadInfo[] }
  | { type: "SET_THREAD"; threadId: string; messages: Message[] }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "SET_STATUS"; status: string | null }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "CLEAR_THREAD"; threadId: string }
  | { type: "START_COWORK"; threadId: string; focus: Focus }
  | { type: "TOGGLE_MINIMAL_MODE" }
  | { type: "TOGGLE_MODE" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_UI_MODE":
      return { ...state, uiMode: action.uiMode };
    case "SET_AGENTS":
      return { ...state, agents: action.agents };
    case "SET_AGENT":
      return { ...state, agent: action.agent };
    case "SET_FOCUSES":
      return { ...state, focuses: action.focuses };
    case "SET_FOCUS":
      return { ...state, focus: action.focus };
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
      // Don't change uiMode for cowork - only reset from select modes
      const errorUiMode = state.uiMode === "cowork" ? "cowork" : "chat";
      return { ...state, error: action.error, uiMode: errorUiMode };
    case "CLEAR_THREAD":
      return { ...state, threadId: action.threadId, messages: [], status: null, error: null, uiMode: "chat" };
    case "START_COWORK":
      return {
        ...state,
        threadId: action.threadId,
        focus: action.focus,
        messages: [],
        status: null,
        error: null,
        uiMode: "cowork",
      };
    case "TOGGLE_MINIMAL_MODE":
      return { ...state, minimalMode: !state.minimalMode };
    case "TOGGLE_MODE":
      return { ...state, fastMode: !state.fastMode };
    default:
      return state;
  }
}

const initialState: AppState = {
  uiMode: "chat",
  agents: new Map(),
  agent: null,
  focuses: new Map(),
  focus: null,
  threads: [],
  threadId: null,
  messages: [],
  status: null,
  loading: false,
  error: null,
  minimalMode: true, // Start in minimal mode for cleaner view
  fastMode: false, // Start in Deep Mode (opus)
};

interface Props {
  agentId?: string | undefined;
  mode?: AppMode | undefined;
  workingDir?: string | undefined;
}

export function App({ agentId: initialAgentId, mode: appMode = "chat", workingDir }: Props) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    uiMode: appMode === "cowork" ? "cowork-select-agent" : "chat",
  });
  const { exit } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const greetingRunRef = useRef(false);

  useInput((input, key) => {
    // Tab toggles minimal mode in cowork
    if (key.tab && state.uiMode === "cowork") {
      dispatch({ type: "TOGGLE_MINIMAL_MODE" });
      return;
    }

    // 'm' toggles between Fast Mode (haiku) and Deep Mode (opus)
    if (input === "m" && state.uiMode === "cowork" && !state.loading) {
      dispatch({ type: "TOGGLE_MODE" });
      return;
    }

    // 'f' changes focus in cowork
    if (input === "f" && state.uiMode === "cowork" && !state.loading) {
      dispatch({ type: "SET_UI_MODE", uiMode: "cowork-select-focus" });
      return;
    }

    // 'a' changes agent in cowork
    if (input === "a" && state.uiMode === "cowork" && !state.loading) {
      dispatch({ type: "SET_UI_MODE", uiMode: "cowork-select-agent" });
      return;
    }

    if (key.escape) {
      // Cancel select mode
      if (state.uiMode === "select-thread" || state.uiMode === "select-agent") {
        dispatch({ type: "SET_UI_MODE", uiMode: "chat" });
        return;
      }
      // Cowork agent selection: go back to cowork if mid-session, else exit
      if (state.uiMode === "cowork-select-agent") {
        if (state.threadId) {
          dispatch({ type: "SET_UI_MODE", uiMode: "cowork" });
        } else {
          exit();
        }
        return;
      }
      // Focus selection: go back to cowork if mid-session, else agent selection
      if (state.uiMode === "cowork-select-focus") {
        if (state.threadId) {
          dispatch({ type: "SET_UI_MODE", uiMode: "cowork" });
        } else {
          dispatch({ type: "SET_UI_MODE", uiMode: "cowork-select-agent" });
        }
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

      // Cowork mode: auto-select defaults and start immediately
      if (appMode === "cowork") {
        const focuses = loadFocuses();
        dispatch({ type: "SET_FOCUSES", focuses });

        // Select Coworker agent, or fall back to first available
        const agentId = agents.has("coworker") ? "coworker" : Array.from(agents.keys())[0];
        if (!agentId) {
          dispatch({ type: "SET_ERROR", error: "No agents found" });
          return;
        }
        const agentConfig = agents.get(agentId)!;
        const agent: Agent = {
          id: agentId,
          name: agentConfig.name,
          role: agentConfig.role,
        };
        dispatch({ type: "SET_AGENT", agent });

        // Select Collaborator focus, or fall back to first available
        const focusId = focuses.has("collaborator") ? "collaborator" : Array.from(focuses.keys())[0];
        if (!focusId) {
          dispatch({ type: "SET_ERROR", error: "No focuses found" });
          return;
        }
        const focus = focuses.get(focusId)!;

        // Create thread and start cowork immediately
        const agentDir = path.join(Config.workspaceDir, "agents", agentId);
        const threadId = createThread(agentDir, "cowork");
        dispatch({ type: "SET_THREADS", threads: listThreads(agentDir) });
        dispatch({ type: "START_COWORK", threadId, focus });
        return;
      }

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
        role: agentConfig.role,
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
  }, [initialAgentId, appMode]);

  // Run TUI greeting when session starts
  useEffect(() => {
    if (appMode !== "chat") return;
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
  }, [appMode, state.agent, state.threadId, state.uiMode]);

  // Run cowork greeting when session starts
  useEffect(() => {
    if (appMode !== "cowork") return;
    if (greetingRunRef.current) return;
    if (!state.agent || !state.threadId || !state.focus) return;
    if (state.uiMode !== "cowork") return;

    greetingRunRef.current = true;

    const agentDir = path.join(Config.workspaceDir, "agents", state.agent.id);
    const coworkGreeting = `Cowork session started. You are watching files in ${workingDir} with the "${state.focus.name}" focus. Briefly greet the user and explain what you'll be looking for as they edit.`;

    dispatch({ type: "SET_LOADING", loading: true });

    runThread(
      agentDir,
      state.threadId,
      coworkGreeting,
      {
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
      { model: "haiku", maxTurns: 1, systemPromptSuffix: buildCoworkPrompt(state.focus, workingDir ?? process.cwd()) },
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
  }, [appMode, state.agent, state.threadId, state.focus, state.uiMode, workingDir]);

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
        onAssistantMessage(msg) {
          dispatch({ type: "SET_STATUS", status: msg });
        },
        onToolUse(_name, _input, summary) {
          dispatch({ type: "SET_STATUS", status: summary });
        },
      };

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Build cowork prompt suffix if in cowork mode
      const overrides = state.uiMode === "cowork" && state.focus && workingDir
        ? {
            systemPromptSuffix: buildCoworkPrompt(state.focus, workingDir),
            model: state.fastMode ? "haiku" as const : "opus" as const,
          }
        : undefined;

      try {
        const result = await runThread(
          agentDir,
          state.threadId,
          text,
          callbacks,
          undefined,
          undefined,
          abortController,
          overrides,
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
    [state.agent, state.threadId, state.uiMode, state.focus, state.fastMode, workingDir, exit, loadThreadsForAgent],
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

  const handleCoworkAgentSelect = useCallback((agentId: string) => {
    const agentConfig = state.agents.get(agentId);
    if (!agentConfig) return;

    const agent: Agent = {
      id: agentId,
      name: agentConfig.name,
      role: agentConfig.role,
    };
    dispatch({ type: "SET_AGENT", agent });
    dispatch({ type: "SET_UI_MODE", uiMode: "cowork-select-focus" });
  }, [state.agents]);

  // Run a greeting/session-start message (don't show user message, only response)
  const runGreeting = useCallback(async (
    agentId: string,
    threadId: string,
    greetingMessage: string,
    systemPromptSuffix?: string,
  ) => {
    dispatch({ type: "SET_LOADING", loading: true });

    const agentDir = path.join(Config.workspaceDir, "agents", agentId);

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
        threadId,
        greetingMessage,
        callbacks,
        undefined,
        undefined,
        undefined,
        { model: "haiku", maxTurns: 1, systemPromptSuffix },
      );

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
    } catch (err) {
      dispatch({ type: "SET_ERROR", error: (err as Error).message });
    } finally {
      dispatch({ type: "SET_STATUS", status: null });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, []);

  const handleFocusSelect = useCallback((focusId: string) => {
    const focus = state.focuses.get(focusId);
    if (!focus || !state.agent) return;

    // Always create a new cowork thread
    const agentDir = path.join(Config.workspaceDir, "agents", state.agent.id);
    const threadId = createThread(agentDir, "cowork");
    dispatch({ type: "SET_THREADS", threads: listThreads(agentDir) });
    dispatch({ type: "START_COWORK", threadId, focus });

    // Run cowork greeting
    const coworkGreeting = `Cowork session started. You are watching files in ${workingDir} with the "${focus.name}" focus. Briefly greet the user and explain what you'll be looking for as they edit.`;
    runGreeting(
      state.agent.id,
      threadId,
      coworkGreeting,
      buildCoworkPrompt(focus, workingDir ?? process.cwd()),
    );
  }, [state.focuses, state.agent, workingDir, runGreeting]);

  // Cowork: trigger callback when coordinator decides to run
  const handleCoworkTrigger = useCallback(async (files: string[]) => {
    if (!state.agent || !state.threadId || !state.focus || !workingDir) return;

    const message = files.length === 1
      ? `File changed: ${files[0]}`
      : `Files changed:\n${files.map(f => `- ${f}`).join("\n")}`;

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

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const overrides = {
      systemPromptSuffix: buildCoworkPrompt(state.focus, workingDir),
      model: state.fastMode ? "haiku" as const : "opus" as const,
    };

    try {
      const result = await runThread(
        agentDir,
        state.threadId,
        message,
        callbacks,
        undefined,
        undefined,
        abortController,
        overrides,
      );

      // Only add agent response to UI (not the trigger message)
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
      if (!abortController.signal.aborted) {
        dispatch({ type: "SET_ERROR", error: (err as Error).message });
      }
    } finally {
      abortControllerRef.current = null;
      dispatch({ type: "SET_STATUS", status: null });
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, [state.agent, state.threadId, state.focus, state.fastMode, workingDir]);

  // Cowork coordinator
  const coordinator = useCoordinator({
    debounceMs: 10000, // Wait 10 seconds after last change before triggering
    onTrigger: handleCoworkTrigger,
  });

  // File watcher for cowork mode
  useFileWatcher({
    workingDir: workingDir ?? process.cwd(),
    enabled: state.uiMode === "cowork",
    onFileChanged: coordinator.onFileChanged,
  });

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

  // Cowork setup screens
  if (state.uiMode === "cowork-select-agent") {
    return (
      <Box flexDirection="column" height="100%">
        <CoworkAgentSelect
          agents={state.agents}
          workingDir={workingDir ?? process.cwd()}
          onSelect={handleCoworkAgentSelect}
        />
      </Box>
    );
  }

  if (state.uiMode === "cowork-select-focus") {
    return (
      <Box flexDirection="column" height="100%">
        <FocusSelect
          focuses={state.focuses}
          agentName={state.agent?.name}
          onSelect={handleFocusSelect}
        />
      </Box>
    );
  }

  if (state.uiMode === "cowork") {
    const modeLabel = state.fastMode ? " ⚡ Fast" : " 🧠 Deep";
    const coworkStatusBar = (
      <CoworkStatusBar
        workingDir={workingDir ?? process.cwd()}
        agentName={state.agent?.name ?? null}
        focusName={state.focus?.name ? `${state.focus.name}${modeLabel}` : null}
        pendingFiles={coordinator.pendingFiles}
        hints="Tab · m:mode · f:focus · a:agent"
      />
    );

    // Minimal mode: just status bar + latest message
    if (state.minimalMode) {
      const lastMessage = state.messages.filter(m => m.role === "assistant").slice(-1)[0];
      const pendingCount = coordinator.pendingFiles.length;

      // Parse importance from message
      const parsed = lastMessage ? parseCoworkResponse(lastMessage.text) : null;
      const importanceColor = parsed?.importance === "low" ? "gray"
        : parsed?.importance === "high" ? "green"
        : undefined; // medium = default white

      const modeIndicator = state.fastMode ? " ⚡ Fast" : " 🧠 Deep";
      const minimalStatusBar = (
        <CoworkStatusBar
          workingDir={workingDir ?? process.cwd()}
          agentName={state.agent?.name ?? null}
          focusName={state.focus?.name ? `${state.focus.name}${modeIndicator}` : null}
          hints="Tab · m:mode · f:focus · a:agent"
        />
      );

      return (
        <Box flexDirection="column" height="100%">
          {minimalStatusBar}
          <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={2}>
            {state.loading ? (
              <Text dimColor>{state.status ?? "Thinking..."}</Text>
            ) : parsed ? (
              importanceColor ? (
                <Text bold color={importanceColor}>{parsed.message}</Text>
              ) : (
                <Text bold>{parsed.message}</Text>
              )
            ) : (
              <Text dimColor>Watching for changes...</Text>
            )}
            {state.error && (
              <Box marginTop={1}>
                <Text color="red">Error: {state.error}</Text>
              </Box>
            )}
            {pendingCount > 0 && !state.loading && (
              <Box marginTop={2}>
                <Text color="yellow">
                  {pendingCount === 1 ? "1 change pending..." : `${pendingCount} changes pending...`}
                </Text>
              </Box>
            )}
          </Box>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" height="100%">
        <Chat
          agent={state.agent}
          threadTitle={null}
          messages={state.messages}
          status={state.status}
          loading={state.loading}
          error={state.error}
          onSubmit={handleSubmit}
          selectComponent={null}
          statusBar={coworkStatusBar}
        />
      </Box>
    );
  }

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
