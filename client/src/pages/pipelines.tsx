import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Briefcase, Search, Building2, FileText, GraduationCap, UserCheck, Brain, Play, Loader2, Download, ShieldCheck, Network, CircleCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PipelineRun } from "@shared/schema";

const COUNTRIES = [
  { value: "", label: "Any Country" },
  { value: "IN", label: "India" },
  { value: "AE", label: "UAE" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "SG", label: "Singapore" },
  { value: "AU", label: "Australia" },
  { value: "CA", label: "Canada" },
];

const EMPLOYMENT_TYPES = [
  { value: "FULLTIME", label: "Full Time" },
  { value: "PARTTIME", label: "Part Time" },
  { value: "INTERN", label: "Internship" },
  { value: "CONTRACTOR", label: "Contract" },
];

function GoogleJobsPipelineTrigger() {
  const [queries, setQueries] = useState("Financial Analyst jobs in Dubai");
  const [country, setCountry] = useState("");
  const [pagesPerQuery, setPagesPerQuery] = useState("3");
  const [datePosted, setDatePosted] = useState("week");
  const [employmentTypes, setEmploymentTypes] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleEmploymentType = (type: string) => {
    setEmploymentTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const queryList = queries.split("\n").map(q => q.trim()).filter(Boolean);
      if (queryList.length === 0) throw new Error("At least one query is required");

      const res = await apiRequest("POST", "/api/pipelines/run", {
        pipeline_type: "google_jobs",
        config: {
          queries: queryList,
          country: country || undefined,
          pages_per_query: parseInt(pagesPerQuery) || 3,
          date_posted: datePosted,
          employment_type: employmentTypes.length > 0 ? employmentTypes : undefined,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pipeline started", description: "Google Jobs pipeline has been triggered." });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/pipeline-activity"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start pipeline", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="pipeline-trigger-google_jobs">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2">
            <Search className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm">Google Jobs</CardTitle>
            <p className="text-xs text-muted-foreground">Search jobs via Google Jobs API (enhanced)</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Search Queries (one per line)</Label>
          <Textarea
            className="text-xs min-h-[80px]"
            placeholder={"Financial Analyst jobs in Dubai\nData Analyst jobs in Mumbai\nInvestment Banking Analyst India"}
            value={queries}
            onChange={(e) => setQueries(e.target.value)}
            data-testid="field-queries"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="h-8 text-xs" data-testid="field-country">
                <SelectValue placeholder="Any Country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map(c => (
                  <SelectItem key={c.value} value={c.value || "any"}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pages per Query</Label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={pagesPerQuery}
              onChange={(e) => setPagesPerQuery(e.target.value)}
              min={1}
              max={10}
              data-testid="field-pages_per_query"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Date Posted</Label>
          <Select value={datePosted} onValueChange={setDatePosted}>
            <SelectTrigger className="h-8 text-xs" data-testid="field-date_posted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="3days">Past 3 Days</SelectItem>
              <SelectItem value="week">Past Week</SelectItem>
              <SelectItem value="month">Past Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Employment Type</Label>
          <div className="flex flex-wrap gap-3">
            {EMPLOYMENT_TYPES.map(et => (
              <div key={et.value} className="flex items-center gap-1.5">
                <Checkbox
                  id={`et-${et.value}`}
                  checked={employmentTypes.includes(et.value)}
                  onCheckedChange={() => toggleEmploymentType(et.value)}
                />
                <Label htmlFor={`et-${et.value}`} className="text-xs cursor-pointer">{et.label}</Label>
              </div>
            ))}
          </div>
        </div>
        <Button
          className="w-full h-8 text-xs"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          data-testid="run-google_jobs"
        >
          {mutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Play className="h-3 w-3 mr-1" />
          )}
          Run Pipeline
        </Button>
      </CardContent>
    </Card>
  );
}

function JobStatusCheckerTrigger() {
  const [batchSize, setBatchSize] = useState("50");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pipelines/check-job-status", {
        batch_size: parseInt(batchSize) || 50,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Job status check complete",
        description: `Checked ${data.checked} jobs. ${data.failed || 0} failed.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Status check failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="pipeline-trigger-job_status_check">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2">
            <CircleCheck className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm">Job Status Checker</CardTitle>
            <p className="text-xs text-muted-foreground">Check if jobs are still open or closed</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Batch Size</Label>
          <Input
            type="number"
            className="h-8 text-xs"
            value={batchSize}
            onChange={(e) => setBatchSize(e.target.value)}
            min={1}
            max={200}
            data-testid="field-batch_size_status"
          />
        </div>
        <Button
          className="w-full h-8 text-xs"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          data-testid="run-job_status_check"
        >
          {mutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Play className="h-3 w-3 mr-1" />
          )}
          Check Job Status
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Pipelines() {
  const [selected, setSelected] = useState<PipelineRun | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<{ data: PipelineRun[]; total: number }>({
    queryKey: ["/api/pipelines", page],
    queryFn: async () => {
      const res = await authFetch(`/api/pipelines?page=${page}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch pipelines");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: detail } = useQuery<PipelineRun>({
    queryKey: ["/api/pipelines", selected?.id],
    queryFn: async () => {
      const res = await authFetch(`/api/pipelines/${selected!.id}`);
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

      {/* Job Pipelines */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Job Collection</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <PipelineTrigger
            type="linkedin_jobs"
            title="LinkedIn Jobs"
            description="Collect job listings from LinkedIn"
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
          <GoogleJobsPipelineTrigger />
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
            type="jd_fetch"
            title="JD Fetch"
            description="Fetch missing job descriptions via Apify + OpenAI"
            icon={Download}
            fields={[
              { name: "batch_size", label: "Batch Size", type: "number", placeholder: "10", defaultValue: "10" },
            ]}
          />
          <PipelineTrigger
            type="jd_enrichment"
            title="JD Analysis"
            description="Extract skills & structured data from JDs using AI"
            icon={Brain}
            fields={[
              { name: "batch_size", label: "Batch Size", type: "number", placeholder: "25", defaultValue: "25" },
            ]}
          />
        </div>
      </div>

      {/* People & Alumni Pipelines */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">People & Alumni</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PipelineTrigger
            type="alumni"
            title="Alumni Search"
            description="Find university alumni via LinkedIn"
            icon={GraduationCap}
            fields={[
              { name: "university_slug", label: "University Slug(s)", type: "text", placeholder: "e.g. iit-bombay, iit-delhi" },
              { name: "university_name", label: "Display Name", type: "text", placeholder: "e.g. IIT Bombay" },
              { name: "keywords", label: "Keywords (Optional)", type: "text", placeholder: "e.g. engineering" },
              { name: "job_title", label: "Current Title (Optional)", type: "text", placeholder: "e.g. Software Engineer" },
              { name: "location", label: "Location (Optional)", type: "text", placeholder: "e.g. India" },
              { name: "pages", label: "Pages to Fetch", type: "number", placeholder: "5", defaultValue: "5" },
            ]}
          />
          <PipelineTrigger
            type="people_enrichment"
            title="Enrich Profiles"
            description="Enrich people with LinkedIn data via Apify (1 credit per profile)"
            icon={UserCheck}
            fields={[
              { name: "mode", label: "Mode", type: "select", options: [
                { value: "enrich", label: "Enrich Profiles (via Apify)" },
                { value: "search", label: "Search (stub)" },
              ], defaultValue: "enrich" },
              { name: "batch_size", label: "Batch Size", type: "number", placeholder: "5", defaultValue: "5" },
            ]}
          />
        </div>
      </div>

      {/* Data Quality & Co-occurrence Pipelines */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Data Quality & Analysis</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PipelineTrigger
            type="deduplication"
            title="Data Quality & Dedup"
            description="Recompute quality scores and detect duplicates"
            icon={ShieldCheck}
            fields={[]}
          />
          <PipelineTrigger
            type="cooccurrence"
            title="Skill Co-occurrence"
            description="Compute skill pair frequencies and PMI scores"
            icon={Network}
            fields={[]}
          />
          <JobStatusCheckerTrigger />
        </div>
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
              {
                header: "Error",
                accessor: (r: PipelineRun) => r.error_message ? (
                  <span className="text-red-500 text-xs max-w-[200px] truncate block" title={r.error_message}>
                    {r.error_message}
                  </span>
                ) : null,
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
