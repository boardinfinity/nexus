import { Link } from "wouter";
import { Building2 } from "lucide-react";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { RunHistory } from "./run-history";

export default function CompanyIntel() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipelines"><a className="text-xs text-muted-foreground hover:text-foreground">← Pipelines</a></Link>
        <div>
          <h1 className="text-2xl font-bold">Company Intelligence</h1>
          <p className="text-sm text-muted-foreground">Enrich company profiles with external data</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PipelineTrigger type="company_enrichment" title="Company Enrichment" description="Enrich pending company profiles" icon={Building2}
          fields={[{ name: "batch_size", label: "Batch Size", type: "number", placeholder: "50", defaultValue: "50" }]} />
      </div>
      <RunHistory pipelineTypes={["company_enrichment"]} title="Company Enrichment Runs" />
    </div>
  );
}
