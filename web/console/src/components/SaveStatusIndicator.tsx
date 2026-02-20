import { cn } from "@/lib/utils";
import type { SaveStatus } from "@/hooks/use-auto-save";

export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;

  return (
    <span
      className={cn(
        "text-xs transition-opacity",
        status === "saving" && "text-muted-foreground",
        status === "saved" && "text-muted-foreground animate-fade-out",
        status === "error" && "text-destructive",
      )}
    >
      {status === "saving" && "Saving..."}
      {status === "saved" && "Saved"}
      {status === "error" && "Failed to save"}
    </span>
  );
}
