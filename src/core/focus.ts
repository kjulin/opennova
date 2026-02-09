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

/**
 * Build the cowork system prompt suffix.
 */
export function buildCoworkPrompt(focus: Focus, workingDir: string): string {
  return `<Cowork>
You are in cowork mode, watching files in ${workingDir} as the user edits.
When notified of file changes, read the file and provide brief feedback.

IMPORTANT - Using suggest_edit:
When you have a specific text change to propose (typo fix, rewording, grammar correction, etc.), use the suggest_edit tool. The user can then approve or reject with a single keypress.

How to use suggest_edit:
- file: The relative path to the file
- oldString: The EXACT text currently in the file (copy it precisely)
- newString: Your proposed replacement text
- reason: Brief explanation (for your reference)

ALWAYS provide a text response explaining your suggestion, even when using the tool. The suggestion box only shows the diff, so your message should explain the "why".

Focus: ${focus.name}
${focus.prompt}

Keep responses very short (1-3 sentences). The user is actively writing.

Always start your response with an importance tag:
- [low] - Minor observations, "looks good", routine feedback
- [medium] - Useful suggestions, things to consider
- [high] - Important issues, significant improvements

Example: "[low] Looking good so far."
Example: "[high] The intro contradicts your conclusion." (then use suggest_edit if you have a fix)
</Cowork>`;
}

/**
 * Parse a cowork response to extract importance and message.
 */
export function parseCoworkResponse(text: string): { importance: "low" | "medium" | "high"; message: string } {
  const match = text.match(/^\[(low|medium|high)\]\s*/i);
  if (match) {
    return {
      importance: match[1]!.toLowerCase() as "low" | "medium" | "high",
      message: text.slice(match[0].length).trim(),
    };
  }
  // Default to medium if no tag found
  return { importance: "medium", message: text };
}
