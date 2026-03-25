import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { KPICard } from "@/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck, Copy, Download, Play, Loader2, Search,
  BarChart3, Layers, FileDown, Network, Info, ChevronDown,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

const COLORS = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#10b981"];

interface QualityStats {
  total_jobs: number;
  duplicates: number;
  unique_jobs: number;
  avg_quality_score: number;
  distribution: Array<{ range: string; count: number }>;
}

interface DuplicateGroup {
  dedup_key: string;
  jobs: Array<{
    id: string;
    title: string;
    company_name: string;
    location_city: string;
    source: string;
    quality_score: number;
    is_duplicate: boolean;
    duplicate_of: string | null;
  }>;
}

interface CooccurrenceItem {
  skill_name: string;
  cooccurrence_count: number;
  pmi_score: number | null;
  jobs_with_skill: number;
}

interface CooccurrencePair {
  skill_a: string;
  skill_b: string;
  cooccurrence_count: number;
  pmi_score: number | null;
}

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader><Skeleton className="h-4 w-40" /></CardHeader>
      <CardContent><Skeleton className="w-full h-[300px]" /></CardContent>
    </Card>
  );
}

export default function DataQuality() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dupPage, setDupPage] = useState(1);
  const [skillSearch, setSkillSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const [exportSource, setExportSource] = useState("");
  const [exportCountry, setExportCountry] = useState("");
  const [exportStatus, setExportStatus] = useState("");

  // Data Quality Stats
  const { data: stats, isLoading: statsLoading } = useQuery<QualityStats>({
    queryKey: ["/api/data-quality/stats"],
    queryFn: async () => {
      const res = await authFetch("/api/data-quality/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  // Duplicate groups
  const { data: dupData, isLoading: dupLoading } = useQuery<{ data: DuplicateGroup[]; total: number }>({
    queryKey: ["/api/data-quality/duplicates", dupPage],
    queryFn: async () => {
      const res = await authFetch(`/api/data-quality/duplicates?page=${dupPage}&limit=10`);
      if (!res.ok) throw new Error("Failed to fetch duplicates");
      return res.json();
    },
  });

  // Co-occurrence data
  const { data: cooccurrence, isLoading: coocLoading } = useQuery<CooccurrenceItem[] | CooccurrencePair[]>({
    queryKey: ["/api/analytics/skill-cooccurrence", selectedSkill],
    queryFn: async () => {
      const url = selectedSkill
        ? `/api/analytics/skill-cooccurrence?skill_name=${encodeURIComponent(selectedSkill)}&limit=15`
        : "/api/analytics/skill-cooccurrence?limit=15";
      const res = await authFetch(url);
      if (!res.ok) throw new Error("Failed to fetch co-occurrence");
      return res.json();
    },
  });

  // Pipeline mutations
  const runQuality = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pipelines/run", { pipeline_type: "deduplication", config: {} });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pipeline started", description: "Quality scores & dedup pipeline triggered." });
      queryClient.invalidateQueries({ queryKey: ["/api/data-quality"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
    },
    onError: (err: Error) => {
      toast({ title: "Pipeline failed", description: err.message, variant: "destructive" });
    },
  });

  const runCooccurrence = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pipelines/run", { pipeline_type: "cooccurrence", config: {} });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pipeline started", description: "Skill co-occurrence pipeline triggered." });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/skill-cooccurrence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
    },
    onError: (err: Error) => {
      toast({ title: "Pipeline failed", description: err.message, variant: "destructive" });
    },
  });

  const handleExportJobs = async () => {
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (exportSource && exportSource !== "all") params.set("source", exportSource);
      if (exportCountry && exportCountry !== "all") params.set("country", exportCountry);
      if (exportStatus && exportStatus !== "all") params.set("enrichment_status", exportStatus);
      const res = await authFetch(`/api/export/jobs?${params}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexus_jobs_export_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export complete", description: "Jobs CSV downloaded." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const handleExportSkills = async () => {
    try {
      const res = await authFetch("/api/export/skills?min_frequency=2");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nexus_skills_export_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export complete", description: "Skills CSV downloaded." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  };

  const dupTotalPages = dupData ? Math.ceil(dupData.total / 10) : 1;

  return (
    <div className="space-y-6" data-testid="data-quality-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Data Quality</h1>
        <p className="text-sm text-muted-foreground">Quality scoring, deduplication, exports & skill co-occurrence</p>
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
            <p>• Quality scores (0-100) measure how complete each job record is</p>
            <p>• Score factors: has description, has skills, has location, has company, has salary, has employment type</p>
            <p>• Duplicate detection finds companies with similar normalized names</p>
            <p className="pt-1"><strong>Quality score breakdown:</strong></p>
            <p>• 0-20: Only basic info (title + source)</p>
            <p>• 21-40: Has company and location</p>
            <p>• 41-60: Has job description</p>
            <p>• 61-80: Has extracted skills</p>
            <p>• 81-100: Fully enriched with all fields</p>
            <p className="pt-1"><strong>Duplicate companies:</strong></p>
            <p>• Normalized names are compared (removes "Inc", "Ltd", spaces, etc.)</p>
            <p>• Groups of potential duplicates are shown for manual review</p>
            <p>• Merging keeps the record with more data and reassigns all jobs</p>
            <p className="pt-1"><strong>Limitations:</strong></p>
            <p>• Quality scores need to be recomputed after enrichment — run the "Data Quality & Dedup" pipeline</p>
            <p>• Duplicate detection is name-based only — "TCS" vs "Tata Consultancy Services" may not match</p>
            <p>• Merging is irreversible — review carefully before confirming</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* KPI Cards */}
      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : stats ? (
        <div className="grid gap-4 md:grid-cols-4">
          <KPICard title="Avg Quality Score" value={stats.avg_quality_score} subtitle="out of 100" icon={ShieldCheck} />
          <KPICard title="Total Duplicates" value={stats.duplicates} subtitle={`of ${stats.total_jobs} jobs`} icon={Copy} />
          <KPICard title="Unique Jobs" value={stats.unique_jobs} icon={Layers} />
          <KPICard title="Total Jobs" value={stats.total_jobs} icon={BarChart3} />
        </div>
      ) : null}

      {/* Quality Score Distribution */}
      {statsLoading ? <ChartSkeleton /> : stats ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Quality Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.distribution}>
                  <XAxis dataKey="range" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Jobs">
                    {stats.distribution.map((_, i) => (
                      <Cell key={i} fill={COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Pipeline Triggers */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Pipeline Actions</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm">Quality Scores & Dedup</CardTitle>
                  <p className="text-xs text-muted-foreground">Recompute quality scores and find duplicates</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full h-8 text-xs"
                onClick={() => runQuality.mutate()}
                disabled={runQuality.isPending}
                data-testid="run-deduplication"
              >
                {runQuality.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                {runQuality.isPending ? "Processing..." : "Run Quality & Dedup"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Network className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm">Skill Co-occurrence</CardTitle>
                  <p className="text-xs text-muted-foreground">Compute skill pair frequencies and PMI scores</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full h-8 text-xs"
                onClick={() => runCooccurrence.mutate()}
                disabled={runCooccurrence.isPending}
                data-testid="run-cooccurrence"
              >
                {runCooccurrence.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                {runCooccurrence.isPending ? "Processing..." : "Compute Co-occurrence"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-2">
                  <FileDown className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-sm">Export Data</CardTitle>
                  <p className="text-xs text-muted-foreground">Download jobs or skills as CSV</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-3 gap-1">
                <Select value={exportSource} onValueChange={setExportSource}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="clay_linkedin">Clay</SelectItem>
                    <SelectItem value="google_jobs">Google</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={exportCountry} onValueChange={setExportCountry}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Country" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="IN">India</SelectItem>
                    <SelectItem value="AE">UAE</SelectItem>
                    <SelectItem value="US">US</SelectItem>
                    <SelectItem value="GB">UK</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={exportStatus} onValueChange={setExportStatus}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-7 text-xs" onClick={handleExportJobs} data-testid="export-jobs">
                  <Download className="h-3 w-3 mr-1" /> Jobs CSV
                </Button>
                <Button variant="outline" className="flex-1 h-7 text-xs" onClick={handleExportSkills} data-testid="export-skills">
                  <Download className="h-3 w-3 mr-1" /> Skills CSV
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Duplicate Groups */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Duplicate Groups ({dupData?.total || 0} groups)</CardTitle>
        </CardHeader>
        <CardContent>
          {dupLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : (dupData?.data || []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No duplicate groups found. Run the dedup pipeline first.</p>
          ) : (
            <div className="space-y-3">
              {(dupData?.data || []).map((group, gi) => (
                <div key={gi} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-[10px]">Group {(dupPage - 1) * 10 + gi + 1}</Badge>
                    <span className="text-xs text-muted-foreground">{group.jobs.length} jobs</span>
                  </div>
                  {group.jobs.map((job, ji) => (
                    <div key={job.id} className={`flex items-center gap-3 text-xs py-1 ${ji === 0 ? "font-medium" : "text-muted-foreground"}`}>
                      <Badge variant={ji === 0 ? "default" : "secondary"} className="text-[10px]">
                        {ji === 0 ? "Keep" : "Duplicate"}
                      </Badge>
                      <span className="truncate flex-1">{job.title || "Untitled"}</span>
                      <span className="truncate max-w-[120px]">{job.company_name || ""}</span>
                      <span>{job.source}</span>
                      <span>Q: {job.quality_score}</span>
                    </div>
                  ))}
                </div>
              ))}
              {dupTotalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground mt-4">
                  <span>Page {dupPage} of {dupTotalPages}</span>
                  <div className="flex gap-2">
                    <button className="px-3 py-1 rounded border disabled:opacity-50" disabled={dupPage <= 1} onClick={() => setDupPage(p => p - 1)}>Previous</button>
                    <button className="px-3 py-1 rounded border disabled:opacity-50" disabled={dupPage >= dupTotalPages} onClick={() => setDupPage(p => p + 1)}>Next</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Skill Co-occurrence */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Skill Co-occurrence</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-xs w-48"
                placeholder="Search skill..."
                value={skillSearch}
                onChange={(e) => setSkillSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setSelectedSkill(skillSearch)}
              />
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSelectedSkill(skillSearch)}>
                <Search className="h-3 w-3 mr-1" /> Search
              </Button>
              {selectedSkill && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSelectedSkill(""); setSkillSearch(""); }}>
                  Clear
                </Button>
              )}
            </div>
          </div>
          {selectedSkill && <p className="text-xs text-muted-foreground mt-1">Top skills co-occurring with "{selectedSkill}"</p>}
        </CardHeader>
        <CardContent>
          {coocLoading ? (
            <Skeleton className="w-full h-[300px]" />
          ) : (cooccurrence as any[])?.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No co-occurrence data. Run the co-occurrence pipeline first.</p>
          ) : selectedSkill ? (
            <div className="space-y-4">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(cooccurrence as CooccurrenceItem[])?.slice(0, 15)}
                    layout="vertical"
                    margin={{ left: 120 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="skill_name" tick={{ fontSize: 11 }} width={110} />
                    <Tooltip />
                    <Bar dataKey="cooccurrence_count" name="Co-occurrences" fill="#6366f1" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Skill</th>
                      <th className="text-right p-2 font-medium">Co-occurrences</th>
                      <th className="text-right p-2 font-medium">PMI Score</th>
                      <th className="text-right p-2 font-medium">Jobs w/ Skill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(cooccurrence as CooccurrenceItem[])?.map((item, i) => (
                      <tr key={i} className="border-t hover:bg-muted/30">
                        <td className="p-2">{item.skill_name}</td>
                        <td className="p-2 text-right">{item.cooccurrence_count}</td>
                        <td className="p-2 text-right">{item.pmi_score ?? "—"}</td>
                        <td className="p-2 text-right">{item.jobs_with_skill}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">Skill A</th>
                    <th className="text-left p-2 font-medium">Skill B</th>
                    <th className="text-right p-2 font-medium">Co-occurrences</th>
                    <th className="text-right p-2 font-medium">PMI Score</th>
                  </tr>
                </thead>
                <tbody>
                  {(cooccurrence as CooccurrencePair[])?.map((pair, i) => (
                    <tr key={i} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => { setSelectedSkill(pair.skill_a); setSkillSearch(pair.skill_a); }}>
                      <td className="p-2">{pair.skill_a}</td>
                      <td className="p-2">{pair.skill_b}</td>
                      <td className="p-2 text-right">{pair.cooccurrence_count}</td>
                      <td className="p-2 text-right">{pair.pmi_score ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
