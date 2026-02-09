import { useEffect, useRef } from "react";
import chokidar, { type FSWatcher } from "chokidar";
import path from "path";

interface UseFileWatcherOptions {
  workingDir: string;
  enabled: boolean;
  onFileChanged: (file: string) => void;
}

/**
 * Simple file watcher - just detects changes and emits events.
 * No debouncing, no state management.
 */
export function useFileWatcher({
  workingDir,
  enabled,
  onFileChanged,
}: UseFileWatcherOptions) {
  const watcherRef = useRef<FSWatcher | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const watcher = chokidar.watch(workingDir, {
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

      const relativePath = path.relative(workingDir, filePath);
      onFileChanged(relativePath);
    };

    watcher.on("change", handleChange);
    watcher.on("add", handleChange);

    watcherRef.current = watcher;

    return () => {
      watcher.close();
      watcherRef.current = null;
    };
  }, [workingDir, enabled, onFileChanged]);
}
