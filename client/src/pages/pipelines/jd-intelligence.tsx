import { Link } from "wouter";
import { Brain, Info } from "lucide-react";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { RunHistory } from "./run-history";

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
          <PipelineTrigger type="jd_enrichment" title="JD Analysis (Real-time)" description="Classify JDs with v2.2 prompt — function, family, industry, seniority, bucket + L1/L2 skills" icon={Brain}
            fields={[{ name: "batch_size", label: "Jobs per run (max 40)", type: "number", placeholder: "40", defaultValue: "40" }]} />
          <div className="flex items-start gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Runs up to 40 jobs per trigger (Vercel 300s budget). Each run drains the queue — trigger again to process more.
              Check <em>error_message</em> in run history for remaining count. Uses the same pipeline as the manual JD Analyzer.
            </span>
          </div>
        </div>
        <PipelineTrigger type="jd_batch_submit" title="JD Batch Submit" description="Submit to OpenAI Batch API (50% cheaper, 2-4h). For nightly bulk." icon={Brain}
          fields={[{ name: "batch_size", label: "Jobs to Submit", type: "number", placeholder: "500", defaultValue: "500" }]} />
        <PipelineTrigger type="jd_batch_poll" title="JD Batch Poll" description="Check batch status and process results when complete." icon={Brain}
          fields={[{ name: "batch_id", label: "OpenAI Batch ID", type: "text", placeholder: "batch_abc123..." }]} />
      </div>
      <RunHistory pipelineTypes={["jd_fetch", "jd_enrichment", "jd_batch_submit", "jd_batch_poll"]} title="JD Processing Runs" />
    </div>
  );
}
