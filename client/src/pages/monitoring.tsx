import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/data-table";
import { KPICard } from "@/components/kpi-card";
import { AlertCircle, CheckCircle, Clock, Inbox } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { ProviderCredit, EnrichmentLog } from "@shared/schema";

export default function Monitoring() {
  const { data: credits } = useQuery<ProviderCredit[]>({
    queryKey: ["/api/providers/credits"],
    refetchInterval: 30000,
  });

  const { data: logs, isLoading: logsLoading } = useQuery<EnrichmentLog[]>({
    queryKey: ["/api/enrichment-logs"],
    refetchInterval: 10000,
  });

  const { data: queueStats } = useQuery<{ pending: number; processing: number; dead_letter: number }>({
    queryKey: ["/api/queue/stats"],
    refetchInterval: 10000,
  });

  const { data: pipelineStats } = useQuery<Array<{ pipeline_type: string; total: number; completed: number; failed: number }>>({
    queryKey: ["/api/pipeline-stats"],
    refetchInterval: 30000,
  });

  const chartData = credits?.map((c) => ({
    name: c.provider,
    used: c.credits_used,
    allocated: c.credits_allocated,
    pct: c.credits_allocated ? Math.round((c.credits_used / c.credits_allocated) * 100) : 0,
  })) ?? [];

  const successRateData = pipelineStats?.map((s) => ({
    name: s.pipeline_type.replace(/_/g, " "),
    rate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
    total: s.total,
  })) ?? [];

  return (
    <div className="space-y-6" data-testid="monitoring-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Monitoring</h1>
        <p className="text-sm text-muted-foreground">System health, credits, and queue status</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <KPICard
          title="Queue Pending"
          value={queueStats?.pending ?? 0}
          icon={Clock}
          subtitle="Waiting to process"
        />
        <KPICard
          title="Queue Processing"
          value={queueStats?.processing ?? 0}
          icon={Inbox}
          subtitle="Currently running"
        />
        <KPICard
          title="Dead Letter"
          value={queueStats?.dead_letter ?? 0}
          icon={AlertCircle}
          subtitle="Failed permanently"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Credit Usage by Provider</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs capitalize" />
                    <YAxis className="text-xs" />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="used" name="Used" fill="hsl(183, 99%, 22%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="allocated" name="Allocated" fill="hsl(183, 40%, 80%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No credit data available</p>
            )}
            <div className="space-y-3 mt-4">
              {credits?.map((c) => (
                <div key={c.provider} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium capitalize">{c.provider}</span>
                    <span className="text-muted-foreground">
                      {c.credits_used?.toLocaleString()} / {c.credits_allocated?.toLocaleString()}
                    </span>
                  </div>
                  <Progress
                    value={c.credits_allocated ? (c.credits_used / c.credits_allocated) * 100 : 0}
                    className="h-2"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Pipeline Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            {successRateData.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={successRateData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs capitalize" />
                    <YAxis domain={[0, 100]} className="text-xs" />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value: number) => [`${value}%`, "Success Rate"]}
                    />
                    <Bar dataKey="rate" name="Success %" radius={[4, 4, 0, 0]}>
                      {successRateData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.rate >= 80 ? "hsl(152, 69%, 40%)" : entry.rate >= 50 ? "hsl(45, 93%, 50%)" : "hsl(0, 72%, 51%)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No pipeline stats yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent Enrichment Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              {
                header: "Time",
                accessor: (r: EnrichmentLog) =>
                  r.created_at ? new Date(r.created_at).toLocaleString() : "—",
              },
              { header: "Provider", accessor: "provider" as keyof EnrichmentLog, className: "capitalize" },
              { header: "Entity", accessor: (r: EnrichmentLog) => `${r.entity_type}` },
              { header: "Status", accessor: (r: EnrichmentLog) => <StatusBadge status={r.status} /> },
              { header: "Credits", accessor: (r: EnrichmentLog) => r.credits_used?.toString() ?? "0" },
              {
                header: "Response",
                accessor: (r: EnrichmentLog) =>
                  r.response_time_ms ? `${r.response_time_ms}ms` : "—",
              },
            ]}
            data={logs ?? []}
            isLoading={logsLoading}
            emptyMessage="No enrichment logs yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}
