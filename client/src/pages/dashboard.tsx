import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { KPICard } from "@/components/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Briefcase, Building2, Users, GitBranch, FileText, Brain, CheckCircle,
  Search, Download, ChevronLeft, ChevronRight, X, BarChart3, TrendingUp,
  Globe, Layers, Activity, Database,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
  LineChart, Line,
} from "recharts";
import { authFetch } from "@/lib/queryClient";
import type { DashboardStats, Job, PipelineRun, ProviderCredit } from "@shared/schema";

const CHART_COLORS = {
  primary: "#0ea5e9",
  secondary: "#8b5cf6",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  neutral: "#64748b",
  pink: "#ec4899",
  cyan: "#06b6d4",
};

const COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.secondary,
  CHART_COLORS.warning,
  CHART_COLORS.success,
  CHART_COLORS.danger,
  CHART_COLORS.pink,
  CHART_COLORS.cyan,
];

const FUNNEL_COLORS: Record<string, string> = {
  pending: CHART_COLORS.warning,
  partial: CHART_COLORS.secondary,
  complete: CHART_COLORS.success,
  failed: CHART_COLORS.danger,
  enriched: CHART_COLORS.primary,
  analyzed: CHART_COLORS.cyan,
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

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function ChartSkeleton({ height = "h-[300px]" }: { height?: string }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-60 mt-1" />
      </CardHeader>
      <CardContent><Skeleton className={`w-full ${height}`} /></CardContent>
    </Card>
  );
}

function EmptyChart({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="h-[300px] flex items-center justify-center">
      <div className="text-center space-y-2 max-w-[280px]">
        <Icon className="h-10 w-10 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

const chartTooltipStyle = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
};

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

  const hasActiveFilters = dateFrom || dateTo || filterSource !== "all" || filterCountry !== "all" || filterStatus !== "all";
  const activeFilterCount = [dateFrom, dateTo, filterSource !== "all", filterCountry !== "all", filterStatus !== "all"].filter(Boolean).length;

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setFilterSource("all");
    setFilterCountry("all");
    setFilterStatus("all");
  }

  // ── Dashboard queries ──
  const { data: stats, isError: statsError, refetch: refetchStats } = useQuery<DashboardStats>({
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
    return tableOrder === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your data intelligence platform</p>
      </div>

      {/* ═══ SECTION: Overview KPIs ═══ */}
      <SectionHeader icon={BarChart3} title="Overview" subtitle="Key performance indicators at a glance" />

      {statsError ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <p>Failed to load dashboard stats</p>
          <Button variant="outline" size="sm" onClick={() => refetchStats()} className="mt-2">Try Again</Button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
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
      )}

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

      {/* ═══ SECTION: Filters ═══ */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-6 px-6 py-3 border-b">
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
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={clearFilters}
            >
              <X className="h-3.5 w-3.5" />
              Clear Filters
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
            </Button>
          )}
        </div>
      </div>

      {/* ═══ SECTION: Trends & Distribution ═══ */}
      <SectionHeader icon={TrendingUp} title="Trends & Distribution" subtitle="Job volume over time and distribution by source" />

      {/* Timeline chart */}
      {timelineLoading ? <ChartSkeleton height="h-[300px]" /> : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium">Jobs Added Over Time</CardTitle>
                <CardDescription className="text-xs">Daily or weekly job ingestion volume over the last 60 days</CardDescription>
              </div>
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
            {!timeline?.length ? (
              <EmptyChart icon={TrendingUp} message="No timeline data available yet. Jobs will appear here as they are ingested." />
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      className="text-xs"
                      tickFormatter={(v) => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" })}
                    />
                    <YAxis className="text-xs" />
                    <Tooltip
                      labelFormatter={(v) => new Date(v).toLocaleDateString("en", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                      contentStyle={chartTooltipStyle}
                      formatter={(v: number) => [v.toLocaleString(), "Jobs Added"]}
                    />
                    <Area type="monotone" dataKey="count" stroke={CHART_COLORS.primary} fill={CHART_COLORS.primary} fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Jobs by Source */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {sourceLoading ? <ChartSkeleton /> : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Jobs by Source</CardTitle>
              <CardDescription className="text-xs">Distribution of jobs across data sources</CardDescription>
            </CardHeader>
            <CardContent>
              {!bySource?.length ? (
                <EmptyChart icon={BarChart3} message="No source data available. Jobs will be categorized as they are ingested." />
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={bySource}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="source" className="text-xs" tickFormatter={(v) => v.replace(/_/g, " ")} />
                      <YAxis className="text-xs" />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [v.toLocaleString(), "Jobs"]} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {(bySource || []).map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Enrichment Funnel (Pie) */}
        {funnelLoading ? <ChartSkeleton /> : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Enrichment Funnel</CardTitle>
              <CardDescription className="text-xs">Job enrichment status breakdown across the pipeline</CardDescription>
            </CardHeader>
            <CardContent>
              {!funnel?.length ? (
                <EmptyChart icon={Layers} message="No enrichment data yet. Run the enrichment pipeline to see status breakdown." />
              ) : (
                <div className="h-[300px] flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={funnel}
                        dataKey="count"
                        nameKey="status"
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={120}
                        paddingAngle={3}
                        label={({ status, count }) => `${status} (${count.toLocaleString()})`}
                      >
                        {(funnel || []).map((entry, i) => (
                          <Cell key={i} fill={FUNNEL_COLORS[entry.status] || COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [v.toLocaleString(), "Jobs"]} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ paddingLeft: 16, maxWidth: 150, overflow: "visible" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ═══ SECTION: Geographic & Skills ═══ */}
      <SectionHeader icon={Globe} title="Geographic & Skills" subtitle="Regional distribution and most in-demand skills" />

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {regionLoading ? <ChartSkeleton /> : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Jobs by Region (Top 10)</CardTitle>
              <CardDescription className="text-xs">Geographic distribution of job listings by country</CardDescription>
            </CardHeader>
            <CardContent>
              {!byRegion?.length ? (
                <EmptyChart icon={Globe} message="No geographic data available. Location data appears as jobs are ingested." />
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byRegion} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis type="category" dataKey="country" className="text-xs" width={100} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [v.toLocaleString(), "Jobs"]} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} fill={CHART_COLORS.secondary} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {skillsLoading ? <ChartSkeleton height="h-[300px]" /> : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Top 20 Skills</CardTitle>
              <CardDescription className="text-xs">Most frequently extracted skills from job descriptions</CardDescription>
            </CardHeader>
            <CardContent>
              {!topSkills?.length ? (
                <EmptyChart icon={Brain} message="No skills data yet. Run the JD Analysis pipeline to extract skills from job descriptions." />
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topSkills.slice(0, 15)} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis type="category" dataKey="skill_name" className="text-xs" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [v.toLocaleString(), "Jobs"]} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} fill={CHART_COLORS.success} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ═══ SECTION: Pipeline & Quality ═══ */}
      <SectionHeader icon={Layers} title="Pipeline & Quality" subtitle="Pipeline execution health and data quality metrics" />

      {pipelineLoading ? <ChartSkeleton /> : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Pipeline Health (Last 30 Days)</CardTitle>
            <CardDescription className="text-xs">Completed, failed, and running pipeline executions by type</CardDescription>
          </CardHeader>
          <CardContent>
            {!pipelineHealth?.length ? (
              <EmptyChart icon={Activity} message="No pipeline data yet. Pipeline health will appear after running your first pipeline." />
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pipelineHealth}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="pipeline_type" className="text-xs" tickFormatter={(v) => v.replace(/_/g, " ")} />
                    <YAxis className="text-xs" />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend />
                    <Bar dataKey="completed" name="Completed" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="failed" name="Failed" fill={CHART_COLORS.danger} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="running" name="Running" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ SECTION: Recent Activity ═══ */}
      <SectionHeader icon={Activity} title="Recent Activity" subtitle="Latest pipeline runs and recently added jobs" />

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium cursor-pointer hover:text-primary" onClick={() => navigate("/pipelines")}>Recent Pipeline Runs</CardTitle>
            <CardDescription className="text-xs">Latest pipeline executions and their status</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { header: "Type", accessor: (r: PipelineRun) => r.pipeline_type?.replace(/_/g, " ") ?? "\u2014" },
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
                      : "\u2014",
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
            <CardDescription className="text-xs">Most recently added job listings</CardDescription>
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
                      : "\u2014",
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

      {/* ═══ SECTION: Jobs Data ═══ */}
      <SectionHeader icon={Database} title="Jobs Data" subtitle="Browse, search, and export all job records" />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium">All Jobs</CardTitle>
              <CardDescription className="text-xs">
                {jobsTable?.total ? `${jobsTable.total.toLocaleString()} total records` : "Search and filter job listings"}
              </CardDescription>
            </div>
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
                      <td className="px-3 py-2 max-w-[200px] truncate font-medium">{job.title || "\u2014"}</td>
                      <td className="px-3 py-2 max-w-[150px] truncate">{job.company_name || "\u2014"}</td>
                      <td className="px-3 py-2 text-xs">
                        {job.location_city ? `${job.location_city}, ${job.location_country}` : job.location_country || "\u2014"}
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={job.source} /></td>
                      <td className="px-3 py-2"><StatusBadge status={job.enrichment_status} /></td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[11px]">{job.skills_count}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {job.created_at ? new Date(job.created_at).toLocaleDateString() : "\u2014"}
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
                Showing {((tablePage - 1) * tableLimit) + 1}\u2013{Math.min(tablePage * tableLimit, jobsTable?.total ?? 0)} of {jobsTable?.total?.toLocaleString() ?? 0}
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

      {/* Credit Usage */}
      {credits && credits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Credit Usage by Provider</CardTitle>
            <CardDescription className="text-xs">API credit consumption across AI providers</CardDescription>
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

      {/* Job detail Sheet */}
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
