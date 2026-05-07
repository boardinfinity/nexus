import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { KPICard } from "@/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, CheckCircle2, AlertTriangle, XCircle, Clock, Sparkles,
  RefreshCw, ChevronLeft, ChevronRight, ExternalLink, Play, Inbox,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────
interface AnalyzeJdRun {
  id: string;
  source: "manual_single" | "async_batch" | "bulk_upload" | "campus_upload";
  job_id: string | null;
  batch_id: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "partial";
  input_chars: number | null;
  model: string | null;
  prompt_version: string | null;
  latency_ms: number | null;
  skills_extracted: number | null;
  skills_new: number | null;
  bucket_match: string | null;
  bucket_confidence: number | null;
  was_partial: boolean;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  finished_at: string | null;
}

interface RunsResponse {
  data: AnalyzeJdRun[];
  total: number;
  page: number;
  limit: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────
const SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "manual_single", label: "Manual single" },
  { value: "async_batch", label: "Async batch" },
  { value: "bulk_upload", label: "Bulk upload" },
  { value: "campus_upload", label: "Campus upload" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "partial", label: "Partial" },
  { value: "failed", label: "Failed" },
];

const DATE_PRESETS = [
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

const PAGE_SIZE = 50;

// ─── Helpers ────────────────────────────────────────────────────────────────
function statusBadge(status: AnalyzeJdRun["status"]) {
  const styles: Record<string, string> = {
    succeeded: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    queued: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };
  return (
    <Badge variant="outline" className={`${styles[status] || styles.queued} border-0 font-medium text-[11px]`}>
      {status}
    </Badge>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function truncate(s: string | null, n = 60) {
  if (!s) return "—";
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function dateFromForPreset(preset: string): string | undefined {
  const now = Date.now();
  if (preset === "24h") return new Date(now - 24 * 3600 * 1000).toISOString();
  if (preset === "7d") return new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  if (preset === "30d") return new Date(now - 30 * 24 * 3600 * 1000).toISOString();
  return undefined;
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function JdAnalyzerRunsPage() {
  // TODO(jdenh001): when SPOCs need access, scope to college's uploaded jobs via
  // an `assertSurveyInScope` analog (see surveys 3-layer pattern). v1 = admin-only.
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [datePreset, setDatePreset] = useState("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedRun, setSelectedRun] = useState<AnalyzeJdRun | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [source, status, datePreset, customFrom, customTo]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (source !== "all") params.set("source", source);
    if (status !== "all") params.set("status", status);
    if (datePreset === "custom") {
      if (customFrom) params.set("date_from", new Date(customFrom).toISOString());
      if (customTo) params.set("date_to", new Date(customTo).toISOString());
    } else {
      const from = dateFromForPreset(datePreset);
      if (from) params.set("date_from", from);
    }
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(page));
    return params.toString();
  }, [source, status, datePreset, customFrom, customTo, page]);

  const { data, isLoading, error, refetch, isFetching } = useQuery<RunsResponse>({
    queryKey: ["/api/analyze-jd/runs", queryString],
    queryFn: async () => {
      const r = await authFetch(`/api/analyze-jd/runs?${queryString}`);
      if (!r.ok) throw new Error(`Failed to load runs (${r.status})`);
      return r.json();
    },
    refetchInterval: autoRefresh ? 10000 : false,
    staleTime: autoRefresh ? 0 : 5000,
  });

  // KPI data — separate query for last 7d aggregate (independent of filters)
  const { data: kpi7d } = useQuery<RunsResponse>({
    queryKey: ["/api/analyze-jd/runs", "kpi-7d"],
    queryFn: async () => {
      const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const r = await authFetch(`/api/analyze-jd/runs?date_from=${from}&limit=200&page=1`);
      if (!r.ok) throw new Error("kpi failed");
      return r.json();
    },
    refetchInterval: autoRefresh ? 10000 : false,
    staleTime: 30000,
  });

  const { data: kpiAll } = useQuery<RunsResponse>({
    queryKey: ["/api/analyze-jd/runs", "kpi-all"],
    queryFn: async () => {
      const r = await authFetch(`/api/analyze-jd/runs?limit=1&page=1`);
      if (!r.ok) throw new Error("kpi all failed");
      return r.json();
    },
    refetchInterval: autoRefresh ? 10000 : false,
    staleTime: 30000,
  });

  // ─── KPI calcs (from last 7d sample) ─────────────────────────────────────
  const kpiStats = useMemo(() => {
    const rows = kpi7d?.data || [];
    const total7d = rows.length;
    const succeeded = rows.filter(r => r.status === "succeeded").length;
    const partial = rows.filter(r => r.status === "partial").length;
    const failed = rows.filter(r => r.status === "failed").length;
    const finished = succeeded + partial + failed;
    const successRate = finished ? Math.round((succeeded / finished) * 100) : 0;
    const partialRate = finished ? Math.round((partial / finished) * 100) : 0;
    const failureRate = finished ? Math.round((failed / finished) * 100) : 0;
    const latencies = rows.map(r => r.latency_ms).filter((n): n is number => typeof n === "number" && n > 0);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const skillsSum = rows.reduce((s, r) => s + (r.skills_extracted || 0), 0);
    const newSkillsSum = rows.reduce((s, r) => s + (r.skills_new || 0), 0);
    return { total7d, successRate, partialRate, failureRate, avgLatency, skillsSum, newSkillsSum };
  }, [kpi7d]);

  const totalAllTime = kpiAll?.total ?? 0;
  const totalPages = data ? Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE)) : 1;

  // ─── Re-run action ───────────────────────────────────────────────────────
  async function handleRerun(run: AnalyzeJdRun) {
    if (!run.job_id) {
      toast({ title: "Cannot re-run", description: "This run has no associated job_id.", variant: "destructive" });
      return;
    }
    setRerunning(run.id);
    try {
      const r = await authFetch("/api/analyze-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: run.job_id }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `Re-run failed (${r.status})`);
      }
      toast({ title: "Re-run queued", description: `Job ${run.job_id.slice(0, 8)}… re-analyzed.` });
      qc.invalidateQueries({ queryKey: ["/api/analyze-jd/runs"] });
    } catch (e: any) {
      toast({ title: "Re-run failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setRerunning(null);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        Please sign in to view analyzer runs.
      </div>
    );
  }

  const rows = data?.data || [];
  const showEmptyMigration = !isLoading && !error && (kpiAll?.total ?? 0) === 0 && rows.length === 0;
  const showEmptyFilters = !isLoading && !error && rows.length === 0 && (kpiAll?.total ?? 0) > 0;

  return (
    <div className="space-y-6" data-testid="page-jd-analyzer-runs">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Analyzer Runs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Call-level logs for the unified Analyze JD pipeline — manual, batch, and bulk uploads.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              data-testid="switch-auto-refresh"
            />
            <Label htmlFor="auto-refresh" className="text-sm cursor-pointer">
              Auto-refresh (10s)
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <KPICard
          title="Total runs"
          value={totalAllTime.toLocaleString()}
          subtitle={`${kpiStats.total7d} in last 7d`}
          icon={Activity}
        />
        <KPICard
          title="Success rate"
          value={`${kpiStats.successRate}%`}
          subtitle="last 7 days"
          icon={CheckCircle2}
        />
        <KPICard
          title="Partial rate"
          value={`${kpiStats.partialRate}%`}
          subtitle="last 7 days"
          icon={AlertTriangle}
        />
        <KPICard
          title="Failure rate"
          value={`${kpiStats.failureRate}%`}
          subtitle="last 7 days"
          icon={XCircle}
        />
        <KPICard
          title="Avg latency"
          value={kpiStats.avgLatency ? `${kpiStats.avgLatency} ms` : "—"}
          subtitle="last 7 days"
          icon={Clock}
        />
        <KPICard
          title="Skills extracted"
          value={kpiStats.skillsSum.toLocaleString()}
          subtitle="last 7 days"
          icon={Sparkles}
        />
        <KPICard
          title="New skills"
          value={kpiStats.newSkillsSum.toLocaleString()}
          subtitle="created last 7d"
          icon={Sparkles}
        />
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="w-[170px]" data-testid="select-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[160px]" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date range</Label>
              <Select value={datePreset} onValueChange={setDatePreset}>
                <SelectTrigger className="w-[160px]" data-testid="select-date-preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {datePreset === "custom" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-[200px]"
                    data-testid="input-date-from"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="datetime-local"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="w-[200px]"
                    data-testid="input-date-to"
                  />
                </div>
              </>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              {data ? `${data.total} runs match` : ""}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-red-600">
              Failed to load runs. {(error as Error).message}
            </div>
          ) : showEmptyMigration ? (
            <div className="p-12 text-center space-y-3">
              <Inbox className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                No runs logged yet — migration{" "}
                <code className="px-1 py-0.5 bg-muted rounded text-xs">038_analyze_jd_runs_and_l2_to_l1</code>{" "}
                may need to be applied to enable run logging.
              </p>
              <a
                href="https://github.com/boardinfinity/nexus/blob/main/docs/MIGRATIONS.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                View migration docs <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : showEmptyFilters ? (
            <div className="p-12 text-center space-y-2">
              <Inbox className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No runs match these filters. Try widening the date range or clearing source/status.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSource("all"); setStatus("all"); setDatePreset("30d"); }}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Created</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Job</TableHead>
                    <TableHead className="text-xs">Model</TableHead>
                    <TableHead className="text-xs">Prompt v.</TableHead>
                    <TableHead className="text-xs text-right">Latency</TableHead>
                    <TableHead className="text-xs text-right">Skills</TableHead>
                    <TableHead className="text-xs text-right">New</TableHead>
                    <TableHead className="text-xs">Bucket</TableHead>
                    <TableHead className="text-xs text-right">Conf.</TableHead>
                    <TableHead className="text-xs">Partial</TableHead>
                    <TableHead className="text-xs">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelectedRun(r)}
                      data-testid={`row-run-${r.id}`}
                    >
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(r.created_at)}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {r.source.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-xs">
                        {r.job_id ? (
                          <Link
                            href={`/jobs?id=${r.job_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline font-mono"
                          >
                            {r.job_id.slice(0, 8)}…
                          </Link>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.model || "—"}</TableCell>
                      <TableCell className="text-xs">{r.prompt_version || "—"}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {r.latency_ms ? `${r.latency_ms} ms` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {r.skills_extracted ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {r.skills_new ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{truncate(r.bucket_match, 24)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {r.bucket_confidence != null ? r.bucket_confidence.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.was_partial ? (
                          <Badge variant="outline" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-[10px]">
                            partial
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[240px]">
                        {truncate(r.error_message, 60)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">
            Page {page} of {totalPages} — showing {rows.length} of {data.total}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              data-testid="button-prev"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              data-testid="button-next"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail panel */}
      <Sheet open={!!selectedRun} onOpenChange={(o) => !o && setSelectedRun(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedRun && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  Run details {statusBadge(selectedRun.status)}
                </SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  {selectedRun.id}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5 text-sm">
                <DetailRow label="Source" value={selectedRun.source} />
                <DetailRow label="Created" value={new Date(selectedRun.created_at).toLocaleString()} />
                {selectedRun.finished_at && (
                  <DetailRow label="Finished" value={new Date(selectedRun.finished_at).toLocaleString()} />
                )}
                <DetailRow label="Model" value={selectedRun.model || "—"} />
                <DetailRow label="Prompt version" value={selectedRun.prompt_version || "—"} />
                <DetailRow label="Latency" value={selectedRun.latency_ms ? `${selectedRun.latency_ms} ms` : "—"} />
                <DetailRow label="Input chars" value={selectedRun.input_chars?.toLocaleString() || "—"} />
                <DetailRow label="Skills extracted" value={String(selectedRun.skills_extracted ?? "—")} />
                <DetailRow label="New skills created" value={String(selectedRun.skills_new ?? "—")} />
                <DetailRow label="Bucket match" value={selectedRun.bucket_match || "—"} />
                <DetailRow
                  label="Bucket confidence"
                  value={selectedRun.bucket_confidence != null ? selectedRun.bucket_confidence.toFixed(4) : "—"}
                />
                <DetailRow label="Was partial" value={selectedRun.was_partial ? "Yes" : "No"} />

                {selectedRun.error_message && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Error message</Label>
                    <pre className="mt-1 text-xs whitespace-pre-wrap bg-muted/50 rounded p-3 max-h-60 overflow-auto">
                      {selectedRun.error_message}
                    </pre>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-3 border-t">
                  {selectedRun.job_id && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/jobs?id=${selectedRun.job_id}`}>
                        <ExternalLink className="h-4 w-4 mr-2" /> View job
                      </Link>
                    </Button>
                  )}
                  {selectedRun.batch_id && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/monitoring?batch=${selectedRun.batch_id}`}>
                        <ExternalLink className="h-4 w-4 mr-2" /> View batch
                      </Link>
                    </Button>
                  )}
                  {selectedRun.job_id && (
                    <Button
                      size="sm"
                      onClick={() => handleRerun(selectedRun)}
                      disabled={rerunning === selectedRun.id}
                      data-testid="button-rerun"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {rerunning === selectedRun.id ? "Re-running…" : "Re-run"}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 pb-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right break-all">{value}</span>
    </div>
  );
}
