import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { fetchAgent } from "@/api";
import type { Agent } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { AgentHeader } from "@/components/AgentHeader";
import { AgentIdentity } from "@/components/AgentIdentity";
import { AgentResponsibilities } from "@/components/AgentResponsibilities";
import { AgentCapabilities } from "@/components/AgentCapabilities";
import { AgentDirectories } from "@/components/AgentDirectories";
import { AgentSkills } from "@/components/AgentSkills";
import { AgentTriggers } from "@/components/AgentTriggers";
import { AgentDangerZone } from "@/components/AgentDangerZone";
import type { Responsibility } from "@/types";

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local state for editable fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [security, setSecurity] = useState("controlled");
  const [model, setModel] = useState("");
  const [identity, setIdentity] = useState("");
  const [instructions, setInstructions] = useState("");
  const [responsibilities, setResponsibilities] = useState<Responsibility[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    fetchAgent(id)
      .then((data) => {
        setAgent(data);
        setName(data.name);
        setDescription(data.description ?? "");
        setSecurity(data.trust ?? "controlled");
        setModel(data.model ?? "");
        setIdentity(data.identity ?? "");
        setInstructions(data.instructions ?? "");
        setResponsibilities(data.responsibilities ?? []);
        setCapabilities(data.capabilities ? Object.keys(data.capabilities) : []);
        setDirectories(data.directories ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          to="/web/console/agents"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Agents
        </Link>
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error === "Agent not found"
            ? `Agent "${id}" not found`
            : error}
        </div>
      </div>
    );
  }

  if (!agent || !id) return null;

  const respSummary = responsibilities.length > 0
    ? responsibilities.map((r) => r.title).join(", ")
    : "No responsibilities defined";

  const capsSummary = capabilities.length > 0
    ? capabilities.join(", ")
    : "No capabilities enabled";

  const dirsSummary = directories.length > 0
    ? directories.join(", ")
    : "No extra directories configured";

  const skillsSummary = agent.skills.length > 0
    ? agent.skills.join(", ")
    : "No skills installed";

  const triggersSummary = agent.triggers.length > 0
    ? `${agent.triggers.length} scheduled`
    : "No scheduled triggers";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          to="/web/console/agents"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Agents
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{name}</span>
      </div>

      {/* Header */}
      <Card>
        <CardContent>
          <AgentHeader
            agentId={id}
            name={name}
            description={description}
            security={security}
            model={model}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onSecurityChange={setSecurity}
            onModelChange={setModel}
          />
        </CardContent>
      </Card>

      {/* Identity & Instructions */}
      <CollapsibleCard
        title="Identity & Instructions"
        description="Define who this agent is and how it operates"
      >
        <AgentIdentity
          agentId={id}
          identity={identity}
          instructions={instructions}
          onIdentityChange={setIdentity}
          onInstructionsChange={setInstructions}
        />
      </CollapsibleCard>

      {/* Responsibilities */}
      <CollapsibleCard
        title="Responsibilities"
        description={respSummary}
      >
        <AgentResponsibilities
          agentId={id}
          responsibilities={responsibilities}
          onResponsibilitiesChange={setResponsibilities}
        />
      </CollapsibleCard>

      {/* Capabilities */}
      <CollapsibleCard
        title="Capabilities"
        description={capsSummary}
      >
        <AgentCapabilities
          agentId={id}
          capabilities={capabilities}
          onCapabilitiesChange={setCapabilities}
        />
      </CollapsibleCard>

      {/* Directories */}
      <CollapsibleCard
        title="Directories"
        description={dirsSummary}
      >
        <AgentDirectories
          agentId={id}
          directories={directories}
          onDirectoriesChange={setDirectories}
        />
      </CollapsibleCard>

      {/* Skills */}
      <CollapsibleCard
        title="Skills"
        description={skillsSummary}
      >
        <AgentSkills skills={agent.skills} />
      </CollapsibleCard>

      {/* Triggers */}
      <CollapsibleCard
        title="Triggers"
        description={triggersSummary}
      >
        <AgentTriggers triggers={agent.triggers} />
      </CollapsibleCard>

      {/* Danger Zone */}
      <CollapsibleCard
        title="Danger Zone"
        description="Delete this agent and all its data"
        className="border-destructive/20"
        titleClassName="text-destructive"
      >
        <AgentDangerZone agentId={id} agentName={name} />
      </CollapsibleCard>
    </div>
  );
}
