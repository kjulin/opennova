import { cn } from "@/lib/utils";
import type { SaveStatus } from "@/hooks/use-auto-save";

export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle" || status === "saved") return null;

  return (
    <span
      className={cn(
        "text-xs",
        status === "saving" && "text-muted-foreground",
        status === "error" && "text-destructive",
      )}
    >
      {status === "saving" && "Saving..."}
      {status === "error" && "Failed to save"}
    </span>
  );
}
