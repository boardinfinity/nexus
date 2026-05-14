import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Brain, Info, Play, Square, RefreshCw, Loader2 } from "lucide-react";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { RunHistory } from "./run-history";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface DrainStatus {
  drain_active: boolean;
  drain_schedule_id: string | null;
  queue_remaining: number;
  v2_complete: number;
}

function JDAutoDrain() {
  const { toast } = useToast();
  const [status, setStatus] = useState<DrainStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/pipelines/jd/drain-status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // silent
    }
  }, []);

  // Poll every 8s while drain is active
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!status?.drain_active) {
      setPolling(false);
      return;
    }
    setPolling(true);
    const id = setInterval(fetchStatus, 8000);
    return () => clearInterval(id);
  }, [status?.drain_active, fetchStatus]);

  const startDrain = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pipelines/jd/start-drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_size: 40 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start drain");
      toast({ title: "Auto-drain started", description: `Run ${data.run_id?.slice(0, 8)} launched. Processing 40 jobs/batch continuously.` });
      setTimeout(fetchStatus, 2000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const stopDrain = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pipelines/jd/stop-drain", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to stop drain");
      toast({ title: "Drain stopping", description: "Current batch will finish, then the chain halts." });
      setTimeout(fetchStatus, 1500);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const total = status ? (status.queue_remaining + status.v2_complete) : null;
  const pct = total && total > 0 ? Math.round((status!.v2_complete / total) * 100) : 0;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">JD Analysis — Auto-Drain</span>
          {status?.drain_active && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Running
            </span>
          )}
          {status && !status.drain_active && status.queue_remaining === 0 && status.v2_complete > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Complete
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchStatus} className="h-7 w-7 p-0">
          <RefreshCw className={`h-3.5 w-3.5 ${polling ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Automatically chains 40-job batches until the entire queue is v2-analyzed. Stop at any time — current batch completes cleanly.
      </p>

      {status && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{status.v2_complete.toLocaleString()} done</span>
            <span>{status.queue_remaining.toLocaleString()} remaining</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-right">{pct}% complete</p>
        </div>
      )}

      <div className="flex gap-2">
        {!status?.drain_active ? (
          <Button size="sm" onClick={startDrain} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start Auto-Drain
          </Button>
        ) : (
          <Button size="sm" variant="destructive" onClick={stopDrain} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            Stop Drain
          </Button>
        )}
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
          <PipelineTrigger type="jd_enrichment" title="JD Analysis (Real-time)" description="Single manual run — classify JDs with v2.2 prompt: function, family, industry, seniority, bucket + L1/L2 skills" icon={Brain}
            fields={[{ name: "batch_size", label: "Jobs per run (max 40)", type: "number", placeholder: "40", defaultValue: "40" }]} />
          <div className="flex items-start gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Single run — 40 jobs max. Use <strong>Auto-Drain</strong> below to continuously drain the full queue automatically.
            </span>
          </div>
        </div>
        <JDAutoDrain />
        <PipelineTrigger type="jd_batch_submit" title="JD Batch Submit" description="Submit to OpenAI Batch API (50% cheaper, 2-4h). For nightly bulk." icon={Brain}
          fields={[{ name: "batch_size", label: "Jobs to Submit", type: "number", placeholder: "500", defaultValue: "500" }]} />
        <PipelineTrigger type="jd_batch_poll" title="JD Batch Poll" description="Check batch status and process results when complete." icon={Brain}
          fields={[{ name: "batch_id", label: "OpenAI Batch ID", type: "text", placeholder: "batch_abc123..." }]} />
      </div>
      <RunHistory pipelineTypes={["jd_fetch", "jd_enrichment", "jd_batch_submit", "jd_batch_poll"]} title="JD Processing Runs" />
    </div>
  );
}
