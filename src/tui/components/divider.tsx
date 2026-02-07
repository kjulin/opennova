import React from "react";
import { Box, Text, useStdout } from "ink";

export function Divider() {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  return (
    <Box>
      <Text dimColor>{"─".repeat(width)}</Text>
    </Box>
  );
}
