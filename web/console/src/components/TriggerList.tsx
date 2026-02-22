import { Card, CardContent } from "@/components/ui/card";
import { cronToHuman } from "@/lib/cron";
import type { Trigger } from "@/types";

interface TriggerListProps {
  triggers: Trigger[];
  onSelect: (trigger: Trigger) => void;
}

export function TriggerList({ triggers, onSelect }: TriggerListProps) {
  return (
    <div className="space-y-3">
      {triggers.map((trigger) => {
        const human = cronToHuman(trigger.cron);
        return (
          <button
            key={trigger.id}
            type="button"
            onClick={() => onSelect(trigger)}
            className="block w-full text-left"
          >
            <Card className="cursor-pointer transition-colors hover:bg-muted/50">
              <CardContent className="flex items-start gap-4 py-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-3">
                    <code className="text-sm font-mono font-semibold">{trigger.cron}</code>
                    {human && (
                      <span className="text-sm text-muted-foreground">{human}</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {trigger.prompt.split("\n")[0]}
                  </p>
                  <div className="flex items-center gap-3">
                    {trigger.agentName && (
                      <span className="text-xs text-muted-foreground">{trigger.agentName}</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
