import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutoSave, useImmediateSave } from "@/hooks/use-auto-save";

interface AgentHeaderProps {
  agentId: string;
  name: string;
  description: string;
  security: string;
  model: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSecurityChange: (value: string) => void;
  onModelChange: (value: string) => void;
}

export function AgentHeader({
  agentId,
  name,
  description,
  security,
  model,
  onNameChange,
  onDescriptionChange,
  onSecurityChange,
  onModelChange,
}: AgentHeaderProps) {
  useAutoSave(agentId, "name", name);
  useAutoSave(agentId, "description", description);
  const { save: saveSecurity } = useImmediateSave(agentId);
  const { save: saveModel } = useImmediateSave(agentId);
  const [securityKey, setSecurityKey] = useState(0);
  const [modelKey, setModelKey] = useState(0);

  return (
    <div className="space-y-4">
      {/* ID */}
      <p className="font-mono text-xs text-muted-foreground">
        ID: {agentId}
      </p>

      {/* Name/Description (left) + Security/Model (right) */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-description">Description</Label>
            <Input
              id="agent-description"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Security</Label>
            <Select
              key={securityKey}
              value={security}
              onValueChange={(value) => {
                onSecurityChange(value);
                saveSecurity({ trust: value });
                setSecurityKey((k) => k + 1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-yellow-500" />
                    sandbox
                  </span>
                </SelectItem>
                <SelectItem value="controlled">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-blue-500" />
                    controlled
                  </span>
                </SelectItem>
                <SelectItem value="unrestricted">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-red-500" />
                    unrestricted
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select
              key={modelKey}
              value={model}
              onValueChange={(value) => {
                onModelChange(value);
                saveModel({ model: value });
                setModelKey((k) => k + 1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sonnet">Sonnet · Balanced</SelectItem>
                <SelectItem value="opus">Opus · Best quality</SelectItem>
                <SelectItem value="haiku">Haiku · Fast & cheap</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
