#!/bin/bash
# Migration script: Rename "working_arrangement" to "instructions" in all agent.json files
# One-time migration for the terminology rename. Safe to run multiple times.

set -euo pipefail

AGENTS_DIR="${HOME}/.nova/agents"
COUNT=0

if [ ! -d "$AGENTS_DIR" ]; then
  echo "No agents directory found at $AGENTS_DIR — nothing to migrate."
  exit 0
fi

for agent_dir in "$AGENTS_DIR"/*/; do
  config="$agent_dir/agent.json"
  [ -f "$config" ] || continue

  if grep -q '"working_arrangement"' "$config"; then
    # Use node for reliable JSON manipulation
    node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$config', 'utf-8'));
      if ('working_arrangement' in data) {
        data.instructions = data.working_arrangement;
        delete data.working_arrangement;
        fs.writeFileSync('$config', JSON.stringify(data, null, 2) + '\n');
      }
    "
    echo "Migrated: $config"
    COUNT=$((COUNT + 1))
  fi
done

echo "Done. Migrated $COUNT agent(s)."
