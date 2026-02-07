import React from "react";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import type { AgentConfig } from "#core/index.js";

interface Props {
  agents: Map<string, AgentConfig>;
  currentAgentId: string | null;
  onSelect: (agentId: string) => void;
  onCancel: () => void;
}

export function AgentSelect({ agents, currentAgentId, onSelect, onCancel }: Props) {
  const options = [
    ...Array.from(agents.entries()).map(([id, config]) => ({
      label: `${config.name}${id === currentAgentId ? " (current)" : ""} - ${config.role}`,
      value: id,
    })),
    { label: "Cancel", value: "__cancel__" },
  ];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Select an agent:</Text>
      <Box marginTop={1}>
        <Select
          options={options}
          onChange={(value) => {
            if (value === "__cancel__") {
              onCancel();
            } else {
              onSelect(value);
            }
          }}
        />
      </Box>
    </Box>
  );
}
