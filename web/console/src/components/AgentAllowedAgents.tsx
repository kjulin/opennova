import { useEffect, useState } from "react";
import { fetchAgents } from "@/api";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useImmediateSave } from "@/hooks/use-auto-save";

interface AgentAllowedAgentsProps {
  agentId: string;
  allowedAgents: string[];
  onAllowedAgentsChange: (allowedAgents: string[]) => void;
}

export function AgentAllowedAgents({
  agentId,
  allowedAgents,
  onAllowedAgentsChange,
}: AgentAllowedAgentsProps) {
  const [allAgents, setAllAgents] = useState<{ id: string; name: string }[]>(
    [],
  );
  const { save } = useImmediateSave(agentId);

  const isWildcard = allowedAgents.includes("*");

  useEffect(() => {
    fetchAgents()
      .then((data) =>
        setAllAgents(
          data.agents
            .filter((a) => a.id !== agentId)
            .map((a) => ({ id: a.id, name: a.name })),
        ),
      )
      .catch(() => {});
  }, [agentId]);

  function switchToSpecific() {
    const updated: string[] = [];
    onAllowedAgentsChange(updated);
    save({ allowedAgents: updated });
  }

  function switchToWildcard() {
    const updated = ["*"];
    onAllowedAgentsChange(updated);
    save({ allowedAgents: updated });
  }

  function handleToggle(targetId: string, checked: boolean) {
    const updated = checked
      ? [...allowedAgents, targetId]
      : allowedAgents.filter((a) => a !== targetId);
    onAllowedAgentsChange(updated);
    save({ allowedAgents: updated });
  }

  return (
    <div className="space-y-3">
      {isWildcard ? (
        <div className="flex items-center gap-3">
          <p className="text-sm">
            All agents{" "}
            <span className="text-muted-foreground">(wildcard)</span>
          </p>
          <Button variant="ghost" size="sm" onClick={switchToSpecific}>
            Select specific agents
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={switchToWildcard}>
              Allow all agents
            </Button>
          </div>
          {allAgents.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No other agents found
            </p>
          )}
          {allAgents.map((agent) => (
            <div key={agent.id} className="flex items-center gap-3">
              <Checkbox
                id={`allowed-${agent.id}`}
                checked={allowedAgents.includes(agent.id)}
                onCheckedChange={(checked) =>
                  handleToggle(agent.id, checked === true)
                }
              />
              <Label htmlFor={`allowed-${agent.id}`} className="cursor-pointer">
                {agent.name}
              </Label>
              <span className="text-xs font-mono text-muted-foreground">
                {agent.id}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
