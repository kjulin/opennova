import { useEffect, useState } from "react";
import { fetchAgents } from "@/api";
import { AgentList } from "@/components/AgentList";
import { Button } from "@/components/ui/button";
import type { Agent } from "@/types";

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents()
      .then((data) => setAgents(data.agents))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          {!loading && !error && (
            <p className="text-sm text-muted-foreground">
              {agents.length} agent{agents.length !== 1 && "s"}
            </p>
          )}
        </div>
        <Button disabled>+ Create agent</Button>
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

      {!loading && !error && agents.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          No agents configured.
        </div>
      )}

      {!loading && !error && agents.length > 0 && (
        <AgentList agents={agents} />
      )}
    </div>
  );
}
