import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useImmediateSave } from "@/hooks/use-auto-save";
import { fetchCapabilities } from "@/api";
import type { CapabilityDescriptor } from "@/types";

interface AgentCapabilitiesProps {
  agentId: string;
  capabilities: Record<string, { tools?: string[] }>;
  onCapabilitiesChange: (capabilities: Record<string, { tools?: string[] }>) => void;
}

export function AgentCapabilities({
  agentId,
  capabilities,
  onCapabilitiesChange,
}: AgentCapabilitiesProps) {
  const { save } = useImmediateSave(agentId);
  const [registry, setRegistry] = useState<CapabilityDescriptor[]>([]);

  useEffect(() => {
    fetchCapabilities()
      .then((data) => setRegistry(data.capabilities))
      .catch(() => {});
  }, []);

  function handleToggleCap(capKey: string, checked: boolean) {
    let updated: Record<string, { tools?: string[] }>;
    if (checked) {
      updated = { ...capabilities, [capKey]: {} };
    } else {
      const { [capKey]: _, ...rest } = capabilities;
      updated = rest;
    }
    onCapabilitiesChange(updated);
    save({ capabilities: updated });
  }

  function handleToggleTool(capKey: string, toolName: string, checked: boolean) {
    const descriptor = registry.find((d) => d.key === capKey);
    if (!descriptor) return;

    const current = capabilities[capKey];
    if (!current) return;

    const allToolNames = descriptor.tools.map((t) => t.name);
    const currentTools = current.tools ?? allToolNames;

    let newTools: string[];
    if (checked) {
      newTools = [...currentTools, toolName];
    } else {
      newTools = currentTools.filter((t) => t !== toolName);
    }

    // If all tools selected, clear the filter (equivalent to {})
    const isAll = newTools.length >= allToolNames.length;
    const updated = {
      ...capabilities,
      [capKey]: isAll ? {} : { tools: newTools },
    };
    onCapabilitiesChange(updated);
    save({ capabilities: updated });
  }

  if (registry.length === 0) {
    return <div className="text-sm text-muted-foreground">Loading capabilities...</div>;
  }

  return (
    <div className="space-y-3">
      {registry.map((cap) => {
        const isEnabled = cap.key in capabilities;
        const config = capabilities[cap.key];
        const activeTools = config?.tools;
        const allToolNames = cap.tools.map((t) => t.name);
        const hasTools = cap.tools.length > 0;
        const showToolFilter = isEnabled && hasTools && cap.tools.length > 1;

        return (
          <div key={cap.key}>
            <div className="flex items-center gap-3">
              <Checkbox
                id={`cap-${cap.key}`}
                checked={cap.key in capabilities}
                onCheckedChange={(checked) => handleToggleCap(cap.key, checked === true)}
              />
              <Label htmlFor={`cap-${cap.key}`} className="cursor-pointer">
                {cap.key}
              </Label>
              {hasTools && (
                <span className="text-xs text-muted-foreground">
                  {cap.tools.length} tool{cap.tools.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {showToolFilter && (
              <div className="ml-8 mt-1 space-y-1">
                {cap.tools.map((tool) => {
                  const isToolActive = activeTools
                    ? activeTools.includes(tool.name)
                    : true;
                  return (
                    <div key={tool.name} className="flex items-center gap-2">
                      <Checkbox
                        id={`tool-${cap.key}-${tool.name}`}
                        checked={isToolActive}
                        onCheckedChange={(checked) =>
                          handleToggleTool(cap.key, tool.name, checked === true)
                        }
                      />
                      <Label
                        htmlFor={`tool-${cap.key}-${tool.name}`}
                        className="cursor-pointer text-xs font-mono"
                      >
                        {tool.name}
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {tool.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
