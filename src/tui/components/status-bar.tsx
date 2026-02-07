import React from "react";
import { Box, Text } from "ink";

interface Props {
  agentName: string | null;
  threadTitle: string | null;
}

export function StatusBar({ agentName, threadTitle }: Props) {
  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text dimColor>────────────────────────────────────────</Text>
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          {agentName ?? "No agent"}{threadTitle ? ` • ${threadTitle}` : ""} • /help
        </Text>
      </Box>
    </Box>
  );
}
