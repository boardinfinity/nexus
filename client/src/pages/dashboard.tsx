import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { KPICard } from "@/components/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Briefcase, Building2, Users, GitBranch } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { authFetch } from "@/lib/queryClient";
import type { DashboardStats, Job, PipelineRun, ProviderCredit } from "@shared/schema";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: jobDetail } = useQuery<Job>({
    queryKey: ["/api/jobs", selectedJob?.id],
    queryFn: async () => {
      const res = await authFetch(`/api/jobs/${selectedJob!.id}`);
      if (!res.ok) throw new Error("Failed to fetch job");
      return res.json();
    },
    enabled: !!selectedJob?.id,
  });

  const { data: recentJobs, isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ["/api/dashboard/recent-jobs"],
  });

  const { data: pipelineActivity, isLoading: pipelinesLoading } = useQuery<PipelineRun[]>({
    queryKey: ["/api/dashboard/pipeline-activity"],
  });

  const { data: credits } = useQuery<ProviderCredit[]>({
    queryKey: ["/api/providers/credits"],
  });

  const { data: jobStats } = useQuery<{ byDay: { date: string; count: number }[] }>({
    queryKey: ["/api/jobs/stats"],
  });

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your data intelligence platform</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="cursor-pointer" onClick={() => navigate("/jobs")}>
          <KPICard
            title="Total Jobs"
            value={stats?.total_jobs ?? 0}
            icon={Briefcase}
            subtitle="Across all sources"
          />
        </div>
        <div className="cursor-pointer" onClick={() => navigate("/companies")}>
          <KPICard
            title="Total Companies"
            value={stats?.total_companies ?? 0}
            icon={Building2}
            subtitle="In database"
          />
        </div>
        <div className="cursor-pointer" onClick={() => navigate("/people")}>
          <KPICard
            title="Total People"
            value={stats?.total_people ?? 0}
            icon={Users}
            subtitle="Contacts tracked"
          />
        </div>
        <div className="cursor-pointer" onClick={() => navigate("/pipelines")}>
          <KPICard
            title="Active Pipelines"
            value={stats?.active_pipelines ?? 0}
            icon={GitBranch}
            subtitle="Currently running"
          />
        </div>
      </div>

      {jobStats?.byDay && jobStats.byDay.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Jobs Ingested (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={jobStats.byDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    className="text-xs"
                    tickFormatter={(v) => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" })}
                  />
                  <YAxis className="text-xs" />
                  <Tooltip
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(183, 99%, 22%)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium cursor-pointer hover:text-primary" onClick={() => navigate("/pipelines")}>Recent Pipeline Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { header: "Type", accessor: (r: PipelineRun) => r.pipeline_type?.replace(/_/g, " ") ?? "—" },
                { header: "Status", accessor: (r: PipelineRun) => <StatusBadge status={r.status} /> },
                {
                  header: "Progress",
                  accessor: (r: PipelineRun) =>
                    `${r.processed_items ?? 0}/${r.total_items ?? 0}`,
                },
                {
                  header: "Date",
                  accessor: (r: PipelineRun) =>
                    r.started_at
                      ? new Date(r.started_at).toLocaleDateString()
                      : "—",
                },
              ]}
              data={pipelineActivity ?? []}
              isLoading={pipelinesLoading}
              onRowClick={() => navigate("/pipelines")}
              emptyMessage="No pipeline runs yet"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium cursor-pointer hover:text-primary" onClick={() => navigate("/jobs")}>Recent Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { header: "Title", accessor: "title" as keyof Job, className: "max-w-[200px] truncate" },
                { header: "Company", accessor: "company_name" as keyof Job },
                { header: "Source", accessor: (r: Job) => <StatusBadge status={r.source} /> },
                {
                  header: "Posted",
                  accessor: (r: Job) =>
                    r.posted_at
                      ? new Date(r.posted_at).toLocaleDateString()
                      : "—",
                },
              ]}
              data={recentJobs ?? []}
              isLoading={jobsLoading}
              onRowClick={(row) => setSelectedJob(row)}
              emptyMessage="No jobs found"
            />
          </CardContent>
        </Card>
      </div>

      {credits && credits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Credit Usage by Provider</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {credits.map((c) => (
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
          </CardContent>
        </Card>
      )}

      <Sheet open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-lg">{jobDetail?.title || selectedJob?.title}</SheetTitle>
          </SheetHeader>
          {(jobDetail || selectedJob) && (() => {
            const job = jobDetail || selectedJob!;
            return (
              <div className="space-y-3 mt-4 text-sm">
                {[
                  ["Company", job.company_name],
                  ["Location", [job.location_city, job.location_country].filter(Boolean).join(", ")],
                  ["Source", job.source],
                  ["Employment Type", job.employment_type?.replace(/_/g, " ")],
                  ["Seniority", job.seniority_level],
                  ["Posted", job.posted_at ? new Date(job.posted_at).toLocaleDateString() : null],
                ].map(([label, val]) => val ? (
                  <div key={label as string} className="flex justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{String(val)}</span>
                  </div>
                ) : null)}
                {job.source_url && (
                  <a href={job.source_url} target="_blank" rel="noreferrer" className="text-primary text-sm hover:underline block">
                    View Original Listing
                  </a>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
