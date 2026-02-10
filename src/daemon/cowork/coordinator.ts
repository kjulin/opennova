export type TriggerCallback = (files: string[]) => Promise<void>;

/**
 * Coordinates file changes - collects pending files, debounces, triggers agent.
 * Tracks agent-authored files to prevent feedback loops.
 */
export class FileChangeCoordinator {
  private pendingFiles: string[] = [];
  private isProcessing = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private agentAuthoredFiles = new Set<string>();
  private debounceMs: number;
  private onTrigger: TriggerCallback;

  constructor(debounceMs: number, onTrigger: TriggerCallback) {
    this.debounceMs = debounceMs;
    this.onTrigger = onTrigger;
  }

  /**
   * Mark a file as authored by agent (to ignore subsequent changes).
   * Cleared after 2 seconds to allow the file system event to pass.
   */
  markAgentAuthored(file: string): void {
    this.agentAuthoredFiles.add(file);
    setTimeout(() => {
      this.agentAuthoredFiles.delete(file);
    }, 2000);
  }

  /**
   * Called when watcher detects a file change.
   */
  onFileChanged(file: string): void {
    // Ignore agent-authored files
    if (this.agentAuthoredFiles.has(file)) {
      return;
    }

    // Don't add duplicates
    if (!this.pendingFiles.includes(file)) {
      this.pendingFiles.push(file);
    }

    // Reset debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.processPending(), this.debounceMs);
  }

  /**
   * Manually trigger processing (for "cowork:run" command).
   */
  manualTrigger(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.processPending();
  }

  private async processPending(): Promise<void> {
    if (this.pendingFiles.length === 0 || this.isProcessing) {
      return;
    }

    const filesToProcess = [...this.pendingFiles];
    this.pendingFiles = [];
    this.isProcessing = true;

    try {
      await this.onTrigger(filesToProcess);
    } finally {
      this.isProcessing = false;
    }
  }

  getPendingFiles(): string[] {
    return [...this.pendingFiles];
  }

  getIsProcessing(): boolean {
    return this.isProcessing;
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingFiles = [];
    this.isProcessing = false;
    this.agentAuthoredFiles.clear();
  }
}
