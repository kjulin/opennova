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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { SkillAssignments } from "@/components/SkillAssignments";
import { useSkillAutoSave, type SaveStatus } from "@/hooks/use-skill-auto-save";
import { createSkill, deleteSkill, fetchSkill } from "@/api";
import type { Skill, Agent } from "@/types";
import { cn } from "@/lib/utils";

const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;

interface SkillDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: Skill | null;
  allAgents: Agent[];
  onCreated: (skill: Skill) => void;
  onDeleted: (name: string) => void;
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

export function SkillDrawer({
  open,
  onOpenChange,
  skill,
  allAgents,
  onCreated,
  onDeleted,
  onUpdated,
}: SkillDrawerProps) {
  // Edit mode state
  const [editSkill, setEditSkill] = useState<Skill | null>(skill);
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [assignedAgents, setAssignedAgents] = useState<string[]>([]);

  // Create mode state
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [deleting, setDeleting] = useState(false);

  const isCreateMode = editSkill === null;

  // Auto-save hooks (only active in edit mode)
  const descriptionStatus = useSkillAutoSave(
    editSkill?.name ?? "",
    "description",
    description,
    !isCreateMode,
  );
  const contentStatus = useSkillAutoSave(
    editSkill?.name ?? "",
    "content",
    content,
    !isCreateMode,
  );

  // Sync state when skill prop changes or drawer opens
  useEffect(() => {
    if (open) {
      setEditSkill(skill);
      if (skill) {
        setDescription(skill.description ?? "");
        setContent(skill.content ?? "");
        setAssignedAgents(skill.assignedTo);
      } else {
        setCreateName("");
        setCreateDescription("");
        setCreateContent("");
        setCreateError(null);
      }
    }
  }, [open, skill]);

  async function handleCreate() {
    if (!VALID_SKILL_NAME.test(createName)) {
      setCreateError("Name must start with a letter or number and contain only lowercase letters, numbers, and hyphens.");
      return;
    }
    if (!createContent.trim()) {
      setCreateError("Content is required.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await createSkill({
        name: createName,
        description: createDescription || undefined,
        content: createContent,
      });
      onCreated(created);
      // Switch to edit mode by fetching full detail
      const detail = await fetchSkill(created.name);
      setEditSkill(detail);
      setDescription(detail.description ?? "");
      setContent(detail.content ?? "");
      setAssignedAgents(detail.assignedTo);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create skill");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!editSkill) return;
    setDeleting(true);
    try {
      await deleteSkill(editSkill.name);
      onDeleted(editSkill.name);
      onOpenChange(false);
    } catch {
      // keep drawer open on error
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[640px] overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle>{isCreateMode ? "Create Skill" : "Edit Skill"}</SheetTitle>
          <SheetDescription>
            {isCreateMode
              ? "Create a new shared skill."
              : `Editing ${editSkill.name}`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-4">
          {/* Name */}
          <div className="space-y-2">
            <Label>Name</Label>
            {isCreateMode ? (
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="my-skill"
                className="font-mono"
              />
            ) : (
              <Input
                value={editSkill.name}
                disabled
                className="font-mono"
              />
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Description</Label>
              {!isCreateMode && <StatusText status={descriptionStatus} />}
            </div>
            {isCreateMode ? (
              <Input
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Optional description"
              />
            ) : (
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            )}
          </div>

          {/* Content */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Content</Label>
              {!isCreateMode && <StatusText status={contentStatus} />}
            </div>
            {isCreateMode ? (
              <AutoResizeTextarea
                value={createContent}
                onChange={setCreateContent}
                minRows={12}
                placeholder="Skill content (markdown)..."
              />
            ) : (
              <AutoResizeTextarea
                value={content}
                onChange={setContent}
                minRows={12}
                placeholder="Skill content (markdown)..."
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

          {/* Edit mode: assignments + delete */}
          {!isCreateMode && (
            <>
              <div className="space-y-2">
                <Label>Assigned Agents</Label>
                <SkillAssignments
                  skillName={editSkill.name}
                  assignedAgents={assignedAgents}
                  allAgents={allAgents}
                  onAssignmentChange={(updated) => {
                    setAssignedAgents(updated);
                    onUpdated();
                  }}
                />
              </div>

              <Separator />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={deleting}>
                    {deleting ? "Deleting..." : "Delete Skill"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete skill?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete {editSkill.name}? This will
                      unassign it from all agents.
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
