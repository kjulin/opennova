import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Send } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startPairing, fetchPairingStatus, confirmPairing, cancelPairing } from "@/api";
import type { PairingUser } from "@/types";

interface TelegramPairingBlockProps {
  onPaired: () => void;
}

type PairingStep = "token_input" | "waiting" | "confirm";

export function TelegramPairingBlock({ onPaired }: TelegramPairingBlockProps) {
  const [step, setStep] = useState<PairingStep>("token_input");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [user, setUser] = useState<PairingUser | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchPairingStatus();
        if (status.status === "message_received" && status.user) {
          stopPolling();
          setUser(status.user);
          setStep("confirm");
        } else if (status.status === "error") {
          stopPolling();
          setError(status.error || "Pairing failed");
          setStep("token_input");
        }
      } catch {
        // Ignore transient fetch errors
      }
    }, 2000);
  }

  async function handleStart() {
    if (!token.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await startPairing(token.trim());
      setStep("waiting");
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start pairing");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      await confirmPairing();
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm pairing");
      setStep("token_input");
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    try {
      await cancelPairing();
    } catch {
      // Ignore cancel errors
    }
    setUser(null);
    setStep("token_input");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-5" />
          Connect Telegram
        </CardTitle>
        <CardDescription>Pair a Telegram bot to chat with your agents.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "token_input" && (
          <>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>1. Message <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">@BotFather</a> &rarr; <code className="rounded bg-muted px-1 py-0.5 text-xs">/newbot</code> &rarr; copy the token</p>
              <p>2. Paste your bot token below</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bot-token">Bot Token</Label>
              <div className="flex gap-2">
                <Input
                  id="bot-token"
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                />
                <Button onClick={handleStart} disabled={submitting || !token.trim()}>
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : "Start"}
                </Button>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </>
        )}

        {step === "waiting" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Open Telegram and send any message to your bot.
          </div>
        )}

        {step === "confirm" && user && (
          <div className="space-y-4">
            <p className="text-sm">
              Message received from <span className="font-medium">{user.firstName}{user.lastName ? ` ${user.lastName}` : ""}</span>
              {user.username && <span className="text-muted-foreground"> (username: {user.username})</span>}
            </p>
            <div className="flex gap-2">
              <Button onClick={handleConfirm} disabled={confirming}>
                {confirming ? <Loader2 className="size-4 animate-spin" /> : "Confirm pairing"}
              </Button>
              <Button variant="outline" onClick={handleCancel} disabled={confirming}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
