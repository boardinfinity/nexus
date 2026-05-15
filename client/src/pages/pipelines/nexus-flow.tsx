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
  source_linkedin: number;
  source_clay_linkedin: number;
  source_naukrigulf: number;
  source_google_jobs: number;
  source_bayt: number;
  total_jobs: number;
  with_description: number;
  no_description: number;
  enriched_pct: number;
  fetch_pending: number;
  fetch_failed: number;
  fetch_no_jd_found: number;
  fetch_by_source: Record<string, number>;
  analysis_queue: number;
  v2_complete: number;
  fetch_queue: number;
  bucket_count: number;
  bucket_candidates: number;
  discovered_pending: number;
  avg_analysis_ms: number | null;
  trend_7d_delta: number | null;
  active_batch: ActiveBatch | null;
  recent_runs: RecentRun[];
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

export default function NexusFlow() {
  const { toast } = useToast();
  const [qs, setQs] = useState<QueueStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await authFetch("/api/pipelines/jd/queue-status");
      if (res.ok) {
        setQs(await res.json());
        setLastRefresh(new Date());
      }
    } catch {
      // silent
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  useEffect(() => {
    const interval = qs?.active_batch ? 30000 : 60000;
    const id = setInterval(() => loadStatus(true), interval);
    return () => clearInterval(id);
  }, [qs?.active_batch, loadStatus]);

  const triggerFetch = async () => {
    setFetchLoading(true);
    try {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST",
        body: JSON.stringify({ pipeline_type: "jd_fetch", config: { batch_size: 8 } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast({ title: "JD Fetch triggered", description: "Processing up to 8 jobs." });
      setTimeout(() => loadStatus(true), 5000);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast({ title: "Batch submitted", description: "OpenAI Batch API job started. Results in 2-4 hours." });
      setTimeout(() => loadStatus(true), 5000);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setBatchLoading(false);
    }
  };

  // ── derived values (only computed when qs is available) ──
  const totalJobs = qs?.total_jobs ?? 0;
  const withDesc = qs?.with_description ?? 0;
  const enrichedPct = qs?.enriched_pct ?? 0;
  const circR = 40;
  const circC = 2 * Math.PI * circR;
  const circDash = (enrichedPct / 100) * circC;

  const sources = qs ? [
    { name: "LinkedIn",      count: qs.source_linkedin,      color: "bg-blue-500" },
    { name: "Clay LinkedIn", count: qs.source_clay_linkedin, color: "bg-purple-500" },
    { name: "NaukriGulf",    count: qs.source_naukrigulf,    color: "bg-orange-400" },
    { name: "Google Jobs",   count: qs.source_google_jobs,   color: "bg-yellow-400" },
    { name: "Bayt.com",      count: qs.source_bayt,          color: "bg-red-400" },
  ] : [];
  const maxSrc = sources.length ? Math.max(...sources.map((x) => x.count), 1) : 1;

  const fetchBySource = qs?.fetch_by_source ?? {};
  const fetchSrcOrder = ["linkedin", "clay_linkedin", "naukrigulf", "google_jobs", "bayt"];
  const fetchSrcLabel: Record<string, string> = {
    linkedin: "LinkedIn", clay_linkedin: "Clay", naukrigulf: "NaukriGulf",
    google_jobs: "Google", bayt: "Bayt",
  };
  const fetchTotal = (qs?.fetch_pending ?? 0) + (qs?.fetch_failed ?? 0);

  const analysisPct = qs
    ? (qs.analysis_queue + qs.v2_complete > 0
        ? Math.round((qs.v2_complete / (qs.analysis_queue + qs.v2_complete)) * 100)
        : 0)
    : 0;
  const recentRuns = qs?.recent_runs ?? [];
  const maxRunItems = recentRuns.length ? Math.max(...recentRuns.map((r) => r.processed_items ?? 0), 1) : 1;

  const intTags = ["Bucket", "Skills", "Seniority", "Industry"];

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
            <span className="text-[10px] text-muted-foreground">Updated {timeAgo(lastRefresh.toISOString())}</span>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => loadStatus()} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Skeleton */}
      {!qs && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1,2,3,4].map((i) => (
            <div key={i} className="rounded-xl border bg-card p-5 h-64 animate-pulse bg-muted/20" />
          ))}
        </div>
      )}

      {/* 4-stage grid */}
      {qs && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

            {/* ── Stage 1: Sources ── */}
            <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase mb-1 bg-blue-500/20 text-blue-400">Stage 1</p>
                  <h2 className="text-lg font-bold leading-tight">Sources</h2>
                  <p className="text-xs text-muted-foreground">Active job board integrations</p>
                </div>
                <Globe2 className="h-6 w-6 text-muted-foreground/50 mt-1 shrink-0" />
              </div>
              <div className="space-y-2 flex-1">
                {sources.map((src) => (
                  <div key={src.name} className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${src.color}`} />
                    <span className="text-xs text-muted-foreground w-28 shrink-0">{src.name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${src.color} opacity-80 transition-all duration-700`}
                        style={{ width: `${Math.max(4, Math.round((src.count / maxSrc) * 100))}%` }} />
                    </div>
                    <span className="text-xs font-medium tabular-nums w-16 text-right">{fmtNum(src.count)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-border/50">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
                <p className="text-2xl font-bold tabular-nums">{fmtNum(totalJobs)} <span className="text-sm font-normal text-muted-foreground">jobs</span></p>
              </div>
            </div>

            {/* ── Stage 2: Job Repository ── */}
            <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase mb-1 bg-emerald-500/20 text-emerald-400">Stage 2</p>
                  <h2 className="text-lg font-bold leading-tight">Job Repository</h2>
                  <p className="text-xs text-muted-foreground">Central data store · all sources</p>
                </div>
                <Database className="h-6 w-6 text-muted-foreground/50 mt-1 shrink-0" />
              </div>
              <div className="flex items-center gap-6 flex-1">
                <div className="relative shrink-0">
                  <svg width="100" height="100" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r={circR} fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
                    <circle cx="50" cy="50" r={circR} fill="none" stroke="hsl(var(--primary))" strokeWidth="10"
                      strokeDasharray={`${circDash} ${circC}`} strokeLinecap="round"
                      transform="rotate(-90 50 50)" className="transition-all duration-700" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold">{enrichedPct}%</span>
                    <span className="text-[9px] text-muted-foreground">enriched</span>
                  </div>
                </div>
                <div className="space-y-2 flex-1">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Jobs</div>
                  <div className="text-3xl font-bold tabular-nums">{fmtNum(totalJobs)}</div>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between rounded bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5">
                      <span className="text-xs text-emerald-400">With Description</span>
                      <span className="text-sm font-bold text-emerald-400">{fmtNum(withDesc)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
                      <span className="text-xs text-amber-400">No Description</span>
                      <span className="text-sm font-bold text-amber-400">{fmtNum(qs.no_description)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Stage 3A: JD Fetch ── */}
            <div className="rounded-xl border border-amber-500/20 bg-card p-5 shadow-sm flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase mb-1 bg-amber-500/20 text-amber-400">Stage 3A</p>
                  <h2 className="text-lg font-bold leading-tight">JD Fetch</h2>
                  <p className="text-xs text-muted-foreground">AI-powered description retrieval</p>
                </div>
                <ArrowUpRight className="h-6 w-6 text-muted-foreground/50 mt-1 shrink-0" />
              </div>
              <div className="space-y-3 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tabular-nums text-amber-400">{fmtNum(qs.fetch_pending)}</span>
                  <span className="text-sm text-muted-foreground">pending</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  <div className="rounded bg-muted/40 px-2 py-1.5 text-center">
                    <div className="text-muted-foreground text-[10px]">Pending</div>
                    <div className="font-bold">{fmtNum(qs.fetch_pending)}</div>
                  </div>
                  <div className="rounded bg-red-500/10 px-2 py-1.5 text-center">
                    <div className="text-muted-foreground text-[10px]">Failed</div>
                    <div className="font-bold text-red-400">{fmtNum(qs.fetch_failed)}</div>
                  </div>
                  <div className="rounded bg-slate-500/10 px-2 py-1.5 text-center">
                    <div className="text-muted-foreground text-[10px]">No JD</div>
                    <div className="font-bold text-slate-400">{fmtNum(qs.fetch_no_jd_found)}</div>
                  </div>
                </div>
                {fetchTotal > 0 && (
                  <div className="space-y-1">
                    {fetchSrcOrder.filter((k) => (fetchBySource[k] ?? 0) > 0).map((k) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-16 shrink-0">{fetchSrcLabel[k]}</span>
                        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-amber-400/70 transition-all duration-700"
                            style={{ width: `${Math.round(((fetchBySource[k] ?? 0) / fetchTotal) * 100)}%` }} />
                        </div>
                        <span className="tabular-nums w-12 text-right">{fmtNum(fetchBySource[k])}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-medium text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Google+GPT · 8/tick · 5 min
                </span>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={triggerFetch} disabled={fetchLoading}>
                  {fetchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Run now
                </Button>
              </div>
            </div>

            {/* ── Stage 3B: JD Analysis ── */}
            <div className="rounded-xl border border-violet-500/20 bg-card p-5 shadow-sm flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase mb-1 bg-violet-500/20 text-violet-400">Stage 3B</p>
                  <h2 className="text-lg font-bold leading-tight">JD Analysis</h2>
                  <p className="text-xs text-muted-foreground">GPT-4.1-mini classification</p>
                </div>
                <Brain className="h-6 w-6 text-muted-foreground/50 mt-1 shrink-0" />
              </div>
              <div className="space-y-3 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tabular-nums text-violet-400">{fmtNum(qs.analysis_queue)}</span>
                  <span className="text-sm text-muted-foreground">in queue</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-violet-500/20 text-violet-300">gpt-4.1-mini</span>
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">Cron · 40/tick · 5 min</span>
                  {qs.active_batch && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-500/20 text-green-400">Batch active</span>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{fmtNum(qs.v2_complete)} v2-complete</span>
                    <span>{analysisPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500 transition-all duration-700" style={{ width: `${analysisPct}%` }} />
                  </div>
                </div>
                {recentRuns.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Recent batches</p>
                    <div className="flex items-end gap-1 h-10">
                      {recentRuns.slice(0, 6).reverse().map((run, idx) => {
                        const barPct = maxRunItems > 0 ? Math.max(8, Math.round(((run.processed_items ?? 0) / maxRunItems) * 100)) : 8;
                        return (
                          <div key={run.id ?? idx} className="flex-1 flex flex-col items-center gap-0.5">
                            <div className={`w-full rounded transition-all duration-500 ${run.status === "succeeded" ? "bg-violet-500" : "bg-red-500"}`}
                              style={{ height: `${barPct}%` }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {qs.active_batch && (
                  <p className="text-[10px] text-muted-foreground">
                    Batch: <code className="font-mono">{(qs.active_batch.batch_id ?? qs.active_batch.run_id).slice(0, 16)}…</code> — {fmtNum(qs.active_batch.processed)} ingested
                  </p>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2">
                <Button size="sm" className="h-7 text-xs gap-1" onClick={submitBatch}
                  disabled={batchLoading || !!qs.active_batch}>
                  {batchLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Submit Batch
                </Button>
                <span className="text-[10px] text-muted-foreground">50% cheaper · 2-4h</span>
              </div>
            </div>
          </div>

          {/* ── Row 2: Stage 4 + stat cards ── */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            {/* Stage 4 */}
            <div className="xl:col-span-1 rounded-xl border border-green-500/20 bg-card p-5 shadow-sm flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase mb-1 bg-green-500/20 text-green-400">Stage 4</p>
                  <h2 className="text-lg font-bold leading-tight">Intelligence Ready</h2>
                  <p className="text-xs text-muted-foreground">v2.2 analyzed</p>
                </div>
                <CheckCircle2 className="h-6 w-6 text-muted-foreground/50 mt-1 shrink-0" />
              </div>
              <div className="space-y-3 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tabular-nums text-green-400">{fmtNum(qs.v2_complete)}</span>
                  <span className="text-sm text-muted-foreground">enriched</span>
                </div>
                {qs.trend_7d_delta != null && qs.trend_7d_delta > 0 && (
                  <div className="flex items-center gap-1 text-xs text-green-400">
                    <TrendingUp className="h-3.5 w-3.5" />
                    <span>+{fmtNum(qs.trend_7d_delta)} in last 7 days</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {intTags.map((tag) => (
                    <span key={tag} className="rounded-md bg-green-500/10 border border-green-500/20 px-2 py-0.5 text-[10px] font-medium text-green-400">{tag}</span>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  <div className="flex items-center justify-between rounded bg-muted/40 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Jobs Bucketed</span>
                    </div>
                    <span className="font-bold">{fmtNum(qs.bucket_count)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Bucket Candidates</span>
                    </div>
                    <span className="font-bold">{fmtNum(qs.bucket_candidates)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Discovered Titles</span>
                    </div>
                    <Link href="/discovered-titles">
                      <a className="flex items-center gap-0.5 font-bold hover:text-primary transition-colors">
                        {fmtNum(qs.discovered_pending)} <ChevronRight className="h-3 w-3" />
                      </a>
                    </Link>
                  </div>
                </div>
                {qs.avg_analysis_ms != null && (
                  <div className="rounded bg-muted/40 px-3 py-2 text-xs flex justify-between">
                    <span className="text-muted-foreground">Avg analysis time</span>
                    <span className="font-bold">{(qs.avg_analysis_ms / 1000).toFixed(1)}s / job</span>
                  </div>
                )}
              </div>
            </div>

            {/* Stat cards */}
            <div className="xl:col-span-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 content-start">
              {[
                { label: "Total Jobs",        value: fmtNum(totalJobs),           sub: "all sources",         accent: false },
                { label: "With JD",           value: fmtNum(withDesc),            sub: `${enrichedPct}% enriched`, accent: true },
                { label: "Fetch Queue",       value: fmtNum(qs.fetch_pending + qs.fetch_failed), sub: "pending + failed", accent: false },
                { label: "Analysis Queue",    value: fmtNum(qs.analysis_queue),   sub: "awaiting GPT",        accent: false },
                { label: "v2 Complete",       value: fmtNum(qs.v2_complete),      sub: "fully enriched",      accent: true },
                { label: "Bucketed",          value: fmtNum(qs.bucket_count),     sub: "assigned to bucket",  accent: false },
                { label: "Bucket Types",      value: fmtNum(qs.bucket_candidates),sub: "candidate buckets",   accent: false },
                { label: "Discovered Titles", value: fmtNum(qs.discovered_pending), sub: "awaiting review",  accent: false },
              ].map((card) => (
                <div key={card.label}
                  className={`rounded-lg p-3 space-y-0.5 border ${card.accent ? "bg-primary/10 border-primary/20" : "bg-muted/40 border-border/50"}`}>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{card.label}</p>
                  <p className={`text-xl font-bold tabular-nums leading-none ${card.accent ? "text-primary" : ""}`}>{card.value}</p>
                  {card.sub && <p className="text-[10px] text-muted-foreground">{card.sub}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* ── Cron activity strip ── */}
          {recentRuns.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pipeline Activity</p>
                  <p className="text-sm font-semibold">Last {recentRuns.length} cron runs</p>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] text-green-400 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  All systems operational
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {recentRuns.slice(0, 6).map((run, idx) => (
                  <div key={run.id ?? idx}
                    className={`rounded-md border px-3 py-2 text-xs space-y-0.5 ${run.status === "succeeded" ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                    <div className={`flex items-center gap-1 font-semibold ${run.status === "succeeded" ? "text-green-400" : "text-red-400"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${run.status === "succeeded" ? "bg-green-400" : "bg-red-400"}`} />
                      {fmtNum(run.processed_items ?? 0)} jobs
                    </div>
                    <div className="text-muted-foreground text-[10px]">{timeAgo(run.started_at)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
