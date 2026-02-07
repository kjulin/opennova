import React from "react";
import { Text, Box } from "ink";
import type { Message } from "../types.js";

interface Props {
  message: Message;
  agentName?: string | undefined;
}

export function MessageView({ message, agentName }: Props) {
  if (message.role === "user") {
    return (
      <Box marginTop={1}>
        <Text bold color="cyan">
          You: {message.text}
        </Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold color="green">
        {agentName ?? "Assistant"}:
      </Text>
      <Text>{message.text}</Text>
    </Box>
  );
}
