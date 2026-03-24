import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, ExternalLink, Circle, FileText, Brain, Download, Play, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Job } from "@shared/schema";

interface JobSkill {
  id: string;
  skill_name: string;
  category: string | null;
  confidence_score: number | null;
  taxonomy_skill?: { id: string; name: string; category: string; subcategory: string | null } | null;
}

export default function Jobs() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [seniority, setSeniority] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "50");
  if (search) params.set("search", search);
  if (source !== "all") params.set("source", source);
  if (status !== "all") params.set("enrichment_status", status);
  if (seniority !== "all") params.set("seniority_level", seniority);

  const { data, isLoading } = useQuery<{ data: Job[]; total: number }>({
    queryKey: ["/api/jobs", params.toString()],
    queryFn: async () => {
      const res = await authFetch(`/api/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  const { data: jobDetail } = useQuery<Job & { skills?: JobSkill[] }>({
    queryKey: ["/api/jobs", selectedJob?.id],
    queryFn: async () => {
      const res = await authFetch(`/api/jobs/${selectedJob!.id}`);
      if (!res.ok) throw new Error("Failed to fetch job");
      return res.json();
    },
    enabled: !!selectedJob?.id,
  });

  const fetchJdMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", "/api/pipelines/run", {
        pipeline_type: "jd_fetch",
        config: { batch_size: 1, job_ids: [jobId] },
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "JD Fetch started", description: "Job description fetch has been triggered." });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to fetch JD", description: err.message, variant: "destructive" });
    },
  });

  const analyzeJdMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiRequest("POST", "/api/pipelines/run", {
        pipeline_type: "jd_enrichment",
        config: { batch_size: 1, job_ids: [jobId] },
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "JD Analysis started", description: "Job description analysis has been triggered." });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to analyze JD", description: err.message, variant: "destructive" });
    },
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="space-y-4" data-testid="jobs-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">Browse and manage job listings from all sources</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            className="pl-8 h-9 text-sm"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            data-testid="search-jobs"
          />
        </div>
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-9 text-xs" data-testid="filter-source">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="google_jobs">Google Jobs</SelectItem>
            <SelectItem value="indeed">Indeed</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-9 text-xs" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={seniority} onValueChange={(v) => { setSeniority(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-9 text-xs" data-testid="filter-seniority">
            <SelectValue placeholder="Seniority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="internship">Internship</SelectItem>
            <SelectItem value="associate">Associate</SelectItem>
            <SelectItem value="entry_level">Entry Level</SelectItem>
            <SelectItem value="mid_senior">Mid-Senior</SelectItem>
            <SelectItem value="director">Director</SelectItem>
            <SelectItem value="executive">Executive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto">
        <DataTable
          columns={[
            { header: "Title", accessor: "title" as keyof Job, className: "max-w-[250px] truncate font-medium" },
            { header: "Company", accessor: "company_name" as keyof Job },
            { header: "Location", accessor: (r: Job) => {
              const loc = r.location_raw || (r.location_city ? `${r.location_city}, ${r.location_country}` : r.location_country) || "—";
              return <span className="max-w-[150px] truncate block" title={loc}>{loc}</span>;
            }},
            { header: "Source", accessor: (r: Job) => <StatusBadge status={r.source} /> },
            { header: "Posted", accessor: (r: Job) => r.posted_at ? new Date(r.posted_at).toLocaleDateString() : "—" },
            { header: "Seniority", accessor: (r: Job) => r.seniority_level ? <Badge variant="outline" className="text-[11px]">{r.seniority_level}</Badge> : "—" },
            { header: "Enrichment", accessor: (r: Job) => <StatusBadge status={r.enrichment_status} /> },
            { header: "Status", accessor: (r: Job) => {
              if (!r.job_status) return <span className="text-xs text-muted-foreground">—</span>;
              const colors: Record<string, string> = {
                open: "text-green-600",
                closed: "text-red-600",
                unknown: "text-gray-400",
              };
              return (
                <div className="flex items-center gap-1">
                  <Circle className={`h-2 w-2 fill-current ${colors[r.job_status] || "text-gray-400"}`} />
                  <span className={`text-xs capitalize ${colors[r.job_status] || "text-gray-400"}`}>{r.job_status}</span>
                </div>
              );
            }},
            { header: "Link", accessor: (r: Job) => r.source_url ? (
              <a href={r.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-primary hover:text-primary/80">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : "—" },
          ]}
          data={data?.data ?? []}
          isLoading={isLoading}
          onRowClick={(row) => setSelectedJob(row)}
          emptyMessage="No jobs match your filters"
        />
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {((page - 1) * 50) + 1}-{Math.min(page * 50, data?.total ?? 0)} of {data?.total ?? 0}
          </span>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="px-3 py-1 rounded border disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <Sheet open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-lg">{jobDetail?.title || selectedJob?.title}</SheetTitle>
          </SheetHeader>
          {(jobDetail || selectedJob) && (
            <div className="space-y-4 mt-4">
              {/* Job Info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Job Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Company</span>
                    <span>{jobDetail?.company_name || selectedJob?.company_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span>{[jobDetail?.location_city, jobDetail?.location_country].filter(Boolean).join(", ") || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <StatusBadge status={jobDetail?.source || selectedJob?.source || ""} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Employment Type</span>
                    <span>{jobDetail?.employment_type?.replace(/_/g, " ") || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Seniority</span>
                    <span>{jobDetail?.seniority_level || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Enrichment</span>
                    <StatusBadge status={jobDetail?.enrichment_status || selectedJob?.enrichment_status || ""} />
                  </div>
                  {jobDetail?.salary_min && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Salary</span>
                      <span>
                        {jobDetail.salary_currency} {jobDetail.salary_min?.toLocaleString()}
                        {jobDetail.salary_max ? ` - ${jobDetail.salary_max.toLocaleString()}` : ""}
                      </span>
                    </div>
                  )}
                  {jobDetail?.source_url && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">URL</span>
                      <a href={jobDetail.source_url} target="_blank" rel="noreferrer" className="text-primary truncate max-w-[200px]">
                        View Original
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Job Description */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Job Description
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {jobDetail?.description ? (
                    <div className="max-h-[300px] overflow-y-auto">
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{jobDetail.description}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <FileText className="h-8 w-8 text-muted-foreground/40 mb-2" />
                      <p className="text-sm text-muted-foreground">No description available</p>
                      <p className="text-xs text-muted-foreground">Use "Fetch JD" to retrieve the job description</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Extracted Skills */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                    <Brain className="h-3 w-3" /> Extracted Skills ({jobDetail?.skills?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {jobDetail?.skills && jobDetail.skills.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {jobDetail.skills.map((skill: JobSkill) => (
                        <Badge
                          key={skill.id}
                          variant="secondary"
                          className="text-xs"
                          title={skill.confidence_score ? `Confidence: ${Math.round(skill.confidence_score * 100)}%` : undefined}
                        >
                          {skill.taxonomy_skill?.name || skill.skill_name}
                          {skill.category && (
                            <span className="ml-1 opacity-60 text-[10px]">({skill.category})</span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <Brain className="h-8 w-8 text-muted-foreground/40 mb-2" />
                      <p className="text-sm text-muted-foreground">No skills extracted</p>
                      <p className="text-xs text-muted-foreground">Use "Analyze JD" to extract skills</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Actions */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Actions</CardTitle>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={() => selectedJob?.id && fetchJdMutation.mutate(selectedJob.id)}
                    disabled={fetchJdMutation.isPending}
                  >
                    {fetchJdMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    Fetch JD
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs"
                    onClick={() => selectedJob?.id && analyzeJdMutation.mutate(selectedJob.id)}
                    disabled={analyzeJdMutation.isPending || !jobDetail?.description}
                  >
                    {analyzeJdMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    Analyze JD
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
