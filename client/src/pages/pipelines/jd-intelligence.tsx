import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Brain, Info, Play, RefreshCw, Loader2 } from "lucide-react";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { RunHistory } from "./run-history";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/queryClient";

interface ActiveBatch {
  run_id: string;
  batch_id: string | null;
  started_at: string;
  processed: number;
}

interface QueueStatus {
  fetch_queue: number;
  analysis_queue: number;
  v2_complete: number;
  active_batch: ActiveBatch | null;
}

function JDBatchStatus() {
  const { toast } = useToast();
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/pipelines/jd/queue-status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll every 30s when an active batch exists
  useEffect(() => {
    if (!status?.active_batch) return;
    const id = setInterval(fetchStatus, 30000);
    return () => clearInterval(id);
  }, [status?.active_batch, fetchStatus]);

  const submitBatch = async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST",
        body: JSON.stringify({ pipeline_type: "jd_batch_submit", config: {} }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit batch");
      toast({
        title: "Batch submitted",
        description: `OpenAI Batch API job started. Results will be ingested automatically within 2-4 hours.`,
      });
      setTimeout(fetchStatus, 3000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const total = status ? (status.analysis_queue + status.v2_complete) : null;
  const pct = total && total > 0 ? Math.round((status!.v2_complete / total) * 100) : 0;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">JD Queue Status</span>
          {status?.active_batch && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Batch active
            </span>
          )}
          {status && !status.active_batch && status.analysis_queue === 0 && status.v2_complete > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Queue empty
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchStatus} className="h-7 w-7 p-0">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Cron runs every 5 min — 40 jobs/tick via real-time analysis. For bulk processing, submit to OpenAI Batch API (50% cheaper, 2-4h turnaround).
      </p>

      {status && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">Fetch queue</div>
              <div className="font-semibold">{status.fetch_queue.toLocaleString()}</div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">Analysis queue</div>
              <div className="font-semibold">{status.analysis_queue.toLocaleString()}</div>
            </div>
          </div>
          {total !== null && total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{status.v2_complete.toLocaleString()} v2-done</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          {status.active_batch && (
            <p className="text-xs text-muted-foreground">
              Active batch: <code className="font-mono">{(status.active_batch.batch_id ?? status.active_batch.run_id).slice(0, 16)}…</code> — {status.active_batch.processed} ingested — polling every 15 min
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={submitBatch} disabled={loading || !!status?.active_batch} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Submit Batch
        </Button>
      </div>
    </div>
  );
}

export default function JDIntelligence() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipelines"><a className="text-xs text-muted-foreground hover:text-foreground">← Pipelines</a></Link>
        <div>
          <h1 className="text-2xl font-bold">JD Intelligence</h1>
          <p className="text-sm text-muted-foreground">Analyze, classify, and extract skills from job descriptions</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PipelineTrigger type="jd_fetch" title="JD Fetch" description="Fetch missing job descriptions via Apify" icon={Brain}
          fields={[{ name: "batch_size", label: "Batch Size", type: "number", placeholder: "10", defaultValue: "10" }]} />
        <div className="space-y-2">
          <PipelineTrigger type="jd_enrichment" title="JD Analysis (Single Run)" description="Manual single run — classify JDs with v2.2 prompt: function, family, industry, seniority, bucket + L1/L2 skills" icon={Brain}
            fields={[{ name: "batch_size", label: "Jobs per run (max 40)", type: "number", placeholder: "40", defaultValue: "40" }]} />
          <div className="flex items-start gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Single run — 40 jobs max. Cron auto-runs every 5 min. Use <strong>Submit Batch</strong> for bulk (11k+ jobs via OpenAI Batch API).
            </span>
          </div>
        </div>
        <JDBatchStatus />
        <PipelineTrigger type="jd_batch_poll" title="JD Batch Poll (Manual)" description="Manually check OpenAI batch status and ingest results. Normally auto-polled by cron." icon={Brain}
          fields={[{ name: "batch_id", label: "OpenAI Batch ID", type: "text", placeholder: "batch_abc123..." }]} />
      </div>
      <RunHistory pipelineTypes={["jd_fetch", "jd_enrichment", "jd_batch_submit", "jd_batch_poll"]} title="JD Processing Runs" />
    </div>
  );
}
