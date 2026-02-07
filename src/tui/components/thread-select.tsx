import React from "react";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import type { ThreadInfo } from "#core/index.js";

interface Props {
  threads: ThreadInfo[];
  onSelect: (threadId: string) => void;
  onCancel: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ThreadSelect({ threads, onSelect, onCancel }: Props) {
  const options = [
    ...threads.map((t) => ({
      label: `${t.manifest.title ?? t.id.slice(0, 8)} (${t.manifest.channel}, ${formatDate(t.manifest.updatedAt)})`,
      value: t.id,
    })),
    { label: "Cancel", value: "__cancel__" },
  ];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Select a thread:</Text>
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
