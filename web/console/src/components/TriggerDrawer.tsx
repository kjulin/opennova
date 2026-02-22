import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { TriggerCronPreview } from "@/components/TriggerCronPreview";
import { useTriggerAutoSave, useImmediateTriggerSave, type SaveStatus } from "@/hooks/use-trigger-auto-save";
import { createTrigger, deleteTrigger } from "@/api";
import type { Trigger, Agent } from "@/types";
import { cn } from "@/lib/utils";

const TIMEZONE_OPTIONS = [
  "UTC",
  "Europe/Helsinki",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
];

interface TriggerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: Trigger | null;
  allAgents: Agent[];
  onCreated: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
}

function StatusText({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  return (
    <span
      className={cn(
        "text-xs",
        status === "saving" && "text-muted-foreground",
        status === "saved" && "text-muted-foreground",
        status === "error" && "text-destructive",
      )}
    >
      {status === "saving" && "Saving..."}
      {status === "saved" && "Saved"}
      {status === "error" && "Error"}
    </span>
  );
}

export function TriggerDrawer({
  open,
  onOpenChange,
  trigger,
  allAgents,
  onCreated,
  onDeleted,
  onUpdated,
}: TriggerDrawerProps) {
  // Edit mode state
  const [editTrigger, setEditTrigger] = useState<Trigger | null>(trigger);
  const [cron, setCron] = useState("");
  const [tz, setTz] = useState("Europe/Helsinki");
  const [prompt, setPrompt] = useState("");

  // Create mode state
  const [createAgentId, setCreateAgentId] = useState("");
  const [createCron, setCreateCron] = useState("");
  const [createTz, setCreateTz] = useState("Europe/Helsinki");
  const [createPrompt, setCreatePrompt] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [deleting, setDeleting] = useState(false);

  const isCreateMode = editTrigger === null;

  // Auto-save hooks (only active in edit mode)
  const cronStatus = useTriggerAutoSave(
    editTrigger?.id ?? "",
    "cron",
    cron,
    !isCreateMode,
  );
  const promptStatus = useTriggerAutoSave(
    editTrigger?.id ?? "",
    "prompt",
    prompt,
    !isCreateMode,
  );
  const { status: immediateStatus, save: immediateSave } = useImmediateTriggerSave(
    editTrigger?.id ?? "",
  );

  // Sync state when trigger prop changes or drawer opens
  useEffect(() => {
    if (open) {
      setEditTrigger(trigger);
      if (trigger) {
        setCron(trigger.cron);
        setTz(trigger.tz ?? "Europe/Helsinki");
        setPrompt(trigger.prompt);
      } else {
        setCreateAgentId("");
        setCreateCron("");
        setCreateTz("Europe/Helsinki");
        setCreatePrompt("");
        setCreateError(null);
      }
    }
  }, [open, trigger]);

  async function handleCreate() {
    if (!createAgentId) {
      setCreateError("Please select an agent.");
      return;
    }
    if (!createCron.trim()) {
      setCreateError("Cron expression is required.");
      return;
    }
    if (!createPrompt.trim()) {
      setCreateError("Prompt is required.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await createTrigger(createAgentId, {
        cron: createCron,
        tz: createTz,
        prompt: createPrompt,
      });
      onCreated();
      // Switch to edit mode
      setEditTrigger(created);
      setCron(created.cron);
      setTz(created.tz ?? "Europe/Helsinki");
      setPrompt(created.prompt);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create trigger");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!editTrigger) return;
    setDeleting(true);
    try {
      await deleteTrigger(editTrigger.id);
      onDeleted();
      onOpenChange(false);
    } catch {
      // keep drawer open on error
    } finally {
      setDeleting(false);
    }
  }

  function handleTzChange(value: string) {
    setTz(value);
    immediateSave({ tz: value });
    onUpdated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[640px] overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle>{isCreateMode ? "Create Trigger" : "Edit Trigger"}</SheetTitle>
          <SheetDescription>
            {isCreateMode
              ? "Create a new scheduled trigger."
              : `Editing trigger for ${editTrigger.agentName ?? "agent"}`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-4">
          {/* Agent */}
          <div className="space-y-2">
            <Label>Agent</Label>
            {isCreateMode ? (
              <Select value={createAgentId} onValueChange={setCreateAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {allAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={editTrigger.agentName ?? editTrigger.agentId ?? ""}
                disabled
              />
            )}
          </div>

          {/* Cron */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Cron Expression</Label>
              {!isCreateMode && <StatusText status={cronStatus} />}
            </div>
            {isCreateMode ? (
              <>
                <Input
                  value={createCron}
                  onChange={(e) => setCreateCron(e.target.value)}
                  placeholder="* * * * *"
                  className="font-mono"
                />
                <TriggerCronPreview cron={createCron} />
              </>
            ) : (
              <>
                <Input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="* * * * *"
                  className="font-mono"
                />
                <TriggerCronPreview cron={cron} />
              </>
            )}
          </div>

          {/* Timezone */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Timezone</Label>
              {!isCreateMode && <StatusText status={immediateStatus} />}
            </div>
            {isCreateMode ? (
              <Select value={createTz} onValueChange={setCreateTz}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select value={tz} onValueChange={handleTzChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Prompt</Label>
              {!isCreateMode && <StatusText status={promptStatus} />}
            </div>
            {isCreateMode ? (
              <AutoResizeTextarea
                value={createPrompt}
                onChange={setCreatePrompt}
                minRows={6}
                placeholder="What should the agent do when triggered?"
              />
            ) : (
              <AutoResizeTextarea
                value={prompt}
                onChange={setPrompt}
                minRows={6}
                placeholder="What should the agent do when triggered?"
              />
            )}
          </div>

          {/* Create mode: error + button */}
          {isCreateMode && (
            <div className="space-y-2">
              {createError && (
                <p className="text-sm text-destructive">{createError}</p>
              )}
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
          )}

          {/* Edit mode: delete */}
          {!isCreateMode && (
            <>
              <Separator />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={deleting}>
                    {deleting ? "Deleting..." : "Delete Trigger"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete trigger?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete this trigger? This action cannot be undone.
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
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
