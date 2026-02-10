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

type ServerMessage = CoworkMessage | CoworkSuggestion | CoworkStatus | { type: "connected" };

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
    };

    this.ws.onclose = () => {
      this.view?.setConnected(false);
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
    }
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

class NovaCoworkView extends ItemView {
  plugin: NovaPlugin;
  connected = false;
  status: "thinking" | "working" | "idle" = "idle";
  pendingFiles: string[] = [];
  messages: Array<{ text: string; importance: "high" | "low"; time: Date }> = [];
  currentSuggestion: CoworkSuggestion | null = null;

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
    const statusDot = header.createSpan({ cls: `nova-status-dot ${this.connected ? "connected" : "disconnected"}` });
    header.createSpan({ text: this.connected ? "Connected" : "Disconnected", cls: "nova-status-text" });

    if (!this.connected) {
      const connectBtn = header.createEl("button", { text: "Connect", cls: "nova-connect-btn" });
      connectBtn.onclick = () => this.plugin.connect();
    }

    // Status bar
    if (this.connected) {
      const statusBar = container.createDiv({ cls: "nova-status-bar" });
      const statusText = this.status === "thinking" ? "Thinking…"
        : this.status === "working" ? "Working…"
        : "Idle";
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

    if (this.messages.length === 0 && this.connected) {
      messagesContainer.createDiv({
        text: "Waiting for Nova messages…",
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
