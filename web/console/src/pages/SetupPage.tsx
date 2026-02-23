import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Minus, Circle, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  fetchSetupStatus,
  fetchAuthStatus,
  submitTelegramToken,
  fetchTelegramStatus,
  fetchTailscaleStatus,
  generateTailscaleCerts,
  submitOpenAIKey,
  completeSetup,
  type SetupStatus,
  type AuthStatus,
  type TelegramStatus,
  type TailscaleStatus,
} from "@/setup-api";

const STEP_LABELS = ["Workspace", "Auth", "Telegram", "Tailscale", "OpenAI", "Done"];

type StepStatus = "done" | "pending" | "skipped";

function stepIcon(status: StepStatus) {
  if (status === "done") return <Check className="size-4" />;
  if (status === "skipped") return <Minus className="size-4" />;
  return <Circle className="size-3" />;
}

function stepColor(status: StepStatus, isActive: boolean) {
  if (status === "done") return "bg-primary text-primary-foreground";
  if (status === "skipped") return "bg-muted text-muted-foreground";
  if (isActive) return "border-2 border-primary text-primary bg-background";
  return "bg-muted text-muted-foreground";
}

export function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial status
  useEffect(() => {
    fetchSetupStatus()
      .then((s) => {
        if (s.complete) {
          navigate("/web/console", { replace: true });
          return;
        }
        setStatus(s);
        // Find first incomplete step to resume
        const steps = s.steps;
        if (!steps.auth.done) setStep(1);
        else if (!steps.telegram.done && steps.telegram.status !== "paired") setStep(2);
        else if (!steps.tailscale.done && !steps.tailscale.skipped) setStep(3);
        else if (!steps.openai.done && !steps.openai.skipped) setStep(4);
        else setStep(5);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [navigate]);

  function getStepStatus(idx: number): StepStatus {
    if (!status) return "pending";
    const s = status.steps;
    switch (idx) {
      case 0: return s.workspace.done ? "done" : "pending";
      case 1: return s.auth.done ? "done" : "pending";
      case 2: return s.telegram.done ? "done" : "pending";
      case 3: return s.tailscale.done ? "done" : s.tailscale.skipped ? "skipped" : "pending";
      case 4: return s.openai.done ? "done" : s.openai.skipped ? "skipped" : "pending";
      case 5: return "pending";
      default: return "pending";
    }
  }

  function handleNext() {
    setStep((s) => Math.min(s + 1, 5));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  // Refresh status from server
  const refreshStatus = useCallback(async () => {
    try {
      const s = await fetchSetupStatus();
      setStatus(s);
      return s;
    } catch {
      // Silently fail on refresh
      return status;
    }
  }, [status]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Card className="w-full max-w-md">
          <CardContent>
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Nova</h1>
        <ThemeToggle />
      </header>

      {/* Main content */}
      <div className="flex flex-1 flex-col items-center px-4 py-8">
        <div className="w-full max-w-2xl space-y-8">
          {/* Step indicator */}
          <nav className="flex items-center justify-center gap-1">
            {STEP_LABELS.map((label, idx) => {
              const ss = getStepStatus(idx);
              const isActive = idx === step;
              return (
                <div key={label} className="flex items-center">
                  {idx > 0 && (
                    <div
                      className={`mx-1 h-px w-6 sm:w-10 ${
                        idx <= step ? "bg-primary" : "bg-border"
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setStep(idx)}
                    className="flex flex-col items-center gap-1"
                  >
                    <div
                      className={`flex size-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${stepColor(
                        ss,
                        isActive
                      )}`}
                    >
                      {ss === "done" ? stepIcon(ss) : ss === "skipped" ? stepIcon(ss) : idx}
                    </div>
                    <span
                      className={`text-xs ${
                        isActive
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {label}
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Step content */}
          {step === 0 && status && <WorkspaceStep status={status} onNext={handleNext} />}
          {step === 1 && (
            <AuthStep
              status={status}
              onNext={handleNext}
              onBack={handleBack}
              onRefreshStatus={refreshStatus}
            />
          )}
          {step === 2 && (
            <TelegramStep
              onNext={handleNext}
              onBack={handleBack}
              onRefreshStatus={refreshStatus}
            />
          )}
          {step === 3 && (
            <TailscaleStep
              onNext={handleNext}
              onBack={handleBack}
              onRefreshStatus={refreshStatus}
            />
          )}
          {step === 4 && (
            <OpenAIStep
              status={status}
              onNext={handleNext}
              onBack={handleBack}
              onRefreshStatus={refreshStatus}
            />
          )}
          {step === 5 && status && (
            <DoneStep status={status} onBack={handleBack} onRefreshStatus={refreshStatus} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0: Workspace
// ---------------------------------------------------------------------------

function WorkspaceStep({ status, onNext }: { status: SetupStatus; onNext: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>Your Nova workspace is ready.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted px-4 py-3 font-mono text-sm">
          {status.steps.workspace.path}
        </div>
        <p className="text-sm text-muted-foreground">
          This directory contains your agents, skills, and configuration files.
        </p>
        <div className="flex justify-end">
          <Button onClick={onNext}>Next</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Auth
// ---------------------------------------------------------------------------

function AuthStep({
  status,
  onNext,
  onBack,
  onRefreshStatus,
}: {
  status: SetupStatus | null;
  onNext: () => void;
  onBack: () => void;
  onRefreshStatus: () => Promise<SetupStatus | null>;
}) {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const checkAuth = useCallback(async () => {
    setChecking(true);
    try {
      const a = await fetchAuthStatus();
      setAuth(a);
      await onRefreshStatus();
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, [onRefreshStatus]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const isDone = auth?.method !== "none" && auth?.method != null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentication</CardTitle>
        <CardDescription>
          Nova needs a way to verify your identity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {checking ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Detecting authentication...
          </div>
        ) : isDone ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3" />
                {auth!.method === "claude-code" ? "Claude Code detected" : "API key configured"}
              </Badge>
            </div>
            {auth!.detail && (
              <p className="text-sm text-muted-foreground">{auth!.detail}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Nova needs Claude Code or an Anthropic API key to run agents. Install Claude Code or add your API key, then re-check.
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <a
                  href="https://docs.anthropic.com/en/docs/claude-code/overview"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Install Claude Code <ExternalLink className="size-3" />
                </a>
              </li>
              <li className="flex items-center gap-2">
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Get an Anthropic API key <ExternalLink className="size-3" />
                </a>
              </li>
            </ul>
            <Button variant="outline" size="sm" onClick={checkAuth} disabled={checking}>
              <RefreshCw className="size-4" />
              Re-check
            </Button>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext} disabled={!isDone && !status?.steps.auth.done}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Telegram
// ---------------------------------------------------------------------------

function TelegramStep({
  onNext,
  onBack,
  onRefreshStatus,
}: {
  onNext: () => void;
  onBack: () => void;
  onRefreshStatus: () => Promise<SetupStatus | null>;
}) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [tokenSaved, setTokenSaved] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check initial status
  useEffect(() => {
    fetchTelegramStatus().then((ts) => {
      setTelegramStatus(ts);
      if (ts.status === "waiting") {
        setTokenSaved(true);
      }
    }).catch(() => {});
  }, []);

  // Poll when waiting for pairing
  useEffect(() => {
    if (!tokenSaved || telegramStatus?.status === "paired") return;

    pollRef.current = setInterval(async () => {
      try {
        const ts = await fetchTelegramStatus();
        setTelegramStatus(ts);
        if (ts.status === "paired") {
          await onRefreshStatus();
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ignore poll errors
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [tokenSaved, telegramStatus?.status, onRefreshStatus]);

  async function handleSubmitToken() {
    if (!token.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitTelegramToken(token.trim());
      setTokenSaved(true);
      const ts = await fetchTelegramStatus();
      setTelegramStatus(ts);
      await onRefreshStatus();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const isPaired = telegramStatus?.status === "paired";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telegram</CardTitle>
        <CardDescription>
          Connect a Telegram bot to chat with your agents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPaired ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3" />
                Paired
              </Badge>
              {telegramStatus.chatName && (
                <span className="text-sm font-medium">{telegramStatus.chatName}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Your Telegram bot is connected and ready.
            </p>
          </div>
        ) : tokenSaved ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Waiting for you to message the bot in Telegram...
            </div>
            <p className="text-sm text-muted-foreground">
              Open Telegram, find your bot, and send it any message (e.g. <code className="rounded bg-muted px-1 py-0.5 text-xs">/start</code>)
              to complete pairing.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">1. Create a bot with BotFather</p>
              <p className="text-sm text-muted-foreground">
                Open Telegram and message{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  @BotFather
                </a>
                . Send <code className="rounded bg-muted px-1 py-0.5 text-xs">/newbot</code>, follow the prompts, and copy the token.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">2. Paste your bot token</p>
              <div className="flex gap-2">
                <Input
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmitToken()}
                />
                <Button onClick={handleSubmitToken} disabled={submitting || !token.trim()}>
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                </Button>
              </div>
              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext}>
            {isPaired ? "Next" : "Next"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Tailscale
// ---------------------------------------------------------------------------

function TailscaleStep({
  onNext,
  onBack,
  onRefreshStatus,
}: {
  onNext: () => void;
  onBack: () => void;
  onRefreshStatus: () => Promise<SetupStatus | null>;
}) {
  const [tsStatus, setTsStatus] = useState<TailscaleStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const ts = await fetchTailscaleStatus();
      setTsStatus(ts);
      await onRefreshStatus();
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, [onRefreshStatus]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  async function handleGenerateCerts() {
    setGenerating(true);
    setGenError(null);
    try {
      await generateTailscaleCerts();
      await checkStatus();
    } catch (err) {
      setGenError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function handleSkip() {
    onNext();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tailscale HTTPS</CardTitle>
        <CardDescription>
          Enable HTTPS access to Nova over your Tailscale network. This step is optional.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {checking ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking Tailscale...
          </div>
        ) : !tsStatus?.installed ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tailscale is not installed on this machine.
            </p>
            <a
              href="https://tailscale.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Install Tailscale <ExternalLink className="size-3" />
            </a>
            <div>
              <Button variant="outline" size="sm" onClick={checkStatus} disabled={checking}>
                <RefreshCw className="size-4" />
                Re-check
              </Button>
            </div>
          </div>
        ) : !tsStatus.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Installed</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Tailscale is installed but not connected. Run{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">tailscale up</code>{" "}
              to connect.
            </p>
            <Button variant="outline" size="sm" onClick={checkStatus} disabled={checking}>
              <RefreshCw className="size-4" />
              Re-check
            </Button>
          </div>
        ) : tsStatus.certsReady ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3" />
                Ready
              </Badge>
              <span className="text-sm font-medium">{tsStatus.hostname}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              HTTPS certificates are configured. Nova is accessible at{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                https://{tsStatus.hostname}
              </code>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Connected</Badge>
              <span className="text-sm font-medium">{tsStatus.hostname}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Generate HTTPS certificates for secure access over Tailscale.
            </p>
            <Button onClick={handleGenerateCerts} disabled={generating}>
              {generating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate Certs"
              )}
            </Button>
            {genError && (
              <p className="text-sm text-destructive">{genError}</p>
            )}
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <div className="flex gap-2">
            {!tsStatus?.certsReady && (
              <Button variant="ghost" onClick={handleSkip}>
                Skip
              </Button>
            )}
            <Button onClick={onNext}>
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 4: OpenAI
// ---------------------------------------------------------------------------

function OpenAIStep({
  status,
  onNext,
  onBack,
  onRefreshStatus,
}: {
  status: SetupStatus | null;
  onNext: () => void;
  onBack: () => void;
  onRefreshStatus: () => Promise<SetupStatus | null>;
}) {
  const [key, setKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(status?.steps.openai.done ?? false);

  async function handleSubmit() {
    if (!key.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitOpenAIKey(key.trim());
      setSaved(true);
      setKey("");
      await onRefreshStatus();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSkip() {
    onNext();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>OpenAI API Key</CardTitle>
        <CardDescription>
          Enable voice mode — speech-to-text and text-to-speech for your agents. This step is optional.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {saved ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Check className="size-3" />
              Saved
            </Badge>
            <span className="text-sm text-muted-foreground">
              Voice mode enabled
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Get an API key from{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                platform.openai.com
              </a>
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="sk-..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
              <Button onClick={handleSubmit} disabled={submitting || !key.trim()}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            {submitError && (
              <p className="text-sm text-destructive">{submitError}</p>
            )}
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <div className="flex gap-2">
            {!saved && (
              <Button variant="ghost" onClick={handleSkip}>
                Skip
              </Button>
            )}
            <Button onClick={onNext}>
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Done
// ---------------------------------------------------------------------------

function DoneStep({
  status,
  onBack,
  onRefreshStatus,
}: {
  status: SetupStatus;
  onBack: () => void;
  onRefreshStatus: () => Promise<SetupStatus | null>;
}) {
  const navigate = useNavigate();
  const [completing, setCompleting] = useState(false);

  async function handleFinish() {
    setCompleting(true);
    try {
      await completeSetup();
      await onRefreshStatus();
      navigate("/web/console", { replace: true });
    } catch {
      setCompleting(false);
    }
  }

  const steps = status.steps;
  const summaryItems: { label: string; status: StepStatus; detail?: string }[] = [
    { label: "Workspace", status: "done", detail: steps.workspace.path },
    {
      label: "Authentication",
      status: steps.auth.done ? "done" : "pending",
      detail: steps.auth.done ? steps.auth.method : "Not configured",
    },
    {
      label: "Telegram",
      status: steps.telegram.done ? "done" : "pending",
      detail: steps.telegram.done ? "Paired" : steps.telegram.status,
    },
    {
      label: "Tailscale",
      status: steps.tailscale.done ? "done" : steps.tailscale.skipped ? "skipped" : "pending",
      detail: steps.tailscale.done
        ? "Certs ready"
        : steps.tailscale.skipped
          ? "Skipped"
          : steps.tailscale.status,
    },
    {
      label: "Voice",
      status: steps.openai.done ? "done" : steps.openai.skipped ? "skipped" : "pending",
      detail: steps.openai.done ? "Configured" : steps.openai.skipped ? "Skipped" : "Not configured",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup Complete</CardTitle>
        <CardDescription>
          Here&apos;s a summary of your configuration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-md border px-4 py-2.5"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex size-6 items-center justify-center rounded-full ${
                    item.status === "done"
                      ? "bg-primary/10 text-primary"
                      : item.status === "skipped"
                        ? "bg-muted text-muted-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {stepIcon(item.status)}
                </div>
                <span className="text-sm font-medium">{item.label}</span>
              </div>
              <span className="text-sm text-muted-foreground">{item.detail}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <div className="flex gap-2">
            {steps.telegram.done && (
              <Button variant="outline" asChild>
                <a href="https://t.me" target="_blank" rel="noopener noreferrer">
                  Say hello in Telegram
                </a>
              </Button>
            )}
            <Button onClick={handleFinish} disabled={completing}>
              {completing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Finishing...
                </>
              ) : (
                "Open Console"
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
