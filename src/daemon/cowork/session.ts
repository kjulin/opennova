import path from "path";
import fs from "fs";
import {
  Config,
  createThread,
  loadAgents,
  loadFocuses,
  buildCoworkPrompt,
  parseCoworkResponse,
  type Focus,
  type EditSuggestion,
} from "#core/index.js";
import { runThread } from "../runner.js";
import { bus } from "../events.js";
import { log } from "../logger.js";
import { FileWatcher } from "./file-watcher.js";
import { FileChangeCoordinator } from "./coordinator.js";
import type { CoworkSessionConfig, CoworkSessionState } from "./types.js";

const DEFAULT_DEBOUNCE_MS = 4000;

/**
 * Orchestrates one cowork session: file watching, coordination, agent invocations.
 */
export class CoworkSession {
  private config: CoworkSessionConfig;
  private state: CoworkSessionState;
  private watcher: FileWatcher | null = null;
  private coordinator: FileChangeCoordinator | null = null;
  private abortController: AbortController | null = null;
  private focus: Focus | null = null;

  constructor(config: CoworkSessionConfig) {
    this.config = {
      ...config,
      debounceMs: config.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    };
    this.state = {
      status: "starting",
      pendingFiles: [],
      currentSuggestion: null,
      threadId: null,
      agentId: config.agentId,
      focusId: config.focusId,
    };
  }

  async start(): Promise<void> {
    log.info("cowork", `starting session for agent=${this.config.agentId} focus=${this.config.focusId}`);

    // Validate agent exists
    const agents = loadAgents();
    if (!agents.has(this.config.agentId)) {
      this.state.status = "error";
      throw new Error(`Agent not found: ${this.config.agentId}`);
    }

    // Validate focus exists
    const focuses = loadFocuses();
    this.focus = focuses.get(this.config.focusId) ?? null;
    if (!this.focus) {
      this.state.status = "error";
      throw new Error(`Focus not found: ${this.config.focusId}`);
    }

    // Create thread
    const agentDir = path.join(Config.workspaceDir, "agents", this.config.agentId);
    const threadId = createThread(agentDir, "cowork");
    this.state.threadId = threadId;

    // Set up coordinator
    this.coordinator = new FileChangeCoordinator(
      this.config.debounceMs!,
      (files) => this.handleTrigger(files),
    );

    // Set up file watcher
    this.watcher = new FileWatcher(
      this.config.vaultPath,
      (file) => this.handleFileChanged(file),
    );
    this.watcher.start();

    this.state.status = "watching";
    this.emitStatus();

    // Run greeting
    await this.runGreeting();
  }

  async stop(): Promise<void> {
    log.info("cowork", "stopping session");

    // Abort any running request
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Stop watcher
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }

    // Stop coordinator
    if (this.coordinator) {
      this.coordinator.stop();
      this.coordinator = null;
    }

    this.state.status = "idle";
    this.emitStatus();
  }

  async applySuggestion(id: string): Promise<void> {
    if (!this.state.currentSuggestion || this.state.currentSuggestion.id !== id) {
      log.warn("cowork", `suggestion ${id} not found or expired`);
      return;
    }

    const suggestion = this.state.currentSuggestion;
    const filePath = path.isAbsolute(suggestion.file)
      ? suggestion.file
      : path.join(this.config.vaultPath, suggestion.file);

    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      if (!content.includes(suggestion.oldString)) {
        bus.emit("cowork:message", {
          text: "Could not find text to replace - file may have changed",
          importance: "high",
        });
        this.state.currentSuggestion = null;
        this.emitStatus();
        return;
      }

      // Mark file as agent-authored to prevent feedback loop
      if (this.coordinator) {
        this.coordinator.markAgentAuthored(suggestion.file);
      }

      const newContent = content.replace(suggestion.oldString, suggestion.newString);
      await fs.promises.writeFile(filePath, newContent);

      bus.emit("cowork:message", {
        text: `Applied edit to ${suggestion.file}`,
        importance: "low",
      });

      this.state.currentSuggestion = null;
      this.emitStatus();
    } catch (err) {
      bus.emit("cowork:message", {
        text: `Failed to apply edit: ${(err as Error).message}`,
        importance: "high",
      });
      this.state.currentSuggestion = null;
      this.emitStatus();
    }
  }

  rejectSuggestion(id: string): void {
    if (this.state.currentSuggestion?.id === id) {
      this.state.currentSuggestion = null;
      this.emitStatus();
    }
  }

  manualTrigger(): void {
    if (this.coordinator) {
      this.coordinator.manualTrigger();
    }
  }

  getState(): CoworkSessionState {
    return { ...this.state };
  }

  private handleFileChanged(file: string): void {
    // Clear suggestion if target file changed
    if (this.state.currentSuggestion?.file === file) {
      this.state.currentSuggestion = null;
    }

    if (this.coordinator) {
      this.coordinator.onFileChanged(file);
      this.state.pendingFiles = this.coordinator.getPendingFiles();
      this.emitStatus();
    }
  }

  private async handleTrigger(files: string[]): Promise<void> {
    if (!this.state.threadId || !this.focus) return;

    this.state.status = "processing";
    this.state.pendingFiles = [];
    this.emitStatus();

    const message = files.length === 1
      ? `File changed: ${files[0]}`
      : `Files changed:\n${files.map(f => `- ${f}`).join("\n")}`;

    await this.runAgent(message);

    this.state.status = "watching";
    this.emitStatus();
  }

  private async runGreeting(): Promise<void> {
    if (!this.state.threadId || !this.focus) return;

    const greetingMessage = `Cowork session started. You are watching files in ${this.config.vaultPath} with the "${this.focus.name}" focus. Briefly greet the user and explain what you'll be looking for as they edit.`;

    await this.runAgent(greetingMessage, { model: "haiku", maxTurns: 1 });
  }

  private async runAgent(
    message: string,
    options: { model?: "haiku" | "opus"; maxTurns?: number } = {},
  ): Promise<void> {
    if (!this.state.threadId || !this.focus) return;

    const agentDir = path.join(Config.workspaceDir, "agents", this.config.agentId);
    const abortController = new AbortController();
    this.abortController = abortController;

    const model = options.model ?? this.config.model ?? "opus";
    const overrides = {
      systemPromptSuffix: buildCoworkPrompt(this.focus, this.config.vaultPath),
      model,
      maxTurns: options.maxTurns,
      onSuggestEdit: (suggestion: EditSuggestion) => this.handleSuggestion(suggestion),
    };

    try {
      bus.emit("cowork:status", { status: "thinking", pendingFiles: [] });

      const result = await runThread(
        agentDir,
        this.state.threadId,
        message,
        {
          onThinking() {
            bus.emit("cowork:status", { status: "thinking", pendingFiles: [] });
          },
          onToolUse() {
            bus.emit("cowork:status", { status: "working", pendingFiles: [] });
          },
        },
        undefined,
        undefined,
        abortController,
        overrides,
      );

      if (!abortController.signal.aborted && result.text) {
        const { importance, message: text } = parseCoworkResponse(result.text);
        bus.emit("cowork:message", {
          text,
          importance: importance === "medium" ? "high" : importance,
        });
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        log.error("cowork", "agent run failed:", err);
        bus.emit("cowork:message", {
          text: `Error: ${(err as Error).message}`,
          importance: "high",
        });
      }
    } finally {
      this.abortController = null;
      bus.emit("cowork:status", { status: "idle", pendingFiles: this.state.pendingFiles });
    }
  }

  private handleSuggestion(suggestion: EditSuggestion): void {
    this.state.currentSuggestion = suggestion;
    bus.emit("cowork:suggestion", suggestion);
    this.emitStatus();
  }

  private emitStatus(): void {
    bus.emit("cowork:status", {
      status: this.state.status === "processing" ? "working"
        : this.state.status === "watching" ? "idle"
        : "idle",
      pendingFiles: this.state.pendingFiles,
    });
  }
}
