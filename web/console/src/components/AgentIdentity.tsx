import { Label } from "@/components/ui/label";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { useAutoSave } from "@/hooks/use-auto-save";

interface AgentIdentityProps {
  agentId: string;
  identity: string;
  instructions: string;
  onIdentityChange: (value: string) => void;
  onInstructionsChange: (value: string) => void;
}

export function AgentIdentity({
  agentId,
  identity,
  instructions,
  onIdentityChange,
  onInstructionsChange,
}: AgentIdentityProps) {
  useAutoSave(agentId, "identity", identity);
  useAutoSave(agentId, "instructions", instructions);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="agent-identity">Identity</Label>
        <p className="text-xs text-muted-foreground">
          Who this agent is — role, expertise, personality
        </p>
        <AutoResizeTextarea
          id="agent-identity"
          value={identity}
          onChange={onIdentityChange}
          minRows={8}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="agent-instructions">Instructions</Label>
        <p className="text-xs text-muted-foreground">
          How this agent operates — files, rhythm, focus, constraints
        </p>
        <AutoResizeTextarea
          id="agent-instructions"
          value={instructions}
          onChange={onInstructionsChange}
          minRows={12}
        />
      </div>
    </div>
  );
}
