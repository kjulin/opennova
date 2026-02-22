import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2 } from "lucide-react";
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
  const [editOpen, setEditOpen] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!newValue) return;
    setSaving(true);
    setSaveStatus("idle");
    try {
      await updateSecret(name, newValue);
      setSaveStatus("saved");
      setEditOpen(false);
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
    <>
      <Card>
        <CardContent className="flex items-center gap-3 py-0.5 px-4">
          <code className="font-mono font-semibold text-sm flex-1 min-w-0 truncate">{name}</code>

          <div className="flex items-center gap-1 shrink-0">
            {saveStatus === "saved" && (
              <span className="text-xs text-muted-foreground mr-1">Saved</span>
            )}
            {saveStatus === "error" && (
              <span className="text-xs text-destructive mr-1">Error</span>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setEditOpen(true);
                setSaveStatus("idle");
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={deleting}>
                  <Trash2 className="h-3.5 w-3.5" />
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update secret</DialogTitle>
            <DialogDescription>
              Enter a new value for <strong>{name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New value</Label>
            <Input
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="New value"
              autoFocus
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !newValue}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SecretList({ secrets, onDeleted, onUpdated }: SecretListProps) {
  return (
    <div className="space-y-3">
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
