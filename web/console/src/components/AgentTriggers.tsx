import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Trigger } from "@/types";

interface AgentTriggersProps {
  triggers: Trigger[];
}

function TriggerRow({ trigger }: { trigger: Trigger }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {trigger.cron}
        </span>
        <span className="text-sm truncate flex-1">{trigger.prompt}</span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 pl-9">
          <p className="text-sm whitespace-pre-wrap">{trigger.prompt}</p>
        </div>
      )}
    </div>
  );
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
            <TriggerRow key={trigger.id} trigger={trigger} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Manage triggers in the Triggers section
      </p>
    </div>
  );
}
