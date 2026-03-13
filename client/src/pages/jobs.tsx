import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";
import type { Job } from "@shared/schema";

export default function Jobs() {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [seniority, setSeniority] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "50");
  if (search) params.set("search", search);
  if (source !== "all") params.set("source", source);
  if (status !== "all") params.set("enrichment_status", status);
  if (seniority !== "all") params.set("seniority", seniority);

  const { data, isLoading } = useQuery<{ data: Job[]; total: number }>({
    queryKey: ["/api/jobs", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  const { data: jobDetail } = useQuery<Job>({
    queryKey: ["/api/jobs", selectedJob?.id],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${selectedJob!.id}`);
      if (!res.ok) throw new Error("Failed to fetch job");
      return res.json();
    },
    enabled: !!selectedJob?.id,
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
            <SelectItem value="complete">Complete</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={seniority} onValueChange={(v) => { setSeniority(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-9 text-xs" data-testid="filter-seniority">
            <SelectValue placeholder="Seniority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="entry">Entry</SelectItem>
            <SelectItem value="mid">Mid</SelectItem>
            <SelectItem value="senior">Senior</SelectItem>
            <SelectItem value="lead">Lead</SelectItem>
            <SelectItem value="director">Director</SelectItem>
            <SelectItem value="executive">Executive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={[
          { header: "Title", accessor: "title" as keyof Job, className: "max-w-[250px] truncate font-medium" },
          { header: "Company", accessor: "company_name" as keyof Job },
          { header: "Location", accessor: (r: Job) => r.location_city ? `${r.location_city}, ${r.location_country}` : r.location_country || "—" },
          { header: "Source", accessor: (r: Job) => <StatusBadge status={r.source} /> },
          { header: "Seniority", accessor: (r: Job) => r.seniority_level ? <Badge variant="outline" className="text-[11px]">{r.seniority_level}</Badge> : "—" },
          { header: "Posted", accessor: (r: Job) => r.posted_at ? new Date(r.posted_at).toLocaleDateString() : "—" },
          { header: "Status", accessor: (r: Job) => <StatusBadge status={r.enrichment_status} /> },
        ]}
        data={data?.data ?? []}
        isLoading={isLoading}
        onRowClick={(row) => setSelectedJob(row)}
        emptyMessage="No jobs match your filters"
      />

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
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Company</span>
                    <span>{jobDetail?.company_name || selectedJob?.company_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span>{jobDetail?.location_city}, {jobDetail?.location_country}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <StatusBadge status={jobDetail?.source || selectedJob?.source || ""} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Employment Type</span>
                    <span>{jobDetail?.employment_type || "—"}</span>
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
              {jobDetail?.description && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase">Description</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{jobDetail.description}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
