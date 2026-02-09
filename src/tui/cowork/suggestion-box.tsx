import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import path from "path";
import type { EditSuggestion } from "#core/index.js";

interface Props {
  suggestion: EditSuggestion;
}

export function SuggestionBox({ suggestion }: Props) {
  const [timeRemaining, setTimeRemaining] = useState(() =>
    Math.max(0, Math.ceil((suggestion.expiresAt - Date.now()) / 1000))
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRemaining(Math.max(0, Math.ceil((suggestion.expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [suggestion.expiresAt]);

  const fileName = path.basename(suggestion.file);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text bold color="yellow">
          {fileName}
        </Text>
        <Text dimColor>[y] apply  [n] reject  ({timeRemaining}s)</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color="red">- {suggestion.oldString}</Text>
        <Text color="green">+ {suggestion.newString}</Text>
      </Box>
    </Box>
  );
}
