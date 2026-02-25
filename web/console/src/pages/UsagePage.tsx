import { useEffect, useState, useCallback } from "react";
import { fetchUsage } from "@/api";
import type { UsageBucket } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { formatTokens, formatCost, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "weekly" | "monthly";

export function UsagePage() {
  const [view, setView] = useState<View>("weekly");
  const [buckets, setBuckets] = useState<UsageBucket[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (v: View) => {
    setLoading(true);
    try {
      const result = await fetchUsage(v);
      setBuckets(result.buckets);
      setSelected(result.buckets.length - 1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(view);
  }, [view, loadData]);

  const changeView = (v: View) => {
    setView(v);
  };

  const selectedBucket = selected !== null ? buckets[selected] ?? null : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Usage</h1>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {(["weekly", "monthly"] as const).map((v) => (
            <button
              key={v}
              onClick={() => changeView(v)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v === "weekly" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-16 text-muted-foreground">Loading...</div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {buckets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No usage data recorded yet.
              </CardContent>
            </Card>
          ) : (
            <>
              <CostChart
                buckets={buckets}
                selected={selected}
                onSelect={(i) => setSelected(selected === i ? null : i)}
              />

              {selectedBucket && (
                <AgentBreakdown bucket={selectedBucket} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function CostChart({
  buckets,
  selected,
  onSelect,
}: {
  buckets: UsageBucket[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const maxDuration = Math.max(...buckets.map((b) => b.durationMs));

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-end gap-1" style={{ height: 160 }}>
          {buckets.map((bucket, i) => {
            const heightPct = maxDuration > 0 ? (bucket.durationMs / maxDuration) * 100 : 0;
            const isSelected = selected === i;
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                className="group relative flex flex-1 flex-col items-center cursor-pointer"
                style={{ height: "100%" }}
              >
                <div className="flex flex-1 w-full items-end">
                  <div
                    className={cn(
                      "w-full rounded-t transition-colors",
                      isSelected
                        ? "bg-primary"
                        : bucket.durationMs > 0
                          ? "bg-primary/60 group-hover:bg-primary/80"
                          : "bg-muted/30"
                    )}
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                  />
                </div>
                <span className={cn(
                  "mt-1.5 text-[10px] leading-none transition-colors",
                  isSelected ? "text-foreground font-medium" : "text-muted-foreground"
                )}>
                  {bucket.label.split(" – ")[0]}
                </span>
                {/* Tooltip */}
                <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 border">
                  {formatDuration(bucket.durationMs)} · {bucket.messages} msgs
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

type SortKey = "agentId" | "messages" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "costUsd" | "durationMs";
type SortDir = "asc" | "desc";

const columns: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "agentId", label: "Agent", align: "left" },
  { key: "messages", label: "Msgs", align: "right" },
  { key: "inputTokens", label: "Input", align: "right" },
  { key: "outputTokens", label: "Output", align: "right" },
  { key: "cacheReadTokens", label: "Cache", align: "right" },
  { key: "costUsd", label: "Cost", align: "right" },
  { key: "durationMs", label: "Time", align: "right" },
];

function AgentBreakdown({ bucket }: { bucket: UsageBucket }) {
  const [sortKey, setSortKey] = useState<SortKey>("messages");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "agentId" ? "asc" : "desc");
    }
  };

  const sorted = [...bucket.byAgent].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <Card className="max-h-[60vh] flex flex-col overflow-hidden">
      <CardHeader className="shrink-0">
        <CardTitle className="text-base">{bucket.label}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto min-h-0">
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={cn(
                    "cursor-pointer select-none hover:text-foreground transition-colors",
                    col.align === "right" && "text-right"
                  )}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1 text-[10px]">{sortDir === "desc" ? "\u25BC" : "\u25B2"}</span>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((agent) => (
              <TableRow
                key={agent.agentId}
                className={cn(agent.agentId === "_system" && "text-muted-foreground")}
              >
                <TableCell className="font-medium">
                  {agent.agentId === "_system" ? <span className="italic">system</span> : agent.agentId}
                </TableCell>
                <TableCell className="text-right">{agent.messages}</TableCell>
                <TableCell className="text-right">{formatTokens(agent.inputTokens)}</TableCell>
                <TableCell className="text-right">{formatTokens(agent.outputTokens)}</TableCell>
                <TableCell className="text-right">{formatTokens(agent.cacheReadTokens)}</TableCell>
                <TableCell className="text-right">{formatCost(agent.costUsd)}</TableCell>
                <TableCell className="text-right">{formatDuration(agent.durationMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="sticky bottom-0">
            <TableRow className="font-semibold hover:bg-muted/50">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{bucket.messages}</TableCell>
              <TableCell className="text-right">{formatTokens(bucket.inputTokens)}</TableCell>
              <TableCell className="text-right">{formatTokens(bucket.outputTokens)}</TableCell>
              <TableCell className="text-right">{formatTokens(bucket.cacheReadTokens)}</TableCell>
              <TableCell className="text-right">{formatCost(bucket.costUsd)}</TableCell>
              <TableCell className="text-right">{formatDuration(bucket.durationMs)}</TableCell>
            </TableRow>
          </TableFooter>
        </table>
      </CardContent>
    </Card>
  );
}
