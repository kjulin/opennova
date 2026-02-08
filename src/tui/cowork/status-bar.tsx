import React from "react";
import { Box, Text, useStdout } from "ink";
import path from "path";

interface Props {
  workingDir: string;
  agentName: string | null;
  focusName: string | null;
  pendingFiles?: string[];
  hints?: string;
}

export function CoworkStatusBar({ workingDir, agentName, focusName, pendingFiles = [], hints }: Props) {
  const { stdout } = useStdout();
  const dirName = path.basename(workingDir);

  const pendingText = pendingFiles.length === 1
    ? `1 file change pending`
    : pendingFiles.length > 1
      ? `${pendingFiles.length} file changes pending`
      : null;

  const leftText = `Coworking in ${dirName} · ${agentName ?? "?"} as ${focusName ?? "?"}`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between" width={stdout?.columns ? stdout.columns - 2 : undefined}>
        <Text dimColor>{leftText}</Text>
        {hints && <Text dimColor>{hints}</Text>}
      </Box>
      {pendingText && (
        <Text color="yellow">{pendingText}</Text>
      )}
    </Box>
  );
}
