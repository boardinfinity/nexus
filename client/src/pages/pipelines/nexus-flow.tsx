import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Zap, RefreshCw, Loader2, Play, ChevronRight,
  Database, Brain, CheckCircle2, BarChart3,
  ArrowUpRight, Layers, Hash, Globe2, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/queryClient";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RecentRun {
  id: string;
  started_at: string;
  processed_items: number;
  status: string;
}

interface ActiveBatch {
  run_id: string;
  batch_id: string | null;
  started_at: string;
  processed: number;
}

interface QueueStatus {
  // source counts
  source_linkedin: number;
  source_clay_linkedin: number;
  source_naukrigulf: number;
  source_google_jobs: number;
  source_bayt: number;
  total_jobs: number;

  // enrichment
  with_description: number;
  no_description: number;
  enriched_pct: number;

  // fetch queue
  fetch_pending: number;
  fetch_failed: number;
  fetch_no_jd_found: number;
  fetch_by_source: Record<string, number>;

  // analysis queue
  analysis_queue: number;
  v2_complete: number;
  fetch_queue: number;

  // intelligence
  bucket_count: number;
  bucket_candidates: number;
  discovered_pending: number;
  avg_analysis_ms: number | null;
  trend_7d_delta: number | null;

  // batch
  active_batch: ActiveBatch | null;

  // cron history
  recent_runs: RecentRun[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}>
      {label}
    </span>
  );
}

function StatCard({
  label, value, sub, accent = false,
}: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg p-3 space-y-0.5 ${accent ? "bg-primary/10 border border-primary/20" : "bg-muted/40 border border-border/50"}`}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
      <p className={`text-xl font-bold tabular-nums leading-none ${accent ? "text-primary" : ""}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-6 w-full rounded bg-muted/50 overflow-hidden flex items-end">
      <div className={`w-full ${color} rounded transition-all duration-500`} style={{ height: `${Math.max(8, pct)}%` }} />
    </div>
  );
}

// ─── Stage Cards ─────────────────────────────────────────────────────────────

function StageHeader({ num, label, sub, icon: Icon, badgeColor = "bg-primary/20 text-primary" }:
  { num: string; label: string; sub: string; icon: any; badgeColor?: string }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <p className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase mb-1 ${badgeColor}`}>
          {num}
        </p>
        <h2 className="text-lg font-bold leading-tight">{label}</h2>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <Icon className="h-6 w-6 text-muted-foreground/50 mt-1 shrink-0" />
    </div>
  );
}

function Stage1Sources({ data }: { data: QueueStatus }) {
  const sources = [
    { name: "LinkedIn", count: data.source_linkedin, color: "bg-blue-500" },
    { name: "Clay LinkedIn", count: data.source_clay_linkedin, color: "bg-purple-500" },
    { name: "NaukriGulf", count: data.source_naukrigulf, color: "bg-orange-400" },
    { name: "Google Jobs", count: data.source_google_jobs, color: "bg-yellow-400" },
    { name: "Bayt.com", count: data.source_bayt, color: "bg-red-400" },
  ];
  const maxCount = Math.max(...sources.map(x => x.count), 1);
  return (
    <div className="flex flex-col h-full">
      <StageHeader num="Stage 1" label="Sources" sub="Active job board integrations" icon={Globe2} badgeColor="bg-blue-500/20 text-blue-400" />
      <div className="space-y-2 flex-1">
        {sources.map(src => (
          <div key={src.name} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full shrink-0 ${src.color}`} />
            <span className="text-xs text-muted-foreground w-28 shrink-0">{src.name}</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${src.color} opacity-80 transition-all duration-700`}
                style={{ width: `${Math.max(4, Math.round((src.count / maxCount) * 100))}%` }} />
            </div>
            <span className="text-xs font-medium tabular-nums w-16 text-right">{fmt(src.count)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-border/50">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
        <p className="text-2xl font-bold tabular-nums">{fmt(data.total_jobs)} <span className="text-sm font-normal text-muted-foreground">jobs</span></p>
      </div>
    </div>
  );
}

function Stage2Repository({ data }: { data: QueueStatus }) {
  const pct = data.enriched_pct;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col h-full">
      <StageHeader num="Stage 2" label="Job Repository" sub="Central data store · all sources" icon={Database} badgeColor="bg-emerald-500/20 text-emerald-400" />
      <div className="flex items-center gap-6 flex-1">
        <div className="relative shrink-0">
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
            <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth="10"
              strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
              transform="rotate(-90 50 50)" className="transition-all duration-700" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold">{pct}%</span>
            <span className="text-[9px] text-muted-foreground">enriched</span>
          </div>
        </div>
        <div className="space-y-2 flex-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Jobs</div>
          <div className="text-3xl font-bold tabular-nums">{fmt(data.total_jobs)}</div>
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between rounded bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5">
              <span className="text-xs text-emerald-400">With Description</span>
              <span className="text-sm font-bold text-emerald-400">{fmt(data.with_description)}</span>
            </div>
            <div className="flex items-center justify-between rounded bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
              <span className="text-xs text-amber-400">No Description</span>
              <span className="text-sm font-bold text-amber-400">{fmt(data.no_description)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stage3AFetch({ data, onTriggerFetch, fetchLoading }: { data: QueueStatus; onTriggerFetch: () => void; fetchLoading: boolean }) {
  const bySource = data.fetch_by_source ?? {};
  const sourceOrder = ["linkedin", "clay_linkedin", "naukrigulf", "google_jobs", "bayt"];
  const sourceLabel: Record<string, string> = {
    linkedin: "LinkedIn", clay_linkedin: "Clay", naukrigulf: "NaukriGulf",
    google_jobs: "Google", bayt: "Bayt",
  };
  const total = data.fetch_pending + data.fetch_failed;
  return (
    <div className="flex flex-col h-full">
      <StageHeader num="Stage 3A" label="JD Fetch" sub="AI-powered description retrieval" icon={ArrowUpRight} badgeColor="bg-amber-500/20 text-amber-400" />
      <div className="space-y-3 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums text-amber-400">{fmt(data.fetch_pending)}</span>
          <span className="text-sm text-muted-foreground">pending</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <div className="rounded bg-muted/40 px-2 py-1.5 text-center">
            <div className="text-muted-foreground text-[10px]">Pending</div>
            <div className="font-bold">{fmt(data.fetch_pending)}</div>
          </div>
          <div className="rounded bg-red-500/10 px-2 py-1.5 text-center">
            <div className="text-muted-foreground text-[10px]">Failed</div>
            <div className="font-bold text-red-400">{fmt(data.fetch_failed)}</div>
          </div>
          <div className="rounded bg-slate-500/10 px-2 py-1.5 text-center">
            <div className="text-muted-foreground text-[10px]">No JD</div>
            <div className="font-bold text-slate-400">{fmt(data.fetch_no_jd_found)}</div>
          </div>
        </div>
        {total > 0 && (
          <div className="space-y-1">
            {sourceOrder.filter(k => (bySource[k] ?? 0) > 0).map(k => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-16 shrink-0">{sourceLabel[k]}</span>
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400/70 transition-all duration-700"
                    style={{ width: `${Math.round((bySource[k] / total) * 100)}%` }} />
                </div>
                <span className="tabular-nums w-12 text-right">{fmt(bySource[k])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-medium text-amber-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          Google+GPT · 8 jobs/tick · 5 min
        </span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onTriggerFetch} disabled={fetchLoading}>
          {fetchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run now
        </Button>
      </div>
    </div>
  );
}

function Stage3BAnalysis({ data, onSubmitBatch, batchLoading }: { data: QueueStatus; onSubmitBatch: () => void; batchLoading: boolean }) {
  const total = data.analysis_queue + data.v2_complete;
  const pct = total > 0 ? Math.round((data.v2_complete / total) * 100) : 0;
  const runs = data.recent_runs ?? [];
  const maxItems = Math.max(...runs.map(r => r.processed_items ?? 0), 1);
  return (
    <div className="flex flex-col h-full">
      <StageHeader num="Stage 3B" label="JD Analysis" sub="GPT-4.1-mini classification" icon={Brain} badgeColor="bg-violet-500/20 text-violet-400" />
      <div className="space-y-3 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums text-violet-400">{fmt(data.analysis_queue)}</span>
          <span className="text-sm text-muted-foreground">in queue</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Pill label="gpt-4.1-mini" color="bg-violet-500/20 text-violet-300" />
          <Pill label="Cron · 40 jobs/tick · 5 min" color="bg-muted text-muted-foreground" />
          {data.active_batch && (
            <Pill label="Batch active" color="bg-green-500/20 text-green-400" />
          )}
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{fmt(data.v2_complete)} v2-complete</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-violet-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {runs.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Recent batches</p>
            <div className="flex items-end gap-1 h-10">
              {runs.slice(0, 6).reverse().map((r, i) => (
                <div key={r.id ?? i} className="flex-1 flex flex-col items-center gap-0.5">
                  <MiniBar value={r.processed_items ?? 0} max={maxItems}
                    color={r.status === "succeeded" ? "bg-violet-500" : "bg-red-500"} />
                </div>
              ))}
            </div>
          </div>
        )}
        {data.active_batch && (
          <p className="text-[10px] text-muted-foreground">
            Batch: <code className="font-mono">{(data.active_batch.batch_id ?? data.active_batch.run_id).slice(0, 16)}…</code> — {fmt(data.active_batch.processed)} ingested
          </p>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs gap-1" onClick={onSubmitBatch}
          disabled={batchLoading || !!data.active_batch}>
          {batchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Submit Batch
        </Button>
        <span className="text-[10px] text-muted-foreground">50% cheaper · 2-4h turnaround</span>
      </div>
    </div>
  );
}

function Stage4Intelligence({ data }: { data: QueueStatus }) {
  const tags = ["Bucket", "Skills", "Seniority", "Industry"];
  return (
    <div className="flex flex-col h-full">
      <StageHeader num="Stage 4" label="Intelligence Ready" sub="v2.2 analyzed" icon={CheckCircle2} badgeColor="bg-green-500/20 text-green-400" />
      <div className="space-y-3 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums text-green-400">{fmt(data.v2_complete)}</span>
          <span className="text-sm text-muted-foreground">jobs enriched</span>
        </div>
        {data.trend_7d_delta != null && (
          <div className="flex items-center gap-1 text-xs text-green-400">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>+{fmt(data.trend_7d_delta)} in last 7 days</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {tags.map(t => (
            <span key={t} className="rounded-md bg-green-500/10 border border-green-500/20 px-2 py-0.5 text-[10px] font-medium text-green-400">{t}</span>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <div className="flex items-center justify-between rounded bg-muted/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Jobs Bucketed</span>
            </div>
            <span className="font-bold">{fmt(data.bucket_count)}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-muted/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Bucket Candidates</span>
            </div>
            <span className="font-bold">{fmt(data.bucket_candidates)}</span>
          </div>
          <div className="flex items-center justify-between rounded bg-muted/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Discovered Titles</span>
            </div>
            <Link href="/discovered-titles">
              <a className="flex items-center gap-0.5 font-bold hover:text-primary transition-colors">
                {fmt(data.discovered_pending)} <ChevronRight className="h-3 w-3" />
              </a>
            </Link>
          </div>
        </div>
        {data.avg_analysis_ms != null && (
          <div className="rounded bg-muted/40 px-3 py-2 text-xs flex justify-between">
            <span className="text-muted-foreground">Avg analysis time</span>
            <span className="font-bold">{(data.avg_analysis_ms / 1000).toFixed(1)}s / job</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CronStrip({ runs }: { runs: RecentRun[] }) {
  if (!runs.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pipeline Activity</p>
          <p className="text-sm font-semibold">Last {runs.length} cron runs</p>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] text-green-400 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          All systems operational
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {runs.slice(0, 6).map((r, i) => (
          <div key={r.id ?? i}
            className={`rounded-md border px-3 py-2 text-xs space-y-0.5 ${r.status === "succeeded" ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"}`}>
            <div className={`flex items-center gap-1 font-semibold ${r.status === "succeeded" ? "text-green-400" : "text-red-400"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${r.status === "succeeded" ? "bg-green-400" : "bg-red-400"}`} />
              {fmt(r.processed_items ?? 0)} jobs
            </div>
            <div className="text-muted-foreground text-[10px]">{timeAgo(r.started_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NexusFlow() {
  const { toast } = useToast();
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await authFetch("/api/pipelines/jd/queue-status");
      if (res.ok) {
        setStatus(await res.json());
        setLastRefresh(new Date());
      }
    } catch {
      // silent
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Auto-refresh every 60s; 30s when batch active
  useEffect(() => {
    const interval = status?.active_batch ? 30000 : 60000;
    const id = setInterval(() => fetchStatus(true), interval);
    return () => clearInterval(id);
  }, [status?.active_batch, fetchStatus]);

  const triggerFetch = async () => {
    setFetchLoading(true);
    try {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST",
        body: JSON.stringify({ pipeline_type: "jd_fetch", config: { batch_size: 8 } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to trigger JD fetch");
      toast({ title: "JD Fetch triggered", description: "Processing up to 8 jobs." });
      setTimeout(() => fetchStatus(true), 5000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setFetchLoading(false);
    }
  };

  const submitBatch = async () => {
    setBatchLoading(true);
    try {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST",
        body: JSON.stringify({ pipeline_type: "jd_batch_submit", config: {} }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit batch");
      toast({ title: "Batch submitted", description: "OpenAI Batch API job started. Results in 2-4 hours." });
      setTimeout(() => fetchStatus(true), 5000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBatchLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/pipelines"><a className="text-xs text-muted-foreground hover:text-foreground">← Pipelines</a></Link>
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">Nexus Flow</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Live Intelligence Pipeline · end-to-end view</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[10px] text-muted-foreground">
              Updated {timeAgo(lastRefresh.toISOString())}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => fetchStatus()} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Loading skeleton */}
      {!status && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-xl border bg-card p-5 h-64 animate-pulse bg-muted/20" />
          ))}
        </div>
      )}

      {/* 4-stage grid */}
      {status && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Stage 1 */}
            <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
              <Stage1Sources data={status} />
            </div>
            {/* Stage 2 */}
            <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
              <Stage2Repository data={status} />
            </div>
            {/* Stage 3A */}
            <div className="rounded-xl border border-amber-500/20 bg-card p-5 shadow-sm">
              <Stage3AFetch data={status} onTriggerFetch={triggerFetch} fetchLoading={fetchLoading} />
            </div>
            {/* Stage 3B */}
            <div className="rounded-xl border border-violet-500/20 bg-card p-5 shadow-sm">
              <Stage3BAnalysis data={status} onSubmitBatch={submitBatch} batchLoading={batchLoading} />
            </div>
          </div>

          {/* Stage 4 — full width on mobile, spans 4 on xl but grouped differently */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            <div className="xl:col-span-1 rounded-xl border border-green-500/20 bg-card p-5 shadow-sm">
              <Stage4Intelligence data={status} />
            </div>
            {/* Quick-action stat cards */}
            <div className="xl:col-span-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 content-start">
              <StatCard label="Total Jobs" value={fmt(data.total_jobs)} sub="all sources" />
              <StatCard label="With JD" value={fmt(data.with_description)} sub={`${statudata.enriched_pct}% enriched`} accent />
              <StatCard label="Fetch Queue" value={fmt(data.fetch_pending + data.fetch_failed)} sub="pending + failed" />
              <StatCard label="Analysis Queue" value={fmt(data.analysis_queue)} sub="awaiting GPT" />
              <StatCard label="v2 Complete" value={fmt(data.v2_complete)} sub="fully enriched" accent />
              <StatCard label="Bucketed" value={fmt(data.bucket_count)} sub="assigned to bucket" />
              <StatCard label="Bucket Types" value={fmt(data.bucket_candidates)} sub="candidate buckets" />
              <StatCard label="Discovered Titles" value={fmt(data.discovered_pending)} sub="awaiting review" />
            </div>
          </div>

          {/* Cron activity strip */}
          <CronStrip runs={statudata.recent_runs ?? []} />
        </>
      )}
    </div>
  );
}
