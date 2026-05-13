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
import { Search, ExternalLink, Circle, FileText, Brain, Download, Play, Loader2, Info, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  // Read URL params for deep-linking from pipeline runs
  const urlParams = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(urlParams.get("search") || "");
  const [source, setSource] = useState(urlParams.get("source") || "all");
  const [status, setStatus] = useState(urlParams.get("status") || "all");
  const [seniority, setSeniority] = useState("all");
  const [addedDate, setAddedDate] = useState(urlParams.get("added") || "all");
  const [page, setPage] = useState(1);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Compute added_after based on selection
  const getAddedAfter = () => {
    if (addedDate === "all") return undefined;
    const now = new Date();
    if (addedDate === "1h") return new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    if (addedDate === "today") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
    if (addedDate === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    if (addedDate === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (addedDate === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // ISO date string passed directly (from pipeline run link)
    if (addedDate.includes("T") || addedDate.includes("-")) return addedDate;
    return undefined;
  };

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "50");
  if (search) params.set("search", search);
  if (source !== "all") params.set("source", source);
  if (status !== "all") params.set("enrichment_status", status);
  if (seniority !== "all") params.set("seniority_level", seniority);
  const addedAfter = getAddedAfter();
  if (addedAfter) params.set("added_after", addedAfter);

  const { data, isLoading } = useQuery<{ data: Job[]; total: number }>({
    queryKey: ["/api/jobs", params.toString()],
    queryFn: async () => {
      const res = await authFetch(`/api/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  const { data: jobDetail } = useQuery<Job & {
    skills?: JobSkill[];
    mapped_role?: { id: string; name: string } | null;
    mapped_bucket?: { id: string; name: string } | null;
    role_match_score?: number | null;
    discovery_source?: string | null;
    last_seen_at?: string | null;
    jd_fetch_status?: string | null;
  }>({
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

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
          <span>How this works</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
            <p><strong>How this works:</strong></p>
            <p>• Jobs are ingested from LinkedIn, Google Jobs, Indeed, or CSV upload</p>
            <p>• Each job goes through a pipeline: Ingest → Fetch JD → Analyze JD (extract skills)</p>
            <p>• Click any job to see its description, extracted skills, and trigger Fetch/Analyze actions</p>
            <p>• Filters: Source (where the job came from), Status (enrichment state), Seniority, Employment Type</p>
            <p className="pt-1"><strong>Data pipeline:</strong></p>
            <p>1. "Pending" = just ingested, no JD text yet</p>
            <p>2. "JD Fetched" = description retrieved from the source URL</p>
            <p>3. "Analyzed" = AI has extracted skills, seniority, and structured data</p>
            <p className="pt-1"><strong>Limitations:</strong></p>
            <p>• JD fetch depends on the source URL being accessible — some expire after 30 days</p>
            <p>• Skill extraction accuracy is ~65-85% for technical skills, lower for soft skills</p>
            <p>• Employment type is often missing from LinkedIn scrapes — shows "—"</p>
            <p>• Search matches job title and company name only</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

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
        <Select value={addedDate} onValueChange={(v) => { setAddedDate(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-9 text-xs">
            <SelectValue placeholder="Added Date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="1h">Last Hour</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="24h">Last 24 Hours</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto">
        <DataTable
          columns={[
            { header: "Title", accessor: "title" as keyof Job, className: "max-w-[220px] truncate font-medium" },
            { header: "Company", accessor: (r: Job) => <span className="max-w-[120px] truncate block" title={r.company_name || ""}>{r.company_name || "—"}</span>, className: "max-w-[120px]" },
            { header: "Location", accessor: (r: Job) => {
              const loc = r.location_raw || (r.location_city ? `${r.location_city}, ${r.location_country}` : r.location_country) || "—";
              return <span className="max-w-[130px] truncate block" title={loc}>{loc}</span>;
            }, className: "max-w-[130px]" },
            { header: "Source", accessor: (r: Job) => (
              <div className="flex flex-col gap-0.5">
                <StatusBadge status={r.source} />
                {r.job_publisher && <span className="text-[9px] text-muted-foreground truncate max-w-[80px]" title={r.job_publisher}>{r.job_publisher}</span>}
              </div>
            ), className: "w-[85px]" },
            { header: "Added", accessor: (r: Job) => r.created_at ? <span className="whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}<br/><span className="text-muted-foreground">{new Date(r.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></span> : "—", className: "w-[75px]" },
            { header: "Seniority", accessor: (r: Job) => r.seniority_level ? <Badge variant="outline" className="text-[10px] whitespace-nowrap">{r.seniority_level}</Badge> : "—", className: "w-[85px]" },
            { header: "Enrichment", accessor: (r: Job) => <StatusBadge status={r.enrichment_status} />, className: "w-[80px]" },
            { header: "Status", accessor: (r: Job) => {
              if (!r.job_status) return <span className="text-xs text-muted-foreground">—</span>;
              const colors: Record<string, string> = {
                open: "text-green-600",
                closed: "text-red-600",
                unknown: "text-gray-400",
              };
              return (
                <div className="flex items-center gap-1 whitespace-nowrap">
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
              {/* Intelligence — Nexus mapping, scoring, discovery signals */}
              {(jobDetail?.mapped_role || jobDetail?.mapped_bucket || jobDetail?.role_match_score != null || jobDetail?.discovery_source || jobDetail?.last_seen_at || jobDetail?.jd_fetch_status) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                      <Brain className="h-3 w-3" /> Intelligence
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {jobDetail?.mapped_role && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mapped Role</span>
                        <span className="text-right">{jobDetail.mapped_role.name}</span>
                      </div>
                    )}
                    {jobDetail?.role_match_score != null && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Match Score</span>
                        <div className="flex items-center gap-2 flex-1 max-w-[180px]">
                          <div className="h-1.5 flex-1 rounded bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(100, Math.max(0, Math.round(Number(jobDetail.role_match_score) * 100)))}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono">{Math.round(Number(jobDetail.role_match_score) * 100)}%</span>
                        </div>
                      </div>
                    )}
                    {jobDetail?.mapped_bucket && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mapped Bucket</span>
                        <span className="text-right">{jobDetail.mapped_bucket.name}</span>
                      </div>
                    )}
                    {jobDetail?.discovery_source && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Discovery Source</span>
                        <Badge variant="outline" className="text-[10px]">{jobDetail.discovery_source}</Badge>
                      </div>
                    )}
                    {jobDetail?.jd_fetch_status && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">JD Status</span>
                        <StatusBadge status={jobDetail.jd_fetch_status} />
                      </div>
                    )}
                    {jobDetail?.last_seen_at && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Seen</span>
                        <span className="text-right text-xs">{new Date(jobDetail.last_seen_at).toLocaleDateString()}</span>
                      </div>
                    )}
                    {jobDetail?.posted_at && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Posted</span>
                        <span className="text-right text-xs">{new Date(jobDetail.posted_at).toLocaleDateString()}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

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
                  {jobDetail?.is_remote && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Remote</span>
                      <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">Remote</Badge>
                    </div>
                  )}
                  {jobDetail?.job_publisher && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Publisher</span>
                      <span>{jobDetail.job_publisher}</span>
                    </div>
                  )}
                  {jobDetail?.apply_platforms && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Available On</span>
                      <span className="text-right text-xs max-w-[200px]">{jobDetail.apply_platforms}</span>
                    </div>
                  )}
                  {(jobDetail?.salary_text || jobDetail?.salary_min) && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Salary</span>
                      <span>
                        {jobDetail.salary_text || (
                          <>{jobDetail.salary_currency} {jobDetail.salary_min?.toLocaleString()}
                          {jobDetail.salary_max ? ` - ${jobDetail.salary_max.toLocaleString()}` : ""}
                          {jobDetail.salary_unit ? ` / ${jobDetail.salary_unit}` : ""}</>)}
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
                  {jobDetail?.application_url && jobDetail.application_url !== jobDetail.source_url && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Apply</span>
                      <a href={jobDetail.application_url} target="_blank" rel="noreferrer" className="text-primary truncate max-w-[200px]">
                        Apply Link
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Qualifications */}
              {jobDetail?.qualifications && jobDetail.qualifications.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase">Qualifications</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      {jobDetail.qualifications.map((q: string, i: number) => <li key={i}>{q}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Responsibilities */}
              {jobDetail?.responsibilities && jobDetail.responsibilities.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase">Responsibilities</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      {jobDetail.responsibilities.map((r: string, i: number) => <li key={i}>{r}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Benefits */}
              {jobDetail?.benefits && jobDetail.benefits.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase">Benefits</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {jobDetail.benefits.map((b: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">{b}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

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
