import React, { useState, useCallback, useMemo, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput, Spinner, Select } from "@inkjs/ui";
import { MessageView } from "./message.js";
import { StatusBar } from "./status-bar.js";
import { Divider } from "./divider.js";
import type { Message, Agent } from "../types.js";

const COMMANDS = [
  { value: "/new", label: "/new - Start a new thread" },
  { value: "/threads", label: "/threads - Switch thread" },
  { value: "/agents", label: "/agents - Switch agent" },
  { value: "/help", label: "/help - Show commands" },
  { value: "/exit", label: "/exit - Exit chat" },
];

interface Props {
  agent: Agent | null;
  threadTitle: string | null;
  messages: Message[];
  status: string | null;
  loading: boolean;
  error: string | null;
  onSubmit: (text: string) => void;
  selectComponent?: React.ReactNode | undefined;
}

export function Chat({
  agent,
  threadTitle,
  messages,
  status,
  loading,
  error,
  onSubmit,
  selectComponent,
}: Props) {
  const [inputKey, setInputKey] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const lastEscRef = useRef(0);

  // Double Esc clears input
  useInput((_input, key) => {
    if (key.escape && inputValue) {
      const now = Date.now();
      if (now - lastEscRef.current < 500) {
        setInputKey((k) => k + 1);
        setInputValue("");
        lastEscRef.current = 0;
      } else {
        lastEscRef.current = now;
      }
    }
  });

  const handleSubmit = useCallback(
    (value: string) => {
      const text = value.trim();
      if (!text) return;
      // If typing a command, let the Select handle it
      if (text.startsWith("/")) {
        return;
      }
      setInputKey((k) => k + 1);
      setInputValue("");
      onSubmit(text);
    },
    [onSubmit],
  );

  const handleCommandSelect = useCallback(
    (command: string) => {
      setInputKey((k) => k + 1);
      setInputValue("");
      onSubmit(command);
    },
    [onSubmit],
  );

  const filteredCommands = useMemo(() => {
    if (!inputValue.startsWith("/")) return [];
    const search = inputValue.toLowerCase();
    const filtered = COMMANDS.filter((cmd) => cmd.value.startsWith(search));
    // If no matches, show all commands
    return filtered.length > 0 ? filtered : COMMANDS;
  }, [inputValue]);

  const showCommandSelect = inputValue.startsWith("/");

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingBottom={1}>
        {messages.map((msg) => (
          <MessageView key={`${msg.role}-${msg.timestamp}`} message={msg} agentName={agent?.name} />
        ))}
        {error && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}
        {loading && (
          <Box marginTop={1}>
            <Spinner label={status ?? "Thinking..."} />
          </Box>
        )}
      </Box>
      <Divider />
      {selectComponent ? (
        selectComponent
      ) : (
        <>
          <Box paddingX={1}>
            <Text bold color="cyan">
              {">"}{" "}
            </Text>
            <TextInput
              key={inputKey}
              onSubmit={handleSubmit}
              onChange={setInputValue}
              isDisabled={loading}
            />
          </Box>
          <Divider />
          {showCommandSelect ? (
            <Box paddingX={1} height={5}>
              <Select
                options={filteredCommands.filter(cmd => cmd.value)}
                visibleOptionCount={5}
                onChange={handleCommandSelect}
              />
            </Box>
          ) : (
            <StatusBar agentName={agent?.name ?? null} threadTitle={threadTitle} />
          )}
          <Box marginBottom={1} />
        </>
      )}
    </Box>
  );
}
