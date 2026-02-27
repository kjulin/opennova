import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exchangePairingCode, setCloudSession } from "@/lib/transport";

type PairState = "pairing" | "success" | "error";

export function PairPage() {
  const [state, setState] = useState<PairState>("pairing");
  const [error, setError] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash.slice(1); // remove #
    const params = new URLSearchParams(hash);
    const workspaceId = params.get("workspace");
    const code = params.get("code");

    if (!workspaceId || !code) {
      setState("error");
      setError("Invalid pairing link — missing workspace or code.");
      return;
    }

    exchangePairingCode(workspaceId, code)
      .then((bearer) => {
        setCloudSession({ workspaceId, bearer });
        setState("success");
        setTimeout(() => {
          navigate("/");
        }, 1000);
      })
      .catch((err) => {
        setState("error");
        setError(err.message);
      });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        {state === "pairing" && (
          <>
            <div className="mb-4 text-2xl">Connecting...</div>
            <p className="text-muted-foreground">Pairing with your Nova daemon.</p>
          </>
        )}
        {state === "success" && (
          <>
            <div className="mb-4 text-2xl">Paired!</div>
            <p className="text-muted-foreground">Redirecting to console...</p>
          </>
        )}
        {state === "error" && (
          <>
            <div className="mb-4 text-2xl">Pairing failed</div>
            <p className="text-destructive">{error}</p>
            <p className="mt-4 text-sm text-muted-foreground">
              Try sending /admin in Telegram to get a new link.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
