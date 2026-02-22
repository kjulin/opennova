import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { fetchAgent } from "@/api";
import type { Agent } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentHeader } from "@/components/AgentHeader";
import { AgentIdentity } from "@/components/AgentIdentity";
import { AgentCapabilities } from "@/components/AgentCapabilities";
import { AgentDirectories } from "@/components/AgentDirectories";
import { AgentAllowedAgents } from "@/components/AgentAllowedAgents";
import { AgentSkills } from "@/components/AgentSkills";
import { AgentTriggers } from "@/components/AgentTriggers";
import { AgentDangerZone } from "@/components/AgentDangerZone";

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
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [allowedAgents, setAllowedAgents] = useState<string[]>([]);

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
        setCapabilities(data.capabilities ?? []);
        setDirectories(data.directories ?? []);
        setAllowedAgents(data.allowedAgents ?? []);
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
          to="/agents"
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

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          to="/agents"
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
      <Card>
        <CardHeader>
          <CardTitle>Identity & Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentIdentity
            agentId={id}
            identity={identity}
            instructions={instructions}
            onIdentityChange={setIdentity}
            onInstructionsChange={setInstructions}
          />
        </CardContent>
      </Card>

      {/* Capabilities */}
      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentCapabilities
            agentId={id}
            capabilities={capabilities}
            onCapabilitiesChange={setCapabilities}
          />
        </CardContent>
      </Card>

      {/* Directories */}
      <Card>
        <CardHeader>
          <CardTitle>Directories</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentDirectories
            agentId={id}
            directories={directories}
            onDirectoriesChange={setDirectories}
          />
        </CardContent>
      </Card>

      {/* Allowed Agents */}
      <Card>
        <CardHeader>
          <CardTitle>Allowed Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentAllowedAgents
            agentId={id}
            allowedAgents={allowedAgents}
            onAllowedAgentsChange={setAllowedAgents}
          />
        </CardContent>
      </Card>

      {/* Skills (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentSkills skills={agent.skills} />
        </CardContent>
      </Card>

      {/* Triggers (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Triggers</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentTriggers triggers={agent.triggers} />
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentDangerZone agentId={id} agentName={name} />
        </CardContent>
      </Card>
    </div>
  );
}
