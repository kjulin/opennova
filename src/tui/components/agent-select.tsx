import React from "react";
import { Box, Text, useStdout } from "ink";
import { Select } from "@inkjs/ui";
import type { AgentConfig } from "#core/index.js";

interface Props {
  agents: Map<string, AgentConfig>;
  currentAgentId: string | null;
  onSelect: (agentId: string) => void;
  onCancel: () => void;
}

export function AgentSelect({ agents, currentAgentId, onSelect, onCancel }: Props) {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const visibleCount = Math.max(5, rows - 4);

  const options = [
    ...Array.from(agents.entries()).map(([id, config]) => ({
      label: `${config.name}${id === currentAgentId ? " (current)" : ""}`,
      value: id,
    })),
    { label: "Cancel", value: "__cancel__" },
  ];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>Select an agent:</Text>
      <Box marginTop={1} flexGrow={1}>
        <Select
          options={options}
          visibleOptionCount={visibleCount}
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
