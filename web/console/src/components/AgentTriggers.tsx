import { Badge } from "@/components/ui/badge";
import type { Trigger } from "@/types";

interface AgentTriggersProps {
  triggers: Trigger[];
}

export function AgentTriggers({ triggers }: AgentTriggersProps) {
  return (
    <div className="space-y-2">
      {triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No triggers configured
        </p>
      ) : (
        <div className="space-y-2">
          {triggers.map((trigger) => (
            <div
              key={trigger.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <span className="font-mono text-xs text-muted-foreground shrink-0">
                {trigger.cron}
              </span>
              <span className="text-sm truncate flex-1">{trigger.prompt}</span>
              <Badge variant={trigger.enabled ? "secondary" : "outline"}>
                {trigger.enabled ? "enabled" : "disabled"}
              </Badge>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Manage triggers in the Triggers section
      </p>
    </div>
  );
}
