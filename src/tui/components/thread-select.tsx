import React from "react";
import { Box, Text, useStdout } from "ink";
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
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const visibleCount = Math.max(5, rows - 4);

  const options = [
    ...threads.map((t) => ({
      label: `${t.manifest.title ?? t.id.slice(0, 8)} (${t.manifest.channel}, ${formatDate(t.manifest.updatedAt)})`,
      value: t.id,
    })),
    { label: "Cancel", value: "__cancel__" },
  ];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>Select a thread:</Text>
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
