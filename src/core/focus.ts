import fs from "fs";
import path from "path";
import { Config } from "./config.js";

export interface Focus {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

/**
 * Parse a YAML-like focus file.
 * Simple parser for our specific format - not a full YAML parser.
 */
function parseFocusFile(content: string): Omit<Focus, "id"> | null {
  const lines = content.split("\n");
  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let multilineValue: string[] = [];
  let inMultiline = false;

  for (const line of lines) {
    if (inMultiline) {
      if (line.startsWith("  ")) {
        multilineValue.push(line.slice(2));
      } else if (line.trim() === "") {
        multilineValue.push("");
      } else {
        // End of multiline
        if (currentKey) {
          result[currentKey] = multilineValue.join("\n").trim();
        }
        inMultiline = false;
        currentKey = null;
        multilineValue = [];
      }
    }

    if (!inMultiline) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (value === "|") {
          currentKey = key!;
          inMultiline = true;
          multilineValue = [];
        } else if (value) {
          result[key!] = value;
        }
      }
    }
  }

  // Handle end of file for multiline
  if (inMultiline && currentKey) {
    result[currentKey] = multilineValue.join("\n").trim();
  }

  if (!result.name || !result.prompt) {
    return null;
  }

  return {
    name: result.name,
    description: result.description ?? "",
    prompt: result.prompt,
  };
}

/**
 * Load all focuses from the workspace cowork/focus directory.
 */
export function loadFocuses(): Map<string, Focus> {
  const focusDir = path.join(Config.workspaceDir, "cowork", "focus");
  const focuses = new Map<string, Focus>();

  if (!fs.existsSync(focusDir)) {
    return focuses;
  }

  for (const file of fs.readdirSync(focusDir)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;

    const id = file.replace(/\.ya?ml$/, "");
    const filePath = path.join(focusDir, file);

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = parseFocusFile(content);
      if (parsed) {
        focuses.set(id, { id, ...parsed });
      }
    } catch {
      // Skip invalid files
    }
  }

  return focuses;
}

/**
 * Get a single focus by ID.
 */
export function getFocus(id: string): Focus | null {
  const focuses = loadFocuses();
  return focuses.get(id) ?? null;
}
