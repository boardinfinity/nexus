import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Briefcase, Search, Building2, FileText } from "lucide-react";
import type { PipelineRun } from "@shared/schema";

export default function Pipelines() {
  const [selected, setSelected] = useState<PipelineRun | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<{ data: PipelineRun[]; total: number }>({
    queryKey: ["/api/pipelines", page],
    queryFn: async () => {
      const res = await fetch(`/api/pipelines?page=${page}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch pipelines");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: detail } = useQuery<PipelineRun>({
    queryKey: ["/api/pipelines", selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/pipelines/${selected!.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selected?.id,
    refetchInterval: selected?.status === "running" ? 3000 : false,
  });

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div className="space-y-6" data-testid="pipelines-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
        <p className="text-sm text-muted-foreground">Configure and run data enrichment pipelines</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <PipelineTrigger
          type="linkedin_jobs"
          title="LinkedIn Jobs"
          description="Scrape job listings from LinkedIn"
          icon={Briefcase}
          fields={[
            { name: "search_keywords", label: "Keywords", type: "text", placeholder: "e.g. software engineer" },
            { name: "location", label: "Location", type: "text", placeholder: "e.g. India", defaultValue: "India" },
            { name: "date_posted", label: "Date Posted", type: "select", options: [
              { value: "past month", label: "Past Month" },
              { value: "past week", label: "Past Week" },
              { value: "24hr", label: "Past 24 Hours" },
            ], defaultValue: "past month" },
            { name: "limit", label: "Limit", type: "number", placeholder: "100", defaultValue: "100" },
          ]}
        />
        <PipelineTrigger
          type="google_jobs"
          title="Google Jobs"
          description="Search jobs via Google Jobs API"
          icon={Search}
          fields={[
            { name: "query", label: "Search Query", type: "text", placeholder: "e.g. data analyst in Mumbai" },
            { name: "location", label: "Location", type: "text", placeholder: "e.g. Mumbai, India" },
            { name: "date_posted", label: "Date Posted", type: "select", options: [
              { value: "all", label: "Any Time" },
              { value: "today", label: "Today" },
              { value: "3days", label: "Past 3 Days" },
              { value: "week", label: "Past Week" },
              { value: "month", label: "Past Month" },
            ], defaultValue: "month" },
            { name: "num_pages", label: "Pages", type: "number", placeholder: "1", defaultValue: "1" },
          ]}
        />
        <PipelineTrigger
          type="company_enrichment"
          title="Company Enrichment"
          description="Enrich pending company profiles"
          icon={Building2}
          fields={[
            { name: "batch_size", label: "Batch Size", type: "number", placeholder: "50", defaultValue: "50" },
            { name: "provider", label: "Provider", type: "select", options: [
              { value: "apollo", label: "Apollo" },
              { value: "proxycurl", label: "Proxycurl" },
            ], defaultValue: "apollo" },
          ]}
        />
        <PipelineTrigger
          type="jd_enrichment"
          title="JD Enrichment"
          description="Extract skills from job descriptions"
          icon={FileText}
          fields={[
            { name: "batch_size", label: "Batch Size", type: "number", placeholder: "100", defaultValue: "100" },
            { name: "status_filter", label: "Status", type: "select", options: [
              { value: "pending", label: "Pending Only" },
              { value: "partial", label: "Partial" },
              { value: "failed", label: "Failed (Retry)" },
            ], defaultValue: "pending" },
          ]}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Pipeline Run History</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              { header: "Type", accessor: (r: PipelineRun) => r.pipeline_type?.replace(/_/g, " ") ?? "—", className: "capitalize font-medium" },
              { header: "Status", accessor: (r: PipelineRun) => <StatusBadge status={r.status} /> },
              {
                header: "Progress",
                accessor: (r: PipelineRun) => {
                  const total = r.total_items ?? 0;
                  const processed = r.processed_items ?? 0;
                  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
                  return (
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <Progress value={pct} className="h-2 flex-1" />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {processed}/{total}
                      </span>
                    </div>
                  );
                },
              },
              { header: "Triggered By", accessor: (r: PipelineRun) => r.triggered_by || "manual" },
              {
                header: "Started",
                accessor: (r: PipelineRun) =>
                  r.started_at ? new Date(r.started_at).toLocaleString() : "—",
              },
              {
                header: "Duration",
                accessor: (r: PipelineRun) => {
                  if (!r.started_at) return "—";
                  const start = new Date(r.started_at).getTime();
                  const end = r.completed_at ? new Date(r.completed_at).getTime() : Date.now();
                  const secs = Math.round((end - start) / 1000);
                  if (secs < 60) return `${secs}s`;
                  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
                },
              },
            ]}
            data={data?.data ?? []}
            isLoading={isLoading}
            onRowClick={(row) => setSelected(row)}
            emptyMessage="No pipeline runs yet. Trigger a pipeline above to get started."
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-4">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button className="px-3 py-1 rounded border disabled:opacity-50" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="px-3 py-1 rounded border disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="capitalize">{detail?.pipeline_type?.replace(/_/g, " ")} Run</SheetTitle>
          </SheetHeader>
          {(detail || selected) && (() => {
            const run = detail || selected!;
            const total = run.total_items ?? 0;
            const processed = run.processed_items ?? 0;
            const failed = run.failed_items ?? 0;
            const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
            return (
              <div className="space-y-4 mt-4">
                <Card>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Status</span>
                      <StatusBadge status={run.status} />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{processed}/{total} ({pct}%)</span>
                      </div>
                      <Progress value={pct} className="h-3" />
                    </div>
                    {failed > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Failed Items</span>
                        <span className="text-red-500 font-medium">{failed}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Started</span>
                      <span>{run.started_at ? new Date(run.started_at).toLocaleString() : "—"}</span>
                    </div>
                    {run.completed_at && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Completed</span>
                        <span>{new Date(run.completed_at).toLocaleString()}</span>
                      </div>
                    )}
                    {run.error_message && (
                      <div className="p-2 rounded bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs">
                        {run.error_message}
                      </div>
                    )}
                  </CardContent>
                </Card>
                {run.config && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground uppercase">Configuration</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                        {JSON.stringify(run.config, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
