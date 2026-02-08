import type { SecurityLevel } from "../schemas.js";

export function buildDirectoriesBlock(cwd: string, directories: string[], security: SecurityLevel): string {
  if (security === "sandbox") return "";

  const lines: string[] = [
    `Your working directory is: ${cwd}`,
    "There may already be existing files — check before creating new ones.",
  ];

  if (directories.length > 0) {
    lines.push("");
    lines.push("You also have access to these additional directories:");
    for (const dir of directories) {
      lines.push(`- ${dir}`);
    }
  }

  if (security === "standard") {
    lines.push("");
    if (directories.length > 0) {
      lines.push("Only read and write files within your working directory and the additional directories listed above.");
      lines.push("Do NOT access files outside these directories.");
    } else {
      lines.push("Only read and write files within your working directory.");
      lines.push("Do NOT access files outside your working directory.");
    }
  }

  return `\n<Directories>\n${lines.join("\n")}\n</Directories>`;
}
