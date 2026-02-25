import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startPairing, fetchPairingStatus, confirmPairing, cancelPairing } from "@/api";
import type { PairingUser } from "@/types";

interface TelegramPairingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaired: () => void;
  existingToken?: string;
}

type PairingStep = "token_input" | "waiting" | "confirm";

export function TelegramPairingDialog({ open, onOpenChange, onPaired, existingToken }: TelegramPairingDialogProps) {
  const [step, setStep] = useState<PairingStep>("token_input");
  const [token, setToken] = useState(existingToken ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [user, setUser] = useState<PairingUser | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef<PairingStep>("token_input");

  // Keep stepRef in sync
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep("token_input");
      setToken(existingToken ?? "");
      setError(null);
      setUser(null);
    }
  }, [open, existingToken]);

  // Cleanup on close — cancel pairing if in waiting state
  useEffect(() => {
    if (!open) {
      stopPolling();
      if (stepRef.current === "waiting") {
        cancelPairing().catch(() => {});
      }
    }
  }, [open, stopPolling]);

  // Cleanup on unmount
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
      onOpenChange(false);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm pairing");
      setStep("token_input");
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    stopPolling();
    try {
      await cancelPairing();
    } catch {
      // Ignore cancel errors
    }
    setUser(null);
    setStep("token_input");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Telegram</DialogTitle>
          <DialogDescription>Pair a Telegram bot to chat with your agents.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === "token_input" && (
            <>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>1. Message <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">@BotFather</a> &rarr; <code className="rounded bg-muted px-1 py-0.5 text-xs">/newbot</code> &rarr; copy the token</p>
                <p>2. Paste your bot token below</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dialog-bot-token">Bot Token</Label>
                <div className="flex gap-2">
                  <Input
                    id="dialog-bot-token"
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
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
