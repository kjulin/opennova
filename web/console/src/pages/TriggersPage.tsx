import { useEffect, useState } from "react";
import { fetchTriggers, fetchAgents } from "@/api";
import { TriggerList } from "@/components/TriggerList";
import { TriggerDrawer } from "@/components/TriggerDrawer";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Trigger, Agent } from "@/types";

export function TriggersPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTrigger, setSelectedTrigger] = useState<Trigger | null>(null);

  const [filterAgentId, setFilterAgentId] = useState<string>("all");

  function loadTriggers() {
    return fetchTriggers()
      .then((data) => setTriggers(data.triggers))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    Promise.all([
      fetchTriggers().then((data) => setTriggers(data.triggers)),
      fetchAgents().then((data) => setAgents(data.agents)),
    ])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function handleSelectTrigger(trigger: Trigger) {
    setSelectedTrigger(trigger);
    setDrawerOpen(true);
  }

  function handleCreateClick() {
    setSelectedTrigger(null);
    setDrawerOpen(true);
  }

  // Get unique agent IDs that have triggers for the filter dropdown
  const agentIdsWithTriggers = [...new Set(triggers.map((t) => t.agentId).filter(Boolean))];
  const agentsWithTriggers = agents.filter((a) => agentIdsWithTriggers.includes(a.id));

  const filteredTriggers = filterAgentId === "all"
    ? triggers
    : triggers.filter((t) => t.agentId === filterAgentId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Triggers</h1>
          {!loading && !error && (
            <p className="text-sm text-muted-foreground">
              {triggers.length} trigger{triggers.length !== 1 && "s"}
            </p>
          )}
        </div>
        <Button onClick={handleCreateClick}>+ Create</Button>
      </div>

      {!loading && !error && triggers.length > 0 && agentsWithTriggers.length > 0 && (
        <Select value={filterAgentId} onValueChange={setFilterAgentId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {agentsWithTriggers.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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

      {!loading && !error && triggers.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          No triggers configured.
        </div>
      )}

      {!loading && !error && filteredTriggers.length > 0 && (
        <TriggerList triggers={filteredTriggers} onSelect={handleSelectTrigger} />
      )}

      <TriggerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        trigger={selectedTrigger}
        allAgents={agents}
        onCreated={() => {
          loadTriggers();
        }}
        onDeleted={() => {
          loadTriggers();
        }}
        onUpdated={() => {
          loadTriggers();
        }}
      />
    </div>
  );
}
