export function buildDirectoriesBlock(cwd: string, directories: string[]): string {
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

  return `\n<Directories>\n${lines.join("\n")}\n</Directories>`;
}
