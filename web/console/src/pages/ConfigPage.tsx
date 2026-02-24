import { useEffect, useState, useRef, useCallback } from "react";
import {
  fetchConfig,
  updateDaemon,
  pairTelegram,
  fetchPairStatus,
  updateTtsKey,
  setupTailscale,
  deleteWorkspace,
} from "@/api";
import type { ConfigResponse, PairingStatus } from "@/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const pairPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPairPolling = useCallback(() => {
    if (pairPollRef.current) {
      clearInterval(pairPollRef.current);
      pairPollRef.current = null;
    }
  }, []);

  const startPairPolling = useCallback(() => {
    stopPairPolling();
    setPairing({ status: "waiting" });
    pairPollRef.current = setInterval(async () => {
      try {
        const status = await fetchPairStatus();
        setPairing(status);
        if (status.status === "paired" || status.status === "error") {
          stopPairPolling();
          if (status.status === "paired") {
            loadConfig();
          }
        }
      } catch {
        // Ignore transient fetch errors during polling
      }
    }, 2000);
  }, [stopPairPolling]);

  useEffect(() => {
    return () => stopPairPolling();
  }, [stopPairPolling]);

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

      {/* Claude Code */}
      <Card>
        <CardHeader>
          <CardTitle>Claude Code</CardTitle>
          <CardDescription>Detected Claude Code login mode.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="font-mono text-sm bg-muted px-3 py-1.5 rounded-md">
            {config.auth.method === "claude-code"
              ? "Subscription"
              : config.auth.method === "api-key"
                ? "API Key"
                : "Not detected"}
          </code>
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
              </div>
              {pairing?.status === "waiting" ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Waiting for message in Telegram... Send any message to your bot.
                </div>
              ) : pairing?.status === "paired" ? (
                <div className="text-sm text-green-600">
                  Paired with {pairing.chatName ?? pairing.chatId}
                </div>
              ) : pairing?.status === "error" ? (
                <div className="space-y-2">
                  <div className="text-sm text-destructive">{pairing.error}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      setActionError(null);
                      try {
                        await pairTelegram();
                        startPairPolling();
                      } catch (err) {
                        setActionError(err instanceof Error ? err.message : "Action failed");
                      }
                    }}
                  >
                    Re-pair
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setActionError(null);
                    try {
                      await pairTelegram();
                      startPairPolling();
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Action failed");
                    }
                  }}
                >
                  Re-pair
                </Button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not configured.</p>
          )}
        </CardContent>
      </Card>

      {/* Admin UI */}
      <Card>
        <CardHeader>
          <CardTitle>Admin UI</CardTitle>
          <CardDescription>Access URL for the admin interface.</CardDescription>
        </CardHeader>
        <CardContent>
          <code className="font-mono text-sm bg-muted px-3 py-1.5 rounded-md">
            {config.tailscale.certsReady && config.tailscale.url
              ? config.tailscale.url
              : "http://localhost:3838"}
          </code>
        </CardContent>
      </Card>

      {/* Tailscale */}
      <Card>
        <CardHeader>
          <CardTitle>Tailscale</CardTitle>
          <CardDescription>Remote access via Tailscale HTTPS.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant={config.tailscale.installed ? "default" : "secondary"}>
              {config.tailscale.installed ? (config.tailscale.connected ? "Connected" : "Disconnected") : "Not installed"}
            </Badge>
            {config.tailscale.certsReady && (
              <Badge variant="outline">Certs ready</Badge>
            )}
          </div>
          {config.tailscale.hostname && (
            <div className="text-sm text-muted-foreground">
              Hostname: <code className="font-mono">{config.tailscale.hostname}</code>
            </div>
          )}
          <div className="flex gap-2">
            {!config.tailscale.installed && (
              <Button variant="outline" size="sm" asChild>
                <a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">
                  Install Tailscale
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

      {/* Audio */}
      <Card>
        <CardHeader>
          <CardTitle>Audio</CardTitle>
          <CardDescription>Transcription and text-to-speech settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Label className="text-sm w-32">Transcription</Label>
            <Badge variant={config.audio.transcription.modelAvailable ? "default" : "secondary"}>
              {config.audio.transcription.modelAvailable ? "Model ready" : "Model not installed"}
            </Badge>
            {!config.audio.transcription.modelAvailable && (
              <span className="text-xs text-muted-foreground">
                Run <code className="font-mono bg-muted px-1 rounded">nova transcription setup</code> to download
              </span>
            )}
          </div>
          <Separator />
          <div className="flex items-center gap-3">
            <Label className="text-sm w-32">Text-to-Speech</Label>
            <Badge variant={config.audio.tts.openaiKeyConfigured ? "default" : "secondary"}>
              {config.audio.tts.openaiKeyConfigured ? "OpenAI API key set" : "OpenAI key not set"}
            </Badge>
            {!config.audio.tts.openaiKeyConfigured && !showOpenaiKeyInput && (
              <Button variant="outline" size="sm" onClick={() => setShowOpenaiKeyInput(true)}>
                Set API Key
              </Button>
            )}
          </div>
          {showOpenaiKeyInput && (
            <div className="flex items-end gap-2 pt-2">
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
                  handleAction(() => updateTtsKey(openaiKeyInput));
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
