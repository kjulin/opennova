import React, { useState } from "react";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import os from "os";
import path from "path";
import type { AgentConfig } from "#core/index.js";

interface Props {
  agents: Map<string, AgentConfig>;
  workingDir: string;
  onSelect: (agentId: string) => void;
}

function resolveDirectory(rawPath: string): string {
  if (rawPath.startsWith("~")) return path.join(os.homedir(), rawPath.slice(1));
  if (path.isAbsolute(rawPath)) return rawPath;
  return rawPath;
}

function agentMatchesDir(agent: AgentConfig, dir: string): boolean {
  if (!agent.directories || agent.directories.length === 0) return false;

  for (const agentDir of agent.directories) {
    const resolved = resolveDirectory(agentDir);
    // Check if workingDir is the same as or under one of the agent's directories
    if (dir === resolved || dir.startsWith(resolved + path.sep)) {
      return true;
    }
  }
  return false;
}

export function CoworkAgentSelect({ agents, workingDir, onSelect }: Props) {
  const [showAll, setShowAll] = useState(false);

  const matchingAgents = Array.from(agents.entries()).filter(
    ([, config]) => agentMatchesDir(config, workingDir)
  );
  const hasMatchingAgents = matchingAgents.length > 0;

  // If no matching agents or user wants to see all, show all agents
  const displayAgents = (!hasMatchingAgents || showAll)
    ? Array.from(agents.entries())
    : matchingAgents;

  const options = displayAgents.map(([id, config]) => ({
    label: `${config.name}${config.description ? ` - ${config.description}` : ""}`,
    value: id,
  }));

  // Add "Select other agent" option if showing filtered view
  if (hasMatchingAgents && !showAll) {
    options.push({
      label: "Select other agent...",
      value: "__show_all__",
    });
  }

  const handleChange = (value: string) => {
    if (value === "__show_all__") {
      setShowAll(true);
    } else {
      onSelect(value);
    }
  };

  const header = showAll
    ? "Select an agent:"
    : hasMatchingAgents
      ? `Agents for ${path.basename(workingDir)}:`
      : "Select an agent:";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{header}</Text>
      <Box marginTop={1}>
        <Select
          options={options}
          visibleOptionCount={15}
          onChange={handleChange}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>(esc to exit)</Text>
      </Box>
    </Box>
  );
}
