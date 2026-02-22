import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useImmediateSave } from "@/hooks/use-auto-save";

const AVAILABLE_CAPABILITIES = [
  { id: "memory", label: "Memory", description: "Long-term memory across conversations" },
  { id: "history", label: "History", description: "Episodic conversation history" },
  { id: "tasks", label: "Tasks", description: "Task management" },
  { id: "notes", label: "Notes", description: "Shared notes and pinned content" },
  { id: "self", label: "Self", description: "Self-manage own instructions" },
  { id: "media", label: "Media", description: "Send files and media" },
  { id: "secrets", label: "Secrets", description: "Access workspace secrets" },
  { id: "agents", label: "Agents", description: "Delegate tasks to other agents" },
  { id: "agent-management", label: "Agent Management", description: "Create and manage agents" },
  { id: "triggers", label: "Triggers", description: "Manage scheduled triggers" },
  { id: "browser", label: "Browser", description: "Playwright browser automation" },
];

interface AgentCapabilitiesProps {
  agentId: string;
  capabilities: string[];
  onCapabilitiesChange: (capabilities: string[]) => void;
}

export function AgentCapabilities({
  agentId,
  capabilities,
  onCapabilitiesChange,
}: AgentCapabilitiesProps) {
  const { save } = useImmediateSave(agentId);

  function handleToggle(capId: string, checked: boolean) {
    const updated = checked
      ? [...capabilities, capId]
      : capabilities.filter((c) => c !== capId);
    onCapabilitiesChange(updated);
    save({ capabilities: updated });
  }

  return (
    <div className="space-y-3">
      {AVAILABLE_CAPABILITIES.map((cap) => (
        <div key={cap.id} className="flex items-center gap-3">
          <Checkbox
            id={`cap-${cap.id}`}
            checked={capabilities.includes(cap.id)}
            onCheckedChange={(checked) => handleToggle(cap.id, checked === true)}
          />
          <Label htmlFor={`cap-${cap.id}`} className="cursor-pointer">
            {cap.label}
          </Label>
          <span className="text-xs text-muted-foreground">{cap.description}</span>
        </div>
      ))}
    </div>
  );
}
