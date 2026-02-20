import { Link } from "react-router-dom";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Agent } from "@/types";

function SecurityBadge({ level }: { level: string }) {
  switch (level) {
    case "sandbox":
      return (
        <Badge variant="outline" className="border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
          sandbox
        </Badge>
      );
    case "unrestricted":
      return <Badge variant="destructive">unrestricted</Badge>;
    default:
      return <Badge variant="default">{level}</Badge>;
  }
}

export function AgentList({ agents }: { agents: Agent[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => (
        <Link key={agent.id} to={`/agents/${agent.id}`}>
          <Card className="cursor-pointer transition-colors hover:bg-muted/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{agent.name}</h3>
                <SecurityBadge level={agent.security} />
              </div>
              <p className="text-xs text-muted-foreground font-mono">{agent.id}</p>
            </CardHeader>
            <CardContent>
              {agent.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                  {agent.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {agent.triggers.length} trigger{agent.triggers.length !== 1 && "s"}
                {" · "}
                {agent.skills.length} skill{agent.skills.length !== 1 && "s"}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
