import { useState } from "react";
import { X, Plus, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { useImmediateSave } from "@/hooks/use-auto-save";
import type { Responsibility } from "@/types";

interface AgentResponsibilitiesProps {
  agentId: string;
  responsibilities: Responsibility[];
  onResponsibilitiesChange: (responsibilities: Responsibility[]) => void;
}

export function AgentResponsibilities({
  agentId,
  responsibilities,
  onResponsibilitiesChange,
}: AgentResponsibilitiesProps) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const { save } = useImmediateSave(agentId);

  function handleRemove(index: number) {
    const updated = responsibilities.filter((_, i) => i !== index);
    onResponsibilitiesChange(updated);
    save({ responsibilities: updated });
  }

  function handleAdd() {
    const trimmedTitle = newTitle.trim();
    const trimmedContent = newContent.trim();
    if (!trimmedTitle || !trimmedContent) {
      setAdding(false);
      setNewTitle("");
      setNewContent("");
      return;
    }
    const updated = [...responsibilities, { title: trimmedTitle, content: trimmedContent }];
    onResponsibilitiesChange(updated);
    save({ responsibilities: updated });
    setNewTitle("");
    setNewContent("");
    setAdding(false);
  }

  function startEditing(index: number) {
    setEditingIndex(index);
    setEditTitle(responsibilities[index].title);
    setEditContent(responsibilities[index].content);
  }

  function cancelEditing() {
    setEditingIndex(null);
    setEditTitle("");
    setEditContent("");
  }

  function handleSaveEdit() {
    if (editingIndex === null) return;
    const trimmedTitle = editTitle.trim();
    const trimmedContent = editContent.trim();
    if (!trimmedTitle || !trimmedContent) {
      cancelEditing();
      return;
    }
    const updated = responsibilities.map((r, i) =>
      i === editingIndex ? { title: trimmedTitle, content: trimmedContent } : r
    );
    onResponsibilitiesChange(updated);
    save({ responsibilities: updated });
    cancelEditing();
  }

  return (
    <div className="space-y-3">
      {responsibilities.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No responsibilities defined</p>
      )}
      {responsibilities.map((resp, i) => (
        <div
          key={i}
          className="rounded-md border border-border"
        >
          {editingIndex === i ? (
            <div className="space-y-2 p-3">
              <Input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Responsibility title"
                className="text-sm font-medium"
              />
              <AutoResizeTextarea
                value={editContent}
                onChange={setEditContent}
                placeholder="Describe what this responsibility entails..."
                className="text-sm"
                minRows={3}
              />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveEdit}
                >
                  <Check className="size-3.5" />
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEditing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between p-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-medium">{resp.title}</div>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">{resp.content}</div>
              </div>
              <div className="flex shrink-0 gap-1 ml-2">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => startEditing(i)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleRemove(i)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      {adding ? (
        <div className="rounded-md border border-border p-3 space-y-2">
          <Input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Responsibility title"
            className="text-sm font-medium"
          />
          <AutoResizeTextarea
            value={newContent}
            onChange={setNewContent}
            placeholder="Describe what this responsibility entails..."
            className="text-sm"
            minRows={3}
          />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAdd}
            >
              <Check className="size-3.5" />
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setNewTitle("");
                setNewContent("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3.5" />
          Add responsibility
        </Button>
      )}
    </div>
  );
}
