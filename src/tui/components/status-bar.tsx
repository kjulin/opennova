import React from "react";
import { Box, Text } from "ink";

interface Props {
  agentName: string | null;
  threadTitle: string | null;
}

export function StatusBar({ agentName, threadTitle }: Props) {
  return (
    <Box paddingX={1}>
      <Text dimColor>
        Chatting with {agentName ?? "?"}{threadTitle ? ` · ${threadTitle}` : ""}
      </Text>
    </Box>
  );
}
