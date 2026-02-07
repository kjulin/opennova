import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { TextInput, Spinner } from "@inkjs/ui";
import { MessageView } from "./message.js";
import { StatusBar } from "./status-bar.js";
import type { Message, Agent } from "../types.js";

interface Props {
  agent: Agent | null;
  threadTitle: string | null;
  messages: Message[];
  status: string | null;
  loading: boolean;
  error: string | null;
  onSubmit: (text: string) => void;
}

export function Chat({
  agent,
  threadTitle,
  messages,
  status,
  loading,
  error,
  onSubmit,
}: Props) {
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = useCallback(
    (value: string) => {
      const text = value.trim();
      if (!text) return;
      setInputKey((k) => k + 1);
      onSubmit(text);
    },
    [onSubmit],
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
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
      <Box paddingX={1} paddingY={1}>
        <Text bold color="cyan">
          {">"}{" "}
        </Text>
        <TextInput
          key={inputKey}
          onSubmit={handleSubmit}
          isDisabled={loading}
          placeholder={loading ? "Waiting..." : "Type a message"}
        />
      </Box>
      <StatusBar agentName={agent?.name ?? null} threadTitle={threadTitle} />
    </Box>
  );
}
