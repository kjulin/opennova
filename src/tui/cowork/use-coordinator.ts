import { useCallback, useRef, useState } from "react";

interface UseCoordinatorOptions {
  debounceMs?: number;
  onTrigger: (files: string[]) => Promise<void>;
}

interface CoordinatorState {
  pendingFiles: string[];
  isProcessing: boolean;
}

/**
 * Coordinates file changes - collects pending files, debounces, triggers agent.
 * Tracks agent-authored files to prevent feedback loops.
 */
export function useCoordinator({
  debounceMs = 1000,
  onTrigger,
}: UseCoordinatorOptions) {
  const [state, setState] = useState<CoordinatorState>({
    pendingFiles: [],
    isProcessing: false,
  });

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const agentAuthoredFilesRef = useRef<Set<string>>(new Set());

  // Mark a file as authored by agent (to ignore subsequent changes)
  const markAgentAuthored = useCallback((file: string) => {
    agentAuthoredFilesRef.current.add(file);
    // Clear after a short delay to allow the file system event to pass
    setTimeout(() => {
      agentAuthoredFilesRef.current.delete(file);
    }, 2000);
  }, []);

  // Process pending files
  const processPending = useCallback(async () => {
    setState((prev) => {
      if (prev.pendingFiles.length === 0 || prev.isProcessing) {
        return prev;
      }

      const filesToProcess = [...prev.pendingFiles];

      // Start processing asynchronously
      (async () => {
        try {
          await onTrigger(filesToProcess);
        } finally {
          setState((s) => ({ ...s, isProcessing: false }));
        }
      })();

      return {
        pendingFiles: [],
        isProcessing: true,
      };
    });
  }, [onTrigger]);

  // Called when watcher detects a file change
  const onFileChanged = useCallback((file: string) => {
    // Ignore agent-authored files
    if (agentAuthoredFilesRef.current.has(file)) {
      return;
    }

    setState((prev) => {
      // Don't add duplicates
      if (prev.pendingFiles.includes(file)) {
        return prev;
      }
      return {
        ...prev,
        pendingFiles: [...prev.pendingFiles, file],
      };
    });

    // Reset debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(processPending, debounceMs);
  }, [debounceMs, processPending]);

  return {
    pendingFiles: state.pendingFiles,
    isProcessing: state.isProcessing,
    onFileChanged,
    markAgentAuthored,
  };
}
