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
import { SaveStatusIndicator } from "@/components/SaveStatusIndicator";
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
  const nameStatus = useAutoSave(agentId, "name", name);
  const descriptionStatus = useAutoSave(agentId, "description", description);
  const { status: securityStatus, save: saveSecurity } =
    useImmediateSave(agentId);
  const { status: modelStatus, save: saveModel } = useImmediateSave(agentId);
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
            <div className="flex items-center gap-2">
              <Label htmlFor="agent-name">Name</Label>
              <SaveStatusIndicator status={nameStatus} />
            </div>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="agent-description">Description</Label>
              <SaveStatusIndicator status={descriptionStatus} />
            </div>
            <Input
              id="agent-description"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label>Security</Label>
              <SaveStatusIndicator status={securityStatus} />
            </div>
            <Select
              key={securityKey}
              value={security}
              onValueChange={(value) => {
                onSecurityChange(value);
                saveSecurity({ security: value });
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
                <SelectItem value="standard">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-blue-500" />
                    standard
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
            <div className="flex items-center gap-2">
              <Label>Model</Label>
              <SaveStatusIndicator status={modelStatus} />
            </div>
            <Select
              key={modelKey}
              value={model || "__default__"}
              onValueChange={(value) => {
                const newModel = value === "__default__" ? "" : value;
                onModelChange(newModel);
                saveModel({ model: newModel || null });
                setModelKey((k) => k + 1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">(system default)</SelectItem>
                <SelectItem value="sonnet">sonnet</SelectItem>
                <SelectItem value="opus">opus</SelectItem>
                <SelectItem value="haiku">haiku</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
