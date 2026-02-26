import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { fetchConfig, fetchAgents } from "@/api";
import type { ConfigResponse } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function DashboardPage() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [configData, agentsData] = await Promise.all([
        fetchConfig(),
        fetchAgents(),
      ]);
      setConfig(configData);
      setAgentCount(agentsData.agents.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    }
  }, []);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <div className="flex justify-center py-16 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error || "Failed to load dashboard"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Daemon</p>
              <p className="text-sm font-medium">
                v{config.daemon.version} &middot; up {formatUptime(config.daemon.uptime)}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Agents</p>
              <p className="text-sm font-medium">
                <Link to="/web/console/agents" className="text-primary hover:underline">
                  {agentCount ?? 0} agent{agentCount !== 1 ? "s" : ""}
                </Link>
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Auth</p>
              <p className="text-sm font-medium">
                {config.auth.method === "claude-code"
                  ? "Subscription"
                  : config.auth.method === "api-key"
                    ? "API Key"
                    : "Not detected"}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Telegram</p>
              <p className="text-sm font-medium">
                {config.telegram.configured && config.telegram.chatId ? (
                  <Link to="/web/console/config" className="text-primary hover:underline">
                    Paired{config.telegram.chatName ? ` with ${config.telegram.chatName}` : ""}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Not configured</span>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
