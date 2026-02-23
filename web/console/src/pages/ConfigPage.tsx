import { useEffect, useState } from "react";
import {
  fetchConfig,
  updateDaemon,
  pairTelegram,
  updateVoice,
  updateEmbeddings,
  updateSecurity,
  setupTailscale,
  deleteWorkspace,
} from "@/api";
import type { ConfigResponse } from "@/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function ConfigPage() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [showOpenaiKeyInput, setShowOpenaiKeyInput] = useState(false);
  const [confirmPath, setConfirmPath] = useState("");
  const [workspaceRemoved, setWorkspaceRemoved] = useState(false);

  function loadConfig() {
    return fetchConfig()
      .then((data) => {
        setConfig(data);
        setActionError(null);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    fetchConfig()
      .then((data) => setConfig(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      await loadConfig();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Config</h1>
        <div className="flex justify-center py-16 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Config</h1>
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error || "Failed to load config"}
        </div>
      </div>
    );
  }

  if (workspaceRemoved) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Config</h1>
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <p className="text-lg font-medium">Workspace removed.</p>
            <p className="text-sm text-muted-foreground">
              To reinstall, run:
            </p>
            <code className="block font-mono text-sm bg-muted px-4 py-2 rounded-md">
              curl -fsSL https://opennova.dev/install | bash
            </code>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Config</h1>

      {actionError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Workspace */}
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>The workspace directory for this OpenNova installation.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="font-mono text-sm bg-muted px-3 py-1.5 rounded-md">{config.workspace.path}</code>
        </CardContent>
      </Card>

      {/* Console / API */}
      <Card>
        <CardHeader>
          <CardTitle>Console / API</CardTitle>
          <CardDescription>Access URL for the console and API endpoints.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">URL</Label>
            <code className="block font-mono text-sm mt-1">
              {config.tailscale.certsReady && config.tailscale.url
                ? config.tailscale.url
                : "http://localhost:3838"}
            </code>
          </div>
          <Separator />
          <div className="flex items-center gap-3">
            <Badge variant={config.tailscale.installed ? "default" : "secondary"}>
              Tailscale {config.tailscale.installed ? (config.tailscale.connected ? "Connected" : "Disconnected") : "Not installed"}
            </Badge>
            {config.tailscale.certsReady && (
              <Badge variant="outline">Certs ready</Badge>
            )}
          </div>
          <div className="flex gap-2">
            {!config.tailscale.installed && (
              <Button variant="outline" size="sm" asChild>
                <a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">
                  Set up Tailscale
                </a>
              </Button>
            )}
            {config.tailscale.installed && config.tailscale.connected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction(() => setupTailscale())}
              >
                Regenerate Certs
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Authentication */}
      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>How API requests are authenticated.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge>
              {config.auth.method === "claude-code"
                ? "Claude Code"
                : config.auth.method === "api-key"
                  ? "API Key"
                  : "None"}
            </Badge>
            {config.auth.detail && (
              <span className="text-sm text-muted-foreground">{config.auth.detail}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="https://docs.anthropic.com" target="_blank" rel="noopener noreferrer">
                Anthropic Docs
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => loadConfig()}>
              Re-check
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Telegram */}
      <Card>
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>Telegram bot integration for remote agent control.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {config.telegram.configured ? (
            <>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Bot Token</span>
                <code className="font-mono">{config.telegram.token}</code>
                <span className="text-muted-foreground">Chat ID</span>
                <span className="font-mono">{config.telegram.chatId ?? "—"}</span>
                <span className="text-muted-foreground">Active Agent</span>
                <span className="font-mono">{config.telegram.activeAgentId ?? "—"}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction(() => pairTelegram())}
              >
                Re-pair
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not configured.</p>
          )}
        </CardContent>
      </Card>

      {/* Voice */}
      <Card>
        <CardHeader>
          <CardTitle>Voice</CardTitle>
          <CardDescription>Voice input/output settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{config.voice.mode}</Badge>
            <span className="text-sm text-muted-foreground">
              OpenAI key: {config.voice.openaiKeyConfigured ? "configured" : "not configured"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="voice-mode" className="text-sm">Mode</Label>
            <Select
              value={config.voice.mode}
              onValueChange={(value) => {
                if (value === "api" && !config.voice.openaiKeyConfigured) {
                  setShowOpenaiKeyInput(true);
                  // Don't submit yet, wait for key
                  return;
                }
                setShowOpenaiKeyInput(false);
                handleAction(() => updateVoice(value));
              }}
            >
              <SelectTrigger id="voice-mode" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api">API</SelectItem>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {showOpenaiKeyInput && (
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="openai-key" className="text-xs">OpenAI API Key</Label>
                <Input
                  id="openai-key"
                  type="password"
                  placeholder="sk-..."
                  value={openaiKeyInput}
                  onChange={(e) => setOpenaiKeyInput(e.target.value)}
                  className="w-64"
                />
              </div>
              <Button
                size="sm"
                disabled={!openaiKeyInput}
                onClick={() => {
                  handleAction(() => updateVoice("api", openaiKeyInput));
                  setOpenaiKeyInput("");
                  setShowOpenaiKeyInput(false);
                }}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowOpenaiKeyInput(false);
                  setOpenaiKeyInput("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Episodic Memory */}
      <Card>
        <CardHeader>
          <CardTitle>Episodic Memory</CardTitle>
          <CardDescription>Embedding model for agent memory and knowledge retrieval.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{config.embeddings.mode}</Badge>
            <span className="text-sm text-muted-foreground">
              Model: {config.embeddings.modelAvailable ? "available" : "not available"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="embeddings-mode" className="text-sm">Mode</Label>
            <Select
              value={config.embeddings.mode}
              onValueChange={(value) => handleAction(() => updateEmbeddings(value))}
            >
              <SelectTrigger id="embeddings-mode" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="api">API</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {config.embeddings.mode === "api" && !config.voice.openaiKeyConfigured && (
            <p className="text-xs text-muted-foreground">
              API mode requires an OpenAI API key. Configure it in the Voice section above.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>Default trust level for new agents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Label htmlFor="trust-level" className="text-sm">Default Trust</Label>
            <Select
              value={config.security.defaultTrust}
              onValueChange={(value) => handleAction(() => updateSecurity(value))}
            >
              <SelectTrigger id="trust-level" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox — isolated, no file access</SelectItem>
                <SelectItem value="controlled">Controlled — scoped file access</SelectItem>
                <SelectItem value="unrestricted">Unrestricted — full system access</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Daemon */}
      <Card>
        <CardHeader>
          <CardTitle>Daemon</CardTitle>
          <CardDescription>OpenNova daemon process status and settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">{config.daemon.version}</span>
            <span className="text-muted-foreground">Uptime</span>
            <span>{formatUptime(config.daemon.uptime)}</span>
          </div>
          <Separator />
          <div className="flex items-center gap-3">
            <Switch
              id="auto-start"
              checked={config.daemon.autoStart}
              onCheckedChange={(checked) => handleAction(() => updateDaemon(checked))}
            />
            <Label htmlFor="auto-start" className="text-sm">Auto-start on boot</Label>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions. Proceed with caution.</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Remove Workspace</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Workspace?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>
                      This will permanently delete the workspace at:
                    </p>
                    <code className="block font-mono text-sm bg-muted px-3 py-1.5 rounded-md">
                      {config.workspace.path}
                    </code>
                    <p>
                      Type the workspace path to confirm:
                    </p>
                    <Input
                      value={confirmPath}
                      onChange={(e) => setConfirmPath(e.target.value)}
                      placeholder={config.workspace.path}
                      className="font-mono text-sm"
                    />
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmPath("")}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={confirmPath !== config.workspace.path}
                  onClick={async () => {
                    try {
                      await deleteWorkspace(confirmPath);
                      setWorkspaceRemoved(true);
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Failed to remove workspace");
                    }
                    setConfirmPath("");
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
