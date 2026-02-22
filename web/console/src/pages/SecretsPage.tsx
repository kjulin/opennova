import { useEffect, useState } from "react";
import { fetchSecrets } from "@/api";
import { SecretList } from "@/components/SecretList";
import { SecretAddForm } from "@/components/SecretAddForm";
import { Button } from "@/components/ui/button";

export function SecretsPage() {
  const [secrets, setSecrets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function loadSecrets() {
    return fetchSecrets()
      .then((data) => setSecrets(data.secrets))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    fetchSecrets()
      .then((data) => setSecrets(data.secrets))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Secrets</h1>
          {!loading && !error && (
            <p className="text-sm text-muted-foreground">
              {secrets.length} secret{secrets.length !== 1 && "s"}
            </p>
          )}
        </div>
        <Button onClick={() => setShowAdd(true)}>+ Add</Button>
      </div>

      {loading && (
        <div className="flex justify-center py-16 text-muted-foreground">
          Loading...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {showAdd && (
            <SecretAddForm
              onCreated={() => {
                setShowAdd(false);
                loadSecrets();
              }}
              onCancel={() => setShowAdd(false)}
            />
          )}

          {secrets.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              No secrets configured.
            </div>
          ) : (
            <SecretList
              secrets={secrets}
              onDeleted={loadSecrets}
              onUpdated={loadSecrets}
            />
          )}
        </>
      )}
    </div>
  );
}
