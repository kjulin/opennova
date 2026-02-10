import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, Notice } from "obsidian";

const VIEW_TYPE_NOVA = "nova-cowork-view";
const DEFAULT_WS_PORT = 3737;

interface NovaPluginSettings {
  wsPort: number;
  autoConnect: boolean;
}

const DEFAULT_SETTINGS: NovaPluginSettings = {
  wsPort: DEFAULT_WS_PORT,
  autoConnect: true,
};

// WebSocket message types
interface CoworkMessage {
  type: "cowork:message";
  text: string;
  importance: "high" | "low";
}

interface CoworkSuggestion {
  type: "cowork:suggestion";
  id: string;
  file: string;
  oldString: string;
  newString: string;
  reason: string;
  expiresAt: number;
}

interface CoworkStatus {
  type: "cowork:status";
  status: "thinking" | "working" | "idle";
  pendingFiles?: string[];
}

interface CoworkStarted {
  type: "cowork:started";
  threadId: string;
  agentId: string;
  focusId: string;
}

interface CoworkAgents {
  type: "cowork:agents";
  agents: Array<{ id: string; name: string; description?: string }>;
}

interface CoworkFocuses {
  type: "cowork:focuses";
  focuses: Array<{ id: string; name: string; description?: string }>;
}

interface CoworkError {
  type: "cowork:error";
  error: string;
}

type ServerMessage =
  | CoworkMessage
  | CoworkSuggestion
  | CoworkStatus
  | CoworkStarted
  | CoworkAgents
  | CoworkFocuses
  | CoworkError
  | { type: "connected" }
  | { type: "cowork:stopped" };

export default class NovaPlugin extends Plugin {
  settings: NovaPluginSettings;
  ws: WebSocket | null = null;
  view: NovaCoworkView | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_NOVA, (leaf) => {
      this.view = new NovaCoworkView(leaf, this);
      return this.view;
    });

    this.addRibbonIcon("brain-circuit", "Open Nova Cowork", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-nova-cowork",
      name: "Open Nova Cowork panel",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "connect-nova",
      name: "Connect to Nova daemon",
      callback: () => this.connect(),
    });

    this.addCommand({
      id: "disconnect-nova",
      name: "Disconnect from Nova daemon",
      callback: () => this.disconnect(),
    });

    this.addCommand({
      id: "start-cowork",
      name: "Start cowork session",
      callback: () => this.startCowork(),
    });

    this.addCommand({
      id: "stop-cowork",
      name: "Stop cowork session",
      callback: () => this.stopCowork(),
    });

    this.addSettingTab(new NovaSettingTab(this.app, this));

    if (this.settings.autoConnect) {
      // Delay connection to let the UI settle
      setTimeout(() => this.connect(), 1000);
    }
  }

  onunload() {
    this.disconnect();
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_NOVA)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: VIEW_TYPE_NOVA, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      new Notice("Already connected to Nova");
      return;
    }

    const url = `ws://localhost:${this.settings.wsPort}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      new Notice("Connected to Nova daemon");
      this.view?.setConnected(true);
      // Request current agents and focuses
      this.send({ type: "cowork:list-agents" });
      this.send({ type: "cowork:list-focuses" });
    };

    this.ws.onclose = () => {
      this.view?.setConnected(false);
      this.view?.setSessionActive(false);
    };

    this.ws.onerror = () => {
      new Notice("Failed to connect to Nova daemon");
      this.view?.setConnected(false);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        this.handleMessage(msg);
      } catch (e) {
        console.error("Nova: Failed to parse message", e);
      }
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.view?.setConnected(false);
      this.view?.setSessionActive(false);
    }
  }

  send(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "connected":
        this.view?.setConnected(true);
        break;
      case "cowork:message":
        this.view?.addMessage(msg.text, msg.importance);
        break;
      case "cowork:suggestion":
        this.view?.setSuggestion(msg);
        break;
      case "cowork:status":
        this.view?.setStatus(msg.status, msg.pendingFiles);
        break;
      case "cowork:started":
        this.view?.setSessionActive(true, msg.agentId, msg.focusId);
        new Notice("Cowork session started");
        break;
      case "cowork:stopped":
        this.view?.setSessionActive(false);
        new Notice("Cowork session stopped");
        break;
      case "cowork:agents":
        this.view?.setAgents(msg.agents);
        break;
      case "cowork:focuses":
        this.view?.setFocuses(msg.focuses);
        break;
      case "cowork:error":
        new Notice(`Nova error: ${msg.error}`);
        break;
    }
  }

  getVaultPath(): string {
    // Get the vault's base path
    const adapter = this.app.vault.adapter;
    if ("basePath" in adapter) {
      return (adapter as any).basePath;
    }
    // Fallback - try to get from vault name
    return this.app.vault.getName();
  }

  startCowork(agentId?: string, focusId?: string) {
    const vaultPath = this.getVaultPath();
    this.send({
      type: "cowork:start",
      vaultPath,
      ...(agentId ? { agentId } : {}),
      ...(focusId ? { focusId } : {}),
    });
  }

  stopCowork() {
    this.send({ type: "cowork:stop" });
  }

  manualRun() {
    this.send({ type: "cowork:run" });
  }

  async applySuggestion(suggestion: CoworkSuggestion) {
    const file = this.app.vault.getAbstractFileByPath(suggestion.file);
    if (!file || !("path" in file)) {
      new Notice(`File not found: ${suggestion.file}`);
      return;
    }

    try {
      const content = await this.app.vault.read(file as any);
      if (!content.includes(suggestion.oldString)) {
        new Notice("Original text not found in file");
        return;
      }

      const newContent = content.replace(suggestion.oldString, suggestion.newString);
      await this.app.vault.modify(file as any, newContent);

      this.send({ type: "suggestion:apply", id: suggestion.id });
      this.view?.clearSuggestion();
      new Notice("Edit applied");
    } catch (e) {
      new Notice(`Failed to apply edit: ${(e as Error).message}`);
    }
  }

  rejectSuggestion(suggestion: CoworkSuggestion) {
    this.send({ type: "suggestion:reject", id: suggestion.id });
    this.view?.clearSuggestion();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

interface AgentInfo {
  id: string;
  name: string;
  description?: string;
}

interface FocusInfo {
  id: string;
  name: string;
  description?: string;
}

class NovaCoworkView extends ItemView {
  plugin: NovaPlugin;
  connected = false;
  sessionActive = false;
  currentAgentId: string | null = null;
  currentFocusId: string | null = null;
  status: "thinking" | "working" | "idle" = "idle";
  pendingFiles: string[] = [];
  messages: Array<{ text: string; importance: "high" | "low"; time: Date }> = [];
  currentSuggestion: CoworkSuggestion | null = null;
  agents: AgentInfo[] = [];
  focuses: FocusInfo[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: NovaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_NOVA;
  }

  getDisplayText() {
    return "Nova Cowork";
  }

  getIcon() {
    return "brain-circuit";
  }

  async onOpen() {
    this.render();
  }

  async onClose() {
    // Cleanup if needed
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    if (!connected) {
      this.sessionActive = false;
      this.agents = [];
      this.focuses = [];
    }
    this.render();
  }

  setSessionActive(active: boolean, agentId?: string, focusId?: string) {
    this.sessionActive = active;
    this.currentAgentId = agentId ?? null;
    this.currentFocusId = focusId ?? null;
    if (!active) {
      this.messages = [];
      this.currentSuggestion = null;
    }
    this.render();
  }

  setAgents(agents: AgentInfo[]) {
    this.agents = agents;
    this.render();
  }

  setFocuses(focuses: FocusInfo[]) {
    this.focuses = focuses;
    this.render();
  }

  setStatus(status: "thinking" | "working" | "idle", pendingFiles?: string[]) {
    this.status = status;
    this.pendingFiles = pendingFiles ?? [];
    this.render();
  }

  addMessage(text: string, importance: "high" | "low") {
    this.messages.unshift({ text, importance, time: new Date() });
    // Keep last 50 messages
    if (this.messages.length > 50) {
      this.messages = this.messages.slice(0, 50);
    }
    this.render();
  }

  setSuggestion(suggestion: CoworkSuggestion) {
    this.currentSuggestion = suggestion;
    this.render();
  }

  clearSuggestion() {
    this.currentSuggestion = null;
    this.render();
  }

  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("nova-cowork-container");

    // Header with connection status
    const header = container.createDiv({ cls: "nova-header" });
    header.createSpan({ cls: `nova-status-dot ${this.connected ? "connected" : "disconnected"}` });
    header.createSpan({ text: this.connected ? "Connected" : "Disconnected", cls: "nova-status-text" });

    if (!this.connected) {
      const connectBtn = header.createEl("button", { text: "Connect", cls: "nova-connect-btn" });
      connectBtn.onclick = () => this.plugin.connect();
      return; // Don't render anything else if disconnected
    }

    // Session controls
    const controls = container.createDiv({ cls: "nova-controls" });

    if (this.sessionActive) {
      // Active session info
      const sessionInfo = controls.createDiv({ cls: "nova-session-info" });
      const agentName = this.agents.find(a => a.id === this.currentAgentId)?.name ?? this.currentAgentId;
      const focusName = this.focuses.find(f => f.id === this.currentFocusId)?.name ?? this.currentFocusId;
      sessionInfo.createSpan({ text: `${agentName} / ${focusName}`, cls: "nova-session-label" });

      const btnGroup = controls.createDiv({ cls: "nova-btn-group" });

      const runBtn = btnGroup.createEl("button", { text: "Run", cls: "nova-btn nova-btn-run" });
      runBtn.onclick = () => this.plugin.manualRun();

      const stopBtn = btnGroup.createEl("button", { text: "Stop", cls: "nova-btn nova-btn-stop" });
      stopBtn.onclick = () => this.plugin.stopCowork();
    } else {
      // Session start controls
      const startControls = controls.createDiv({ cls: "nova-start-controls" });

      // Agent dropdown
      const agentGroup = startControls.createDiv({ cls: "nova-select-group" });
      agentGroup.createEl("label", { text: "Agent", cls: "nova-select-label" });
      const agentSelect = agentGroup.createEl("select", { cls: "nova-select" });
      for (const agent of this.agents) {
        const option = agentSelect.createEl("option", { text: agent.name, value: agent.id });
        if (agent.id === "coworker") option.selected = true;
      }

      // Focus dropdown
      const focusGroup = startControls.createDiv({ cls: "nova-select-group" });
      focusGroup.createEl("label", { text: "Focus", cls: "nova-select-label" });
      const focusSelect = focusGroup.createEl("select", { cls: "nova-select" });
      for (const focus of this.focuses) {
        const option = focusSelect.createEl("option", { text: focus.name, value: focus.id });
        if (focus.id === "collaborator") option.selected = true;
      }

      // Start button
      const startBtn = startControls.createEl("button", { text: "Start Cowork", cls: "nova-btn nova-btn-start" });
      startBtn.onclick = () => {
        this.plugin.startCowork(agentSelect.value, focusSelect.value);
      };
    }

    // Status bar (only when session is active)
    if (this.sessionActive) {
      const statusBar = container.createDiv({ cls: "nova-status-bar" });
      const statusText = this.status === "thinking" ? "Thinking..."
        : this.status === "working" ? "Working..."
        : "Watching";
      statusBar.createSpan({ text: statusText, cls: `nova-status nova-status-${this.status}` });

      if (this.pendingFiles.length > 0) {
        statusBar.createSpan({
          text: ` (${this.pendingFiles.length} pending)`,
          cls: "nova-pending-count"
        });
      }
    }

    // Suggestion card
    if (this.currentSuggestion) {
      this.renderSuggestion(container, this.currentSuggestion);
    }

    // Messages
    const messagesContainer = container.createDiv({ cls: "nova-messages" });

    if (this.sessionActive) {
      for (const msg of this.messages) {
        const msgEl = messagesContainer.createDiv({
          cls: `nova-message nova-message-${msg.importance}`
        });
        msgEl.createDiv({ text: msg.text, cls: "nova-message-text" });
        msgEl.createDiv({
          text: this.formatTime(msg.time),
          cls: "nova-message-time"
        });
      }

      if (this.messages.length === 0) {
        messagesContainer.createDiv({
          text: "Watching for file changes...",
          cls: "nova-empty-state"
        });
      }
    } else {
      messagesContainer.createDiv({
        text: "Start a cowork session to begin",
        cls: "nova-empty-state"
      });
    }
  }

  renderSuggestion(container: HTMLElement, suggestion: CoworkSuggestion) {
    const card = container.createDiv({ cls: "nova-suggestion-card" });

    const header = card.createDiv({ cls: "nova-suggestion-header" });
    header.createSpan({ text: suggestion.file, cls: "nova-suggestion-file" });

    if (suggestion.reason) {
      card.createDiv({ text: suggestion.reason, cls: "nova-suggestion-reason" });
    }

    const diff = card.createDiv({ cls: "nova-suggestion-diff" });
    diff.createDiv({ text: `- ${suggestion.oldString}`, cls: "nova-diff-remove" });
    diff.createDiv({ text: `+ ${suggestion.newString}`, cls: "nova-diff-add" });

    const actions = card.createDiv({ cls: "nova-suggestion-actions" });

    const applyBtn = actions.createEl("button", { text: "Apply", cls: "nova-btn nova-btn-apply" });
    applyBtn.onclick = () => this.plugin.applySuggestion(suggestion);

    const rejectBtn = actions.createEl("button", { text: "Reject", cls: "nova-btn nova-btn-reject" });
    rejectBtn.onclick = () => this.plugin.rejectSuggestion(suggestion);
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

class NovaSettingTab extends PluginSettingTab {
  plugin: NovaPlugin;

  constructor(app: App, plugin: NovaPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Nova Cowork Settings" });

    new Setting(containerEl)
      .setName("WebSocket Port")
      .setDesc("Port for connecting to Nova daemon (default: 3737)")
      .addText((text) =>
        text
          .setPlaceholder("3737")
          .setValue(String(this.plugin.settings.wsPort))
          .onChange(async (value) => {
            this.plugin.settings.wsPort = parseInt(value) || DEFAULT_WS_PORT;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-connect")
      .setDesc("Automatically connect to Nova daemon when Obsidian starts")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoConnect)
          .onChange(async (value) => {
            this.plugin.settings.autoConnect = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
