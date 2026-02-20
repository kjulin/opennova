import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useImmediateSave } from "@/hooks/use-auto-save";

interface AgentDirectoriesProps {
  agentId: string;
  directories: string[];
  onDirectoriesChange: (directories: string[]) => void;
}

export function AgentDirectories({
  agentId,
  directories,
  onDirectoriesChange,
}: AgentDirectoriesProps) {
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState("");
  const { save } = useImmediateSave(agentId);

  function handleRemove(index: number) {
    const updated = directories.filter((_, i) => i !== index);
    onDirectoriesChange(updated);
    save({ directories: updated });
  }

  function handleAdd() {
    const trimmed = newPath.trim();
    if (!trimmed) {
      setAdding(false);
      return;
    }
    const updated = [...directories, trimmed];
    onDirectoriesChange(updated);
    save({ directories: updated });
    setNewPath("");
    setAdding(false);
  }

  return (
    <div className="space-y-2">
      {directories.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No directories configured</p>
      )}
      {directories.map((dir, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2"
        >
          <span className="font-mono text-sm">{dir}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => handleRemove(i)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      {adding ? (
        <Input
          autoFocus
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") {
              setAdding(false);
              setNewPath("");
            }
          }}
          onBlur={handleAdd}
          placeholder="/path/to/directory"
          className="font-mono text-sm"
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3.5" />
          Add directory
        </Button>
      )}
    </div>
  );
}
