import React from "react";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import type { Focus } from "#core/index.js";

interface Props {
  focuses: Map<string, Focus>;
  agentName?: string | undefined;
  onSelect: (focusId: string) => void;
}

export function FocusSelect({ focuses, agentName, onSelect }: Props) {
  // Sort with collaborator first, then alphabetically
  const sorted = Array.from(focuses.values()).sort((a, b) => {
    if (a.id === "collaborator") return -1;
    if (b.id === "collaborator") return 1;
    return a.name.localeCompare(b.name);
  });

  const options = sorted.map((f) => ({
    label: `${f.name} - ${f.description}`,
    value: f.id,
  }));

  const header = agentName ? `Select a focus for ${agentName}:` : "Select a focus:";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{header}</Text>
      <Box marginTop={1}>
        <Select
          options={options}
          visibleOptionCount={10}
          onChange={onSelect}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>(esc to go back)</Text>
      </Box>
    </Box>
  );
}
