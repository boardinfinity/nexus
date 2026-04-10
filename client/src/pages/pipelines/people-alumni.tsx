import { Link } from "wouter";
import { Users } from "lucide-react";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { RunHistory } from "./run-history";

export default function PeopleAlumni() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipelines"><a className="text-xs text-muted-foreground hover:text-foreground">← Pipelines</a></Link>
        <div>
          <h1 className="text-2xl font-bold">People & Alumni</h1>
          <p className="text-sm text-muted-foreground">Search and enrich LinkedIn alumni profiles</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PipelineTrigger type="alumni" title="Alumni Search" description="Search LinkedIn for alumni from a university" icon={Users}
          fields={[
            { name: "keywords", label: "University/Keywords", type: "text", placeholder: "XLRI Jamshedpur" },
            { name: "location", label: "Location", type: "text", placeholder: "India" },
            { name: "job_title", label: "Current Job Title", type: "text", placeholder: "e.g. Manager" },
            { name: "limit", label: "Max Profiles", type: "number", placeholder: "100", defaultValue: "100" },
          ]} />
        <PipelineTrigger type="people_enrichment" title="Profile Enrichment" description="Enrich pending people profiles with AI extraction" icon={Users}
          fields={[{ name: "batch_size", label: "Batch Size", type: "number", placeholder: "50", defaultValue: "50" }]} />
      </div>
      <RunHistory pipelineTypes={["alumni", "people_enrichment"]} title="People Pipeline Runs" />
    </div>
  );
}
