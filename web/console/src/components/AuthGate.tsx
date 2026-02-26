import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isAuthenticated, setToken, clearToken } from "@/lib/auth";
import { exchangeSetupToken, validateToken } from "@/api";

type Status = "loading" | "authenticated" | "unauthenticated";

function parseSetupToken(): string | null {
  const hash = window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash.slice(1));
  return params.get("setup");
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const handleExpired = useCallback(() => {
    clearToken();
    setStatus("unauthenticated");
    setError(null);
  }, []);

  useEffect(() => {
    window.addEventListener("nova:auth-expired", handleExpired);
    return () => window.removeEventListener("nova:auth-expired", handleExpired);
  }, [handleExpired]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const setupToken = parseSetupToken();

      if (setupToken) {
        try {
          const apiToken = await exchangeSetupToken(setupToken);
          if (cancelled) return;
          setToken(apiToken);
          window.location.hash = "";
          setStatus("authenticated");
        } catch {
          if (cancelled) return;
          setError("Setup link is invalid or expired. Please request a new one via /admin.");
          setStatus("unauthenticated");
        }
        return;
      }

      if (isAuthenticated()) {
        setStatus("authenticated");
      } else {
        setStatus("unauthenticated");
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Connecting...</p>
      </div>
    );
  }

  if (status === "authenticated") {
    return <>{children}</>;
  }

  return <TokenInput error={error} onAuthenticated={() => setStatus("authenticated")} />;
}

function TokenInput({ error: externalError, onAuthenticated }: { error: string | null; onAuthenticated: () => void }) {
  const [token, setTokenValue] = useState("");
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(externalError);

  useEffect(() => {
    setError(externalError);
  }, [externalError]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setValidating(true);
    setError(null);

    const valid = await validateToken(trimmed);

    if (valid) {
      setToken(trimmed);
      onAuthenticated();
    } else {
      setError("Invalid token");
    }

    setValidating(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Nova Console</CardTitle>
          <CardDescription>Enter your API token to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="token">API Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="nva_..."
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                autoFocus
                disabled={validating}
              />
            </div>
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <Button type="submit" disabled={validating || !token.trim()}>
              {validating ? "Validating..." : "Connect"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
