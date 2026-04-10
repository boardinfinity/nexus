import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { RunHistory } from "./run-history";

export default function DataQualityPipelines() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipelines"><a className="text-xs text-muted-foreground hover:text-foreground">← Pipelines</a></Link>
        <div>
          <h1 className="text-2xl font-bold">Data Quality</h1>
          <p className="text-sm text-muted-foreground">Deduplication, co-occurrence analysis, and job status checks</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PipelineTrigger type="deduplication" title="Deduplication" description="Find and mark duplicate job listings" icon={ShieldCheck}
          fields={[{ name: "batch_size", label: "Batch Size", type: "number", placeholder: "500", defaultValue: "500" }]} />
        <PipelineTrigger type="cooccurrence" title="Skill Co-occurrence" description="Compute skill co-occurrence matrix from job_skills" icon={ShieldCheck}
          fields={[]} />
        <PipelineTrigger type="job_status_check" title="Job Status Checker" description="Check if job listings are still active" icon={ShieldCheck}
          fields={[{ name: "batch_size", label: "Batch Size", type: "number", placeholder: "100", defaultValue: "100" }]} />
      </div>
      <RunHistory pipelineTypes={["deduplication", "cooccurrence", "job_status_check"]} title="Data Quality Runs" />
    </div>
  );
}
