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
        <Link key={agent.id} to={`/agents/${agent.id}`} className="block">
          <Card className="h-full cursor-pointer transition-colors hover:bg-muted/50">
            <CardHeader>
              <h3 className="font-semibold">{agent.name}</h3>
            </CardHeader>
            <CardContent>
              {agent.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                  {agent.description}
                </p>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {agent.triggers.length} trigger{agent.triggers.length !== 1 && "s"}
                  {" · "}
                  {agent.skills.length} skill{agent.skills.length !== 1 && "s"}
                </span>
                <SecurityBadge level={agent.security} />
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
