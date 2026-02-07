import React from "react";
import { Box, Text } from "ink";

interface Props {
  agentName: string | null;
  threadId: string | null;
}

export function StatusBar({ agentName, threadId }: Props) {
  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
      <Text dimColor>
        {agentName ?? "No agent"} • {threadId ? `Thread: ${threadId.slice(0, 8)}` : "No thread"} • /new /exit
      </Text>
    </Box>
  );
}
