import { Link } from "react-router-dom";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import type { Agent } from "@/types";

export function AgentList({ agents }: { agents: Agent[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => (
        <Link key={agent.id} to={`/agents/${agent.id}`} className="block h-full">
          <Card className="h-full cursor-pointer transition-colors hover:bg-muted/50 flex flex-col">
            <CardHeader>
              <h3 className="font-semibold">{agent.name}</h3>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              {agent.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                  {agent.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-auto">
                {agent.triggers.length} trigger{agent.triggers.length !== 1 && "s"}
                {" · "}
                {agent.skills.length} skill{agent.skills.length !== 1 && "s"}
                {" · "}
                {agent.security}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
