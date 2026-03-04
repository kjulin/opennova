import { Label } from "@/components/ui/label";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { useAutoSave } from "@/hooks/use-auto-save";

interface AgentMemoryProps {
  agentId: string;
  memory: string;
  onMemoryChange: (value: string) => void;
}

export function AgentMemory({
  agentId,
  memory,
  onMemoryChange,
}: AgentMemoryProps) {
  useAutoSave(agentId, "memory", memory);

  return (
    <div className="space-y-2">
      <Label htmlFor="agent-memory">Memory</Label>
      <p className="text-xs text-muted-foreground">
        Agent's personal knowledge index — persisted across conversations
      </p>
      <AutoResizeTextarea
        id="agent-memory"
        value={memory}
        onChange={onMemoryChange}
        minRows={8}
      />
    </div>
  );
}
