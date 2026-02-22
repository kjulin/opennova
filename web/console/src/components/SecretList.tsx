import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { updateSecret, deleteSecret } from "@/api";

interface SecretListProps {
  secrets: string[];
  onDeleted: () => void;
  onUpdated: () => void;
}

function SecretRow({
  name,
  onDeleted,
  onUpdated,
}: {
  name: string;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!newValue) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveStatus("idle");
    try {
      await updateSecret(name, newValue);
      setSaveStatus("saved");
      setEditing(false);
      setNewValue("");
      onUpdated();
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditing(false);
      setNewValue("");
      setSaveStatus("idle");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteSecret(name);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-2 px-4">
        <code className="font-mono font-semibold text-sm shrink-0">{name}</code>

        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              placeholder="New value"
              autoFocus
              disabled={saving}
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              ••••••••••••••••
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {saving && (
            <span className="text-xs text-muted-foreground">Saving...</span>
          )}
          {!saving && saveStatus === "saved" && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {!saving && saveStatus === "error" && (
            <span className="text-xs text-destructive">Error</span>
          )}

          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(true);
                setSaveStatus("idle");
              }}
            >
              Edit
            </Button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={deleting}>
                {deleting ? "..." : "✕"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete secret?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete <strong>{name}</strong>? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

export function SecretList({ secrets, onDeleted, onUpdated }: SecretListProps) {
  return (
    <div className="space-y-2">
      {secrets.map((name) => (
        <SecretRow
          key={name}
          name={name}
          onDeleted={onDeleted}
          onUpdated={onUpdated}
        />
      ))}
    </div>
  );
}
