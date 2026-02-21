import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { assignSkill, unassignSkill } from "@/api";
import type { Agent } from "@/types";

interface SkillAssignmentsProps {
  skillName: string;
  assignedAgents: string[];
  allAgents: Agent[];
  onAssignmentChange: (assignedTo: string[]) => void;
}

export function SkillAssignments({
  skillName,
  assignedAgents,
  allAgents,
  onAssignmentChange,
}: SkillAssignmentsProps) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(agentId: string, checked: boolean) {
    setSaving(agentId);
    setError(null);
    try {
      const result = checked
        ? await assignSkill(skillName, [agentId])
        : await unassignSkill(skillName, [agentId]);
      onAssignmentChange(result.assignedTo);
    } catch {
      setError(`Failed to update ${agentId}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3">
      {allAgents.map((agent) => {
        const isAssigned = assignedAgents.includes(agent.id);
        const isSaving = saving === agent.id;
        return (
          <div key={agent.id} className="flex items-center gap-2">
            <Checkbox
              id={`assign-${agent.id}`}
              checked={isAssigned}
              disabled={isSaving}
              onCheckedChange={(checked) =>
                handleToggle(agent.id, checked === true)
              }
            />
            <Label
              htmlFor={`assign-${agent.id}`}
              className="text-sm font-normal cursor-pointer"
            >
              {agent.id}
            </Label>
            {isSaving && (
              <span className="text-xs text-muted-foreground">Saving...</span>
            )}
          </div>
        );
      })}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
