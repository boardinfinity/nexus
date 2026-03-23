import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { KPICard } from "@/components/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Briefcase, Building2, Users, GitBranch, FileText, Brain, CheckCircle,
  Search, Download, ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
  LineChart, Line,
} from "recharts";
import { authFetch } from "@/lib/queryClient";
import type { DashboardStats, Job, PipelineRun, ProviderCredit } from "@shared/schema";

const COLORS = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#ec4899"];
const FUNNEL_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  partial: "#6366f1",
  complete: "#10b981",
  failed: "#ef4444",
};

interface OverviewData {
  total_jobs: number;
  jobs_with_descriptions: number;
  jobs_analyzed: number;
  jd_coverage_pct: number;
  skills_extracted: number;
  total_companies: number;
  total_people: number;
  total_alumni: number;
  jobs_period: number;
  enrichment_complete_pct: number;
  training_data_ready: number;
}

interface JobRow {
  id: string;
  title: string;
  company_name: string;
  location_country: string;
  location_city: string;
  source: string;
  enrichment_status: string;
  created_at: string;
  posted_at: string;
  skills_count: number;
}

function ChartSkeleton({ height = "h-[300px]" }: { height?: string }) {
  return (
    <Card>
      <CardHeader><Skeleton className="h-4 w-40" /></CardHeader>
      <CardContent><Skeleton className={`w-full ${height}`} /></CardContent>
    </Card>
  );
}

function downloadCSV(data: JobRow[], filename: string) {
  const headers = ["Title", "Company", "Country", "City", "Source", "Status", "Skills", "Created", "Posted"];
  const rows = data.map((r) => [
    r.title, r.company_name, r.location_country, r.location_city,
    r.source, r.enrichment_status, r.skills_count,
    r.created_at ? new Date(r.created_at).toLocaleDateString() : "",
    r.posted_at ? new Date(r.posted_at).toLocaleDateString() : "",
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Analytics filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterSource, setFilterSource] = useState("all");
  const [filterCountry, setFilterCountry] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // Timeline toggle
  const [granularity, setGranularity] = useState<"day" | "week">("day");

  // Jobs table state
  const [tableSearch, setTableSearch] = useState("");
  const [tableSource, setTableSource] = useState("all");
  const [tableStatus, setTableStatus] = useState("all");
  const [tableCountry, setTableCountry] = useState("all");
  const [tablePage, setTablePage] = useState(1);
  const [tableSort, setTableSort] = useState("created_at");
  const [tableOrder, setTableOrder] = useState<"asc" | "desc">("desc");
  const tableLimit = 50;

  // Build shared global filter params
  const filterParams = new URLSearchParams();
  if (dateFrom) filterParams.set("date_from", dateFrom);
  if (dateTo) filterParams.set("date_to", dateTo);
  if (filterSource !== "all") filterParams.set("source", filterSource);
  if (filterCountry !== "all") filterParams.set("country", filterCountry);
  if (filterStatus !== "all") filterParams.set("status", filterStatus);
  const filterString = filterParams.toString();

  // ── Dashboard queries ──
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

  // ── Analytics queries ──
  const { data: overview, isLoading: overviewLoading } = useQuery<OverviewData>({
    queryKey: ["/api/analytics/overview", filterString],
    queryFn: async () => {
      const res = await authFetch(`/api/analytics/overview?${filterString}`);
      if (!res.ok) throw new Error("Failed to fetch overview");
      return res.json();
    },
  });

  const { data: bySource, isLoading: sourceLoading } = useQuery<{ source: string; count: number }[]>({
    queryKey: ["/api/analytics/jobs-by-source", filterString],
    queryFn: async () => {
      const res = await authFetch(`/api/analytics/jobs-by-source?${filterString}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: byRegion, isLoading: regionLoading } = useQuery<{ country: string; count: number }[]>({
    queryKey: ["/api/analytics/jobs-by-region", filterString],
    queryFn: async () => {
      const res = await authFetch(`/api/analytics/jobs-by-region?${filterString}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery<{ date: string; count: number }[]>({
    queryKey: ["/api/analytics/timeline", granularity, filterString],
    queryFn: async () => {
      const params = new URLSearchParams(filterParams);
      params.set("granularity", granularity);
      params.set("days", "60");
      const res = await authFetch(`/api/analytics/timeline?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: topSkills, isLoading: skillsLoading } = useQuery<{ skill_name: string; count: number }[]>({
    queryKey: ["/api/analytics/top-skills", filterString],
    queryFn: async () => {
      const params = new URLSearchParams(filterParams);
      params.set("limit", "20");
      const res = await authFetch(`/api/analytics/top-skills?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: funnel, isLoading: funnelLoading } = useQuery<{ status: string; count: number }[]>({
    queryKey: ["/api/analytics/enrichment-funnel", filterString],
    queryFn: async () => {
      const res = await authFetch(`/api/analytics/enrichment-funnel?${filterString}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: pipelineHealth, isLoading: pipelineLoading } = useQuery<any[]>({
    queryKey: ["/api/analytics/pipeline-health"],
    queryFn: async () => {
      const res = await authFetch("/api/analytics/pipeline-health");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  // Jobs table query
  const tableParams = new URLSearchParams();
  tableParams.set("page", String(tablePage));
  tableParams.set("limit", String(tableLimit));
  tableParams.set("sort", tableSort);
  tableParams.set("order", tableOrder);
  if (tableSearch) tableParams.set("search", tableSearch);
  if (tableSource !== "all") tableParams.set("source", tableSource);
  if (tableStatus !== "all") tableParams.set("status", tableStatus);
  if (tableCountry !== "all") tableParams.set("country", tableCountry);

  const { data: jobsTable, isLoading: tableLoading } = useQuery<{ data: JobRow[]; total: number }>({
    queryKey: ["/api/analytics/jobs-table", tableParams.toString()],
    queryFn: async () => {
      const res = await authFetch(`/api/analytics/jobs-table?${tableParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const totalPages = jobsTable ? Math.ceil(jobsTable.total / tableLimit) : 1;

  // Get unique countries from region data for filter
  const countries = byRegion?.map((r) => r.country) || [];
  const sources = bySource?.map((r) => r.source) || [];

  function handleSort(col: string) {
    if (tableSort === col) {
      setTableOrder(tableOrder === "asc" ? "desc" : "asc");
    } else {
      setTableSort(col);
      setTableOrder("desc");
    }
    setTablePage(1);
  }

  const sortIcon = (col: string) => {
    if (tableSort !== col) return null;
    return tableOrder === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      {/* 1. Title + subtitle */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your data intelligence platform</p>
      </div>

      {/* 2. KPI Cards — 4 main + 3 analytics */}
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

      {overviewLoading ? (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
          <KPICard title="JD Coverage" value={`${overview?.jd_coverage_pct ?? 0}%`} icon={FileText} subtitle="Jobs with descriptions" />
          <KPICard title="Skills Extracted" value={overview?.skills_extracted ?? 0} icon={Brain} subtitle="Unique skills found" />
          <KPICard title="Training Ready" value={overview?.training_data_ready ?? 0} icon={CheckCircle} subtitle="Enrichment complete" />
        </div>
      )}

      {/* 3. Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">From</label>
          <Input
            type="date"
            className="h-9 text-sm w-[150px]"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">To</label>
          <Input
            type="date"
            className="h-9 text-sm w-[150px]"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-[140px] h-9 text-xs">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCountry} onValueChange={setFilterCountry}>
          <SelectTrigger className="w-[140px] h-9 text-xs">
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Countries</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[170px] h-9 text-xs">
            <SelectValue placeholder="Enrichment Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Enrichment Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="enriched">Enriched</SelectItem>
            <SelectItem value="analyzed">Analyzed</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 4. Charts row 1: Jobs by Source + Jobs by Region */}
      <div className="grid gap-6 lg:grid-cols-2">
        {sourceLoading ? <ChartSkeleton /> : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Jobs by Source</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bySource || []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="source" className="text-xs" tickFormatter={(v) => v.replace(/_/g, " ")} />
                    <YAxis className="text-xs" />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v.toLocaleString(), "Jobs"]} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {(bySource || []).map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {regionLoading ? <ChartSkeleton /> : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Jobs by Region (Top 10)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byRegion || []} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" />
                    <YAxis type="category" dataKey="country" className="text-xs" width={100} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v.toLocaleString(), "Jobs"]} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 5. Timeline chart (area chart with day/week toggle) */}
      {timelineLoading ? <ChartSkeleton height="h-[250px]" /> : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Jobs Added Over Time</CardTitle>
              <div className="flex gap-1">
                <Button
                  variant={granularity === "day" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setGranularity("day")}
                >
                  Day
                </Button>
                <Button
                  variant={granularity === "week" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setGranularity("week")}
                >
                  Week
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline || []}>
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
                  <Area type="monotone" dataKey="count" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6. Charts row 2: Top 20 Skills + Enrichment Funnel */}
      <div className="grid gap-6 lg:grid-cols-2">
        {skillsLoading ? <ChartSkeleton /> : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Top 20 Skills</CardTitle>
            </CardHeader>
            <CardContent>
              {!topSkills?.length ? (
                <div className="h-[400px] flex items-center justify-center">
                  <div className="text-center space-y-2 max-w-[300px]">
                    <Brain className="h-10 w-10 mx-auto text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      No skills data yet. Run the JD Analysis pipeline to extract skills from job descriptions.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topSkills} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis type="category" dataKey="skill_name" className="text-xs" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v.toLocaleString(), "Jobs"]} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {funnelLoading ? <ChartSkeleton /> : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Enrichment Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={funnel || []}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={130}
                      paddingAngle={3}
                      label={({ status, count }) => `${status} (${count.toLocaleString()})`}
                    >
                      {(funnel || []).map((entry, i) => (
                        <Cell key={i} fill={FUNNEL_COLORS[entry.status] || COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v.toLocaleString(), "Jobs"]} />
                    <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ paddingLeft: 16, maxWidth: 150, overflow: "visible" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 7. Pipeline Health chart */}
      {pipelineLoading ? <ChartSkeleton /> : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Pipeline Health (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pipelineHealth || []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="pipeline_type" className="text-xs" tickFormatter={(v) => v.replace(/_/g, " ")} />
                  <YAxis className="text-xs" />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend />
                  <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="running" name="Running" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 8. Recent Activity: Pipeline Runs + Recent Jobs */}
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

      {/* 9. Jobs Data Table with search/filters/sort/pagination/CSV export */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Jobs Data</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => jobsTable?.data && downloadCSV(jobsTable.data, "jobs-analytics.csv")}
              disabled={!jobsTable?.data?.length}
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Table Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title or company..."
                className="pl-8 h-9 text-sm"
                value={tableSearch}
                onChange={(e) => { setTableSearch(e.target.value); setTablePage(1); }}
              />
            </div>
            <Select value={tableSource} onValueChange={(v) => { setTableSource(v); setTablePage(1); }}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tableStatus} onValueChange={(v) => { setTableStatus(v); setTablePage(1); }}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tableCountry} onValueChange={(v) => { setTableCountry(v); setTablePage(1); }}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Countries</SelectItem>
                {countries.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {[
                    { key: "title", label: "Title" },
                    { key: "company_name", label: "Company" },
                    { key: "location_country", label: "Location" },
                    { key: "source", label: "Source" },
                    { key: "enrichment_status", label: "Status" },
                    { key: "skills_count", label: "Skills" },
                    { key: "created_at", label: "Date" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}{sortIcon(col.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-3 py-2"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : !jobsTable?.data?.length ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      No jobs match your filters
                    </td>
                  </tr>
                ) : (
                  jobsTable.data.map((job) => (
                    <tr key={job.id} className="border-b hover:bg-muted/50">
                      <td className="px-3 py-2 max-w-[200px] truncate font-medium">{job.title || "—"}</td>
                      <td className="px-3 py-2 max-w-[150px] truncate">{job.company_name || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {job.location_city ? `${job.location_city}, ${job.location_country}` : job.location_country || "—"}
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={job.source} /></td>
                      <td className="px-3 py-2"><StatusBadge status={job.enrichment_status} /></td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[11px]">{job.skills_count}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {job.created_at ? new Date(job.created_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {((tablePage - 1) * tableLimit) + 1}–{Math.min(tablePage * tableLimit, jobsTable?.total ?? 0)} of {jobsTable?.total?.toLocaleString() ?? 0}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={tablePage <= 1}
                  onClick={() => setTablePage(tablePage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>Page {tablePage} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={tablePage >= totalPages}
                  onClick={() => setTablePage(tablePage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 10. Credit Usage */}
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

      {/* 11. Job detail Sheet */}
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
