import chokidar, { type FSWatcher } from "chokidar";
import path from "path";

export type FileChangedCallback = (file: string) => void;

/**
 * Simple file watcher - detects .md file changes and emits events.
 * No debouncing, no state management - that's the Coordinator's job.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private workingDir: string;
  private onFileChanged: FileChangedCallback;

  constructor(workingDir: string, onFileChanged: FileChangedCallback) {
    this.workingDir = workingDir;
    this.onFileChanged = onFileChanged;
  }

  start(): void {
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.workingDir, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        /node_modules/,
      ],
      persistent: true,
      ignoreInitial: true,
    });

    const handleChange = (filePath: string) => {
      // Only handle .md files
      if (!filePath.endsWith(".md")) return;

      const relativePath = path.relative(this.workingDir, filePath);
      this.onFileChanged(relativePath);
    };

    this.watcher.on("change", handleChange);
    this.watcher.on("add", handleChange);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  isRunning(): boolean {
    return this.watcher !== null;
  }
}
