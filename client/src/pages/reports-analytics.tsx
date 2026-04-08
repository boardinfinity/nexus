import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  AreaChart, Area, ResponsiveContainer, Cell,
} from "recharts";

const SIGNAL_COLORS: Record<string, string> = {
  growing: "#16a34a",
  emerging: "#0891b2",
  stable: "#6b7280",
  declining: "#dc2626",
};

const CATEGORY_COLORS: Record<string, string> = {
  skills: "bg-blue-100 text-blue-800",
  technology: "bg-purple-100 text-purple-800",
  labor_market: "bg-amber-100 text-amber-800",
  salary: "bg-green-100 text-green-800",
  education: "bg-cyan-100 text-cyan-800",
  regional: "bg-orange-100 text-orange-800",
};

interface OverviewData {
  total_reports: number;
  unique_skills: number;
  total_findings: number;
  year_min: number | null;
  year_max: number | null;
  growing_signals: number;
  declining_signals: number;
  source_count: number;
}

interface SkillRow {
  skill_name: string;
  total_mentions: number;
  source_count: number;
  report_count: number;
  growing_count: number;
  declining_count: number;
  emerging_count: number;
  stable_count: number;
  dominant_signal: string;
  sources: string[];
  sample_data_point: string | null;
}

interface TimelineRow {
  year: number;
  rising_count: number;
  declining_count: number;
  total_count: number;
  reports: string[];
}

interface FindingRow {
  report_id: string;
  report_title: string;
  source_org: string;
  report_year: number;
  region: string | null;
  finding: string;
  category: string;
  confidence: number;
}

interface SourceRow {
  source_org: string;
  report_count: number;
  year_min: number | null;
  year_max: number | null;
  top_skills: string[];
  skill_count: number;
}

export function ReportsAnalytics() {
  const [skillFilter, setSkillFilter] = useState("all");
  const [findingsCategory, setFindingsCategory] = useState("all");
  const [findingsSource, setFindingsSource] = useState("all");
  const [findingsMinConf, setFindingsMinConf] = useState("0");
  const [findingsSearch, setFindingsSearch] = useState("");

  const { data: overview, isLoading: loadingOverview } = useQuery<OverviewData>({
    queryKey: ["/api/reports/analytics", "overview"],
    queryFn: () => authFetch("/api/reports/analytics?section=overview").then(r => r.json()),
  });

  const { data: skills, isLoading: loadingSkills } = useQuery<SkillRow[]>({
    queryKey: ["/api/reports/analytics", "skills", skillFilter],
    queryFn: () =>
      authFetch(`/api/reports/analytics?section=skills${skillFilter !== "all" ? `&filter=${skillFilter}` : ""}`).then(r => r.json()),
  });

  const { data: timeline, isLoading: loadingTimeline } = useQuery<TimelineRow[]>({
    queryKey: ["/api/reports/analytics", "timeline"],
    queryFn: () => authFetch("/api/reports/analytics?section=timeline").then(r => r.json()),
  });

  const { data: findings, isLoading: loadingFindings } = useQuery<FindingRow[]>({
    queryKey: ["/api/reports/analytics", "findings", findingsCategory, findingsSource, findingsMinConf],
    queryFn: () => {
      const params = new URLSearchParams({ section: "findings" });
      if (findingsCategory !== "all") params.set("category", findingsCategory);
      if (findingsSource !== "all") params.set("source", findingsSource);
      if (findingsMinConf !== "0") params.set("min_confidence", findingsMinConf);
      return authFetch(`/api/reports/analytics?${params}`).then(r => r.json());
    },
  });

  const { data: sources, isLoading: loadingSources } = useQuery<SourceRow[]>({
    queryKey: ["/api/reports/analytics", "sources"],
    queryFn: () => authFetch("/api/reports/analytics?section=sources").then(r => r.json()),
  });

  const filteredFindings = useMemo(() => {
    if (!findings) return [];
    if (!findingsSearch) return findings;
    const q = findingsSearch.toLowerCase();
    return findings.filter(f => f.finding?.toLowerCase().includes(q) || f.source_org?.toLowerCase().includes(q));
  }, [findings, findingsSearch]);

  const uniqueSources = useMemo(() => {
    if (!findings) return [];
    return Array.from(new Set(findings.map(f => f.source_org).filter(Boolean))).sort();
  }, [findings]);

  const chartData = useMemo(() => {
    if (!skills) return [];
    return [...skills].sort((a, b) => a.source_count - b.source_count).slice(-30);
  }, [skills]);

  const hasData = overview && (overview.total_reports > 0);

  if (!hasData && !loadingOverview) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-lg font-medium text-muted-foreground">No completed reports yet</p>
        <p className="text-sm text-muted-foreground mt-1">Upload and process reports to see analytics</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4">
        {loadingOverview ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><div className="h-8 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{overview?.total_reports ?? "-"}</div>
                <p className="text-xs text-muted-foreground">Reports Analyzed</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{overview?.unique_skills ?? "-"}</div>
                <p className="text-xs text-muted-foreground">Skills Tracked</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{overview?.total_findings ?? "-"}</div>
                <p className="text-xs text-muted-foreground">Key Findings</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">
                  {overview?.year_min && overview?.year_max
                    ? `${overview.year_min} – ${overview.year_max}`
                    : "-"}
                </div>
                <p className="text-xs text-muted-foreground">Year Range</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Signal Summary Row */}
      {overview && (
        <div className="flex gap-6 text-sm">
          <span className="text-green-600 font-medium">↑ {overview.growing_signals} Rising Signals</span>
          <span className="text-red-600 font-medium">↓ {overview.declining_signals} Declining Signals</span>
          <span className="text-blue-600 font-medium">{overview.source_count} Sources Analyzed</span>
        </div>
      )}

      {/* Skill Consensus Section */}
      <Card>
        <CardHeader>
          <CardTitle>Skill Consensus Across Reports</CardTitle>
          <CardDescription>Skills mentioned by the most independent research organizations</CardDescription>
          <div className="flex gap-2 pt-2">
            {["all", "growing", "emerging", "stable", "declining"].map(f => (
              <Button
                key={f}
                size="sm"
                variant={skillFilter === f ? "default" : "outline"}
                onClick={() => setSkillFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loadingSkills ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>
          ) : chartData.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">No skill data</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(400, chartData.length * 28)}>
              <BarChart layout="vertical" data={chartData} margin={{ left: 120, right: 40, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="skill_name" width={110} tick={{ fontSize: 12 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload as SkillRow;
                    return (
                      <div className="bg-background border rounded-lg p-3 shadow-lg text-sm max-w-xs">
                        <p className="font-semibold">{d.skill_name}</p>
                        <p className="text-muted-foreground">{d.sources?.join(", ")}</p>
                        {d.sample_data_point && <p className="text-xs mt-1 italic">{d.sample_data_point}</p>}
                        <div className="flex gap-3 mt-1 text-xs">
                          <span className="text-green-600">↑{d.growing_count}</span>
                          <span className="text-cyan-600">★{d.emerging_count}</span>
                          <span className="text-gray-500">●{d.stable_count}</span>
                          <span className="text-red-600">↓{d.declining_count}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="source_count" name="Sources" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={SIGNAL_COLORS[entry.dominant_signal] || SIGNAL_COLORS.stable} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Rising vs Declining */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-green-600">↑ Rising Skills</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSkills ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : (
              (skills || [])
                .filter(s => s.dominant_signal === "growing" || s.dominant_signal === "emerging")
                .slice(0, 15)
                .map(s => (
                  <div key={s.skill_name} className="flex items-start justify-between py-2 border-b last:border-0">
                    <div>
                      <span className="font-medium text-sm">{s.skill_name}</span>
                      {s.sample_data_point && (
                        <p className="text-xs text-muted-foreground">{s.sample_data_point}</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs ml-2 shrink-0">{s.source_count} sources</Badge>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">↓ Declining Skills</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSkills ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : (
              (skills || [])
                .filter(s => s.dominant_signal === "declining")
                .slice(0, 15)
                .map(s => (
                  <div key={s.skill_name} className="flex items-start justify-between py-2 border-b last:border-0">
                    <div>
                      <span className="font-medium text-sm">{s.skill_name}</span>
                      {s.sample_data_point && (
                        <p className="text-xs text-muted-foreground">{s.sample_data_point}</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs ml-2 shrink-0">{s.source_count} sources</Badge>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Timeline Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Skill Signals Timeline</CardTitle>
          <CardDescription>Rising vs declining signals across report years</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTimeline ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">Loading...</div>
          ) : !timeline?.length ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">No timeline data</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={[...timeline].sort((a, b) => a.year - b.year)} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as TimelineRow;
                    return (
                      <div className="bg-background border rounded-lg p-3 shadow-lg text-sm">
                        <p className="font-semibold">{label}</p>
                        <p className="text-green-600">Rising: {row.rising_count}</p>
                        <p className="text-red-600">Declining: {row.declining_count}</p>
                        {row.reports?.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">{row.reports.join(", ")}</p>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend />
                <Area type="monotone" dataKey="rising_count" name="Rising Signals" fill="#d1fae5" stroke="#16a34a" fillOpacity={0.6} />
                <Area type="monotone" dataKey="declining_count" name="Declining Signals" fill="#fee2e2" stroke="#dc2626" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Source Intelligence Cards */}
      <Card>
        <CardHeader>
          <CardTitle>Source Intelligence</CardTitle>
          <CardDescription>Research organizations contributing to the knowledge base</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingSources ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !sources?.length ? (
            <p className="text-muted-foreground">No source data</p>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {sources.map(s => (
                <div
                  key={s.source_org}
                  className="min-w-[220px] max-w-[260px] border rounded-lg p-4 shrink-0"
                >
                  <p className="font-bold text-sm">{s.source_org}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {s.report_count} reports | {s.year_min ?? "?"}-{s.year_max ?? "?"}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(s.top_skills || []).filter(Boolean).map(sk => (
                      <Badge key={sk} variant="secondary" className="text-xs">{sk}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{s.skill_count} skills tracked</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Key Findings Explorer */}
      <Card>
        <CardHeader>
          <CardTitle>Key Findings Explorer</CardTitle>
          <CardDescription>Searchable findings extracted from all completed reports</CardDescription>
          <div className="flex flex-wrap gap-3 pt-2">
            <Input
              placeholder="Search findings..."
              value={findingsSearch}
              onChange={e => setFindingsSearch(e.target.value)}
              className="w-56"
            />
            <Select value={findingsCategory} onValueChange={setFindingsCategory}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="skills">Skills</SelectItem>
                <SelectItem value="technology">Technology</SelectItem>
                <SelectItem value="labor_market">Labor Market</SelectItem>
                <SelectItem value="salary">Salary</SelectItem>
                <SelectItem value="education">Education</SelectItem>
                <SelectItem value="regional">Regional</SelectItem>
              </SelectContent>
            </Select>
            <Select value={findingsSource} onValueChange={setFindingsSource}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {uniqueSources.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={findingsMinConf} onValueChange={setFindingsMinConf}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Confidence" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Any</SelectItem>
                <SelectItem value="0.7">70%+</SelectItem>
                <SelectItem value="0.8">80%+</SelectItem>
                <SelectItem value="0.9">90%+</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loadingFindings ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !filteredFindings.length ? (
            <p className="text-muted-foreground">No findings match your filters</p>
          ) : (
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {filteredFindings.map((f, i) => (
                <div key={i} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" title={f.finding}>
                      {f.finding?.length > 120 ? f.finding.slice(0, 120) + "…" : f.finding}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {f.source_org} | {f.report_year}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs shrink-0 ${CATEGORY_COLORS[f.category] || ""}`}
                  >
                    {f.category}
                  </Badge>
                  <span className="text-xs text-muted-foreground shrink-0 w-10 text-right">
                    {f.confidence != null ? `${Math.round(f.confidence * 100)}%` : "-"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
