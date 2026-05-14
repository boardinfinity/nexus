/**
 * College Dashboard — Phase 0 v0 demo (UOWD)
 *
 * Single-fetch consolidated view across 8 panels. Renders the API response
 * from `/api/college-dashboard/:id` (authenticated) or
 * `/api/public/college-dashboard/by-slug/:slug` (public demo).
 *
 * Honest data-quality tags surfaced on every panel:
 *   live           — direct from primary tables
 *   live_partial   — direct but limited (e.g. demand from reports, not jobs)
 *   illustrative   — synthetic / placeholder (none in v0)
 */
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import LiveJobsSection from "./college-dashboard-live-jobs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, GraduationCap, Briefcase, Building2, Users, MapPin,
  TrendingUp, AlertTriangle, Sparkles, Globe2, BookOpen, Upload,
} from "lucide-react";

// ── Types matching the API shape ─────────────────────────────────────
type DataQuality = "live" | "live_partial" | "illustrative";

interface Panel<T> {
  data_quality: DataQuality;
  note?: string;
  data: T;
}

interface DashboardPayload {
  college_id: string;
  generated_at: string;
  view?: "public_demo";
  slug?: string;
  panels: {
    hero: Panel<{
      college: any;
      counts: {
        programs: number;
        courses: number;
        mapped_skills: number;
        alumni: number;
        college_jobs: number;
        campus_drives: number;
      };
    }>;
    programs: Panel<{ items: any[]; total: number }>;
    uae_jobs: Panel<{
      total_jobs: number;
      by_country: Record<string, number>;
      top_companies: Array<{ name: string; count: number }>;
    }>;
    top_skills: Panel<{
      items: Array<{ taxonomy_skill_id: string; name: string; count: number }>;
      source: string;
    }>;
    college_jobs: Panel<{
      drives: number;
      total_jds: number;
      job_type_mix: Record<string, number>;
      ctc_tag_mix: Record<string, number>;
      top_recruiters: Array<{ name: string; count: number }>;
      recent_batches: any[];
    }>;
    alumni: Panel<{
      total: number;
      sample_size: number;
      country_distribution: Array<{ name: string; count: number }>;
      sample_headlines: Array<{ title: string; country: string | null }>;
    }>;
    gap_heatmap: Panel<{
      programs: Array<{ id: string; name: string }>;
      skills: Array<{ id: string; name: string; demand_score: number }>;
      cells: Array<{
        program_id: string;
        program_name: string;
        skill_id: string;
        skill_name: string;
        demand_score: number;
        coverage_courses: number;
      }>;
    }>;
    exec_summary: Panel<{
      strengths: Array<{ skill: string; demand: number; coverage: number }>;
      gaps: Array<{ skill: string; demand: number; coverage: number }>;
      emerging: Array<{ skill: string; demand: number; coverage: number }>;
    }>;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────
function qualityChip(q: DataQuality) {
  const cfg = {
    live:          { label: "Live",           cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    live_partial:  { label: "Live · Partial", cls: "bg-amber-100 text-amber-800 border-amber-200" },
    illustrative:  { label: "Illustrative",   cls: "bg-slate-100 text-slate-700 border-slate-200" },
  }[q];
  return (
    <Badge variant="outline" className={`text-[10px] font-medium ${cfg.cls}`} data-testid={`chip-quality-${q}`}>
      {cfg.label}
    </Badge>
  );
}

function panelHeader(title: string, icon: React.ReactNode, q: DataQuality, note?: string) {
  return (
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-slate-500">{icon}</div>
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
        </div>
        {qualityChip(q)}
      </div>
      {note && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{note}</p>}
    </CardHeader>
  );
}

function num(n: number) {
  return new Intl.NumberFormat("en-IN").format(n || 0);
}

// Heatmap cell color (green → amber → red by ratio of demand:coverage)
function heatColor(demand: number, coverage: number, maxDemand: number) {
  if (demand === 0) return "bg-slate-50";
  if (coverage === 0) {
    // Pure gap. Red scaled by demand intensity.
    const intensity = Math.min(1, demand / maxDemand);
    if (intensity > 0.66) return "bg-rose-300";
    if (intensity > 0.33) return "bg-rose-200";
    return "bg-rose-100";
  }
  // Covered. Green scaled by coverage breadth.
  if (coverage >= 4) return "bg-emerald-300";
  if (coverage >= 2) return "bg-emerald-200";
  return "bg-emerald-100";
}

// ── Page ──────────────────────────────────────────────────────────────
interface Props {
  params: { id?: string; slug?: string };
  publicSlug?: string;
}

export default function CollegeDashboard({ params, publicSlug }: Props) {
  // Public demo mode: hit the by-slug endpoint, no auth needed.
  const slug = publicSlug || params.slug;
  const isPublic = Boolean(slug);

  const url = isPublic
    ? `/api/public/college-dashboard/by-slug/${slug}`
    : `/api/college-dashboard/${params.id}`;

  const { data, isLoading, error } = useQuery<DashboardPayload>({
    queryKey: [url],
    queryFn: async () => {
      // For public route, skip auth headers; for authed route, use authFetch.
      const res = isPublic ? await fetch(url) : await authFetch(url);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Could not load dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">{(error as Error)?.message || "Unknown error"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { panels } = data;
  const hero = panels.hero.data;
  const college = hero.college || {};
  const counts = hero.counts || {};

  // Build heatmap lookup
  const skills = panels.gap_heatmap.data.skills || [];
  const programs = panels.gap_heatmap.data.programs || [];
  const cells = panels.gap_heatmap.data.cells || [];
  const cellMap: Record<string, { demand: number; coverage: number }> = {};
  cells.forEach((c) => {
    cellMap[`${c.program_id}::${c.skill_id}`] = { demand: c.demand_score, coverage: c.coverage_courses };
  });
  const maxDemand = skills.reduce((m, s) => Math.max(m, s.demand_score || 0), 0) || 1;

  // For public demo, layout without sidebar padding (RootRouter standalone)
  const containerCls = isPublic
    ? "min-h-screen bg-slate-50 px-4 sm:px-8 py-8 max-w-[1400px] mx-auto"
    : "space-y-6 max-w-[1400px] mx-auto";

  return (
    <div className={containerCls} data-testid="page-college-dashboard">
      {/* Public-demo banner */}
      {isPublic && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-white border px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" />
            <span className="text-sm font-medium text-slate-800">Board Infinity Nexus · Skill Intelligence Preview</span>
          </div>
          <span className="text-xs text-slate-500">
            Last refreshed {new Date(data.generated_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        </div>
      )}

      {/* Hero card */}
      <Card className="mb-4 overflow-hidden border-slate-200">
        <div className="bg-gradient-to-r from-violet-600 to-indigo-700 text-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-violet-100 text-xs uppercase tracking-wider mb-1">
                <GraduationCap className="h-4 w-4" />
                College Skill Intelligence Dashboard
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold leading-tight" data-testid="text-college-name">
                {college.name || "College"}
              </h1>
              <div className="flex items-center gap-3 text-violet-100 text-sm mt-1">
                {college.short_name && <span>{college.short_name}</span>}
                {college.city && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {college.city}{college.country ? `, ${college.country}` : ""}
                  </span>
                )}
                {college.tier && <Badge variant="secondary" className="bg-white/20 text-white border-white/30">{college.tier}</Badge>}
              </div>
            </div>
            {qualityChip(panels.hero.data_quality)}
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-6">
            {[
              { label: "Programs",      v: counts.programs,      icon: BookOpen },
              { label: "Courses",       v: counts.courses,       icon: BookOpen },
              { label: "Mapped Skills", v: counts.mapped_skills, icon: Sparkles },
              { label: "Alumni",        v: counts.alumni,        icon: Users },
              { label: "College Jobs",  v: counts.college_jobs,  icon: Briefcase },
              { label: "Drives",        v: counts.campus_drives, icon: Upload },
            ].map((s) => (
              <div key={s.label} className="bg-white/10 rounded-lg px-3 py-2.5 backdrop-blur-sm" data-testid={`stat-${s.label.toLowerCase().replace(/ /g, "-")}`}>
                <div className="flex items-center gap-1.5 text-violet-100 text-[10px] uppercase tracking-wide mb-1">
                  <s.icon className="h-3 w-3" /> {s.label}
                </div>
                <div className="text-xl font-semibold">{num(s.v)}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Exec summary — strengths/gaps/emerging */}
        <Card className="lg:col-span-2 border-slate-200">
          {panelHeader(
            "Executive summary — top strengths, gaps & emerging needs",
            <TrendingUp className="h-4 w-4" />,
            panels.exec_summary.data_quality,
          )}
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-0">
            <ExecBlock
              title="Strengths"
              tone="emerald"
              icon={<Sparkles className="h-4 w-4 text-emerald-700" />}
              items={panels.exec_summary.data.strengths}
              emptyMsg="No clear strengths yet — extraction pending."
            />
            <ExecBlock
              title="Critical gaps"
              tone="rose"
              icon={<AlertTriangle className="h-4 w-4 text-rose-700" />}
              items={panels.exec_summary.data.gaps}
              emptyMsg="No critical gaps detected — every demanded skill has at least one course."
            />
            <ExecBlock
              title="Emerging skills"
              tone="amber"
              icon={<TrendingUp className="h-4 w-4 text-amber-700" />}
              items={panels.exec_summary.data.emerging}
              emptyMsg="No emerging-skill signal yet."
            />
          </CardContent>
        </Card>

        {/* UAE / GCC jobs panel */}
        <Card className="border-slate-200">
          {panelHeader(
            "Live UAE / GCC job market",
            <Globe2 className="h-4 w-4" />,
            panels.uae_jobs.data_quality,
            panels.uae_jobs.note,
          )}
          <CardContent className="pt-0">
            <div className="mb-3">
              <span className="text-3xl font-semibold text-slate-800" data-testid="stat-uae-total">{num(panels.uae_jobs.data.total_jobs)}</span>
              <span className="text-sm text-slate-500 ml-2">openings across the region</span>
            </div>
            <div className="space-y-1.5 mb-4">
              {Object.entries(panels.uae_jobs.data.by_country || {})
                .sort(([, a], [, b]) => b - a)
                .slice(0, 6)
                .map(([country, count]) => {
                  const pct = ((count / (panels.uae_jobs.data.total_jobs || 1)) * 100).toFixed(0);
                  return (
                    <div key={country} className="flex items-center gap-2 text-sm">
                      <span className="w-28 text-slate-700">{country}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-20 text-right text-slate-600 tabular-nums">{num(count)} <span className="text-slate-400">· {pct}%</span></span>
                    </div>
                  );
                })}
            </div>
            <div className="border-t pt-3">
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Top hiring companies</div>
              <div className="flex flex-wrap gap-1.5">
                {(panels.uae_jobs.data.top_companies || []).slice(0, 10).map((c) => (
                  <Badge key={c.name} variant="secondary" className="font-normal">
                    {c.name} <span className="ml-1 text-slate-500">· {c.count}</span>
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top in-demand skills */}
        <Card className="border-slate-200">
          {panelHeader(
            "Top in-demand skills (UAE / GCC)",
            <Sparkles className="h-4 w-4" />,
            panels.top_skills.data_quality,
            panels.top_skills.note,
          )}
          <CardContent className="pt-0">
            <div className="space-y-1.5">
              {(panels.top_skills.data?.items || []).slice(0, 15).map((s, idx) => {
                const max = panels.top_skills.data?.items?.[0]?.count || 1;
                const pct = ((s.count / max) * 100).toFixed(0);
                return (
                  <div key={s.taxonomy_skill_id} className="flex items-center gap-2 text-sm">
                    <span className="w-6 text-right text-slate-400 tabular-nums">{idx + 1}.</span>
                    <span className="w-40 text-slate-700 truncate" title={s.name}>{s.name}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-12 text-right text-slate-600 tabular-nums">{num(s.count)}</span>
                  </div>
                );
              })}
            </div>
            <div className="text-[11px] text-slate-400 mt-3">
              Source: {panels.top_skills.data?.source || "—"}
            </div>
          </CardContent>
        </Card>

        {/* Live jobs section (timeline + mix) */}
        <LiveJobsSection collegeId={params.id} slug={slug} />

        {/* Gap heatmap — full width */}
        <Card className="lg:col-span-2 border-slate-200">
          {panelHeader(
            "Curriculum coverage heatmap — program × skill",
            <TrendingUp className="h-4 w-4" />,
            panels.gap_heatmap.data_quality,
            panels.gap_heatmap.note || "Cell color: green = covered (darker = more courses), red = uncovered (darker = higher demand). Hover for details.",
          )}
          <CardContent className="pt-0 overflow-x-auto">
            {programs.length === 0 || skills.length === 0 ? (
              <p className="text-sm text-slate-500">Heatmap unavailable — need at least one program and one demanded skill.</p>
            ) : (
              <div className="min-w-[800px]">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-medium text-slate-600 p-2 border-b sticky left-0 bg-white z-10">Program</th>
                      {skills.slice(0, 15).map((s) => (
                        <th key={s.id} className="text-xs font-normal text-slate-600 p-1 border-b align-bottom" style={{ minWidth: 60 }}>
                          <div className="rotate-[-45deg] origin-bottom-left whitespace-nowrap inline-block" style={{ width: 60, marginLeft: 8 }}>
                            {s.name.length > 18 ? s.name.slice(0, 16) + "…" : s.name}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {programs.slice(0, 20).map((p) => (
                      <tr key={p.id}>
                        <td className="text-xs text-slate-700 p-2 border-b sticky left-0 bg-white whitespace-nowrap max-w-[260px] truncate" title={p.name}>
                          {p.name}
                        </td>
                        {skills.slice(0, 15).map((s) => {
                          const cell = cellMap[`${p.id}::${s.id}`] || { demand: s.demand_score, coverage: 0 };
                          return (
                            <td
                              key={s.id}
                              className={`p-0 border-b border-r border-slate-100 ${heatColor(cell.demand, cell.coverage, maxDemand)}`}
                              title={`${p.name} × ${s.name}\nDemand: ${cell.demand}\nCourses covering: ${cell.coverage}`}
                              data-testid={`heatmap-cell-${p.id}-${s.id}`}
                            >
                              <div className="text-[10px] text-center text-slate-700 py-1.5 px-1 tabular-nums">
                                {cell.coverage > 0 ? cell.coverage : ""}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-3">
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-rose-300 rounded-sm" /> High-demand gap</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-rose-100 rounded-sm" /> Lower-demand gap</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-emerald-100 rounded-sm" /> 1 course</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-emerald-300 rounded-sm" /> 4+ courses</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Programs panel */}
        <Card className="border-slate-200">
          {panelHeader(
            `Programs catalogue (${panels.programs.data.total})`,
            <BookOpen className="h-4 w-4" />,
            panels.programs.data_quality,
          )}
          <CardContent className="pt-0">
            <div className="max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Program</TableHead>
                    <TableHead className="text-xs">Degree</TableHead>
                    <TableHead className="text-xs text-right">CP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(panels.programs.data.items || []).slice(0, 30).map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{p.abbreviation || p.name}</TableCell>
                      <TableCell className="text-xs text-slate-600 capitalize">{(p.degree_type || "").replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-xs text-right text-slate-600 tabular-nums">{p.total_credit_points || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Alumni panel */}
        <Card className="border-slate-200">
          {panelHeader(
            "Alumni footprint",
            <Users className="h-4 w-4" />,
            panels.alumni.data_quality,
            panels.alumni.note,
          )}
          <CardContent className="pt-0">
            <div className="mb-3">
              <span className="text-3xl font-semibold text-slate-800" data-testid="stat-alumni-total">{num(panels.alumni.data.total)}</span>
              <span className="text-sm text-slate-500 ml-2">alumni linked</span>
            </div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Where they are</div>
            <div className="space-y-1 mb-4">
              {(panels.alumni.data.country_distribution || []).slice(0, 6).map((c) => (
                <div key={c.name} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{c.name}</span>
                  <span className="text-slate-500 tabular-nums">{num(c.count)}</span>
                </div>
              ))}
            </div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Sample headlines</div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {(panels.alumni.data.sample_headlines || []).map((s, i) => (
                <div key={i} className="text-xs text-slate-600 border-l-2 border-slate-200 pl-2 py-0.5">
                  <div className="truncate" title={s.title}>{s.title}</div>
                  {s.country && <div className="text-[10px] text-slate-400">{s.country}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* College jobs (campus drives) */}
        <Card className="lg:col-span-2 border-slate-200">
          {panelHeader(
            "Campus drives & college jobs",
            <Briefcase className="h-4 w-4" />,
            panels.college_jobs.data_quality,
            panels.college_jobs.note,
          )}
          <CardContent className="pt-0">
            {panels.college_jobs.data.drives === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Upload className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm">No campus drives uploaded yet.</p>
                <p className="text-xs mt-1">Upload at <code className="bg-slate-100 px-1 py-0.5 rounded">/upload/campus</code></p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <Stat label="Drives" value={panels.college_jobs.data.drives} />
                  <Stat label="Total JDs" value={panels.college_jobs.data.total_jds} />
                  <Stat label="Job types" value={Object.keys(panels.college_jobs.data.job_type_mix || {}).length} />
                  <Stat label="Recruiters" value={(panels.college_jobs.data.top_recruiters || []).length} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Top recruiters</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(panels.college_jobs.data.top_recruiters || []).slice(0, 12).map((r) => (
                        <Badge key={r.name} variant="secondary" className="font-normal">
                          {r.name} <span className="ml-1 text-slate-500">· {r.count}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Mix by job type</div>
                    <div className="space-y-1">
                      {Object.entries(panels.college_jobs.data.job_type_mix || {})
                        .sort(([, a], [, b]) => b - a)
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between text-sm">
                            <span className="text-slate-700 capitalize">{type.replace(/_/g, " ")}</span>
                            <span className="text-slate-500 tabular-nums">{num(count)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <div className="text-center text-[11px] text-slate-400 mt-6 pb-4">
        Generated at {new Date(data.generated_at).toLocaleString("en-IN")} · Nexus by Board Infinity
      </div>
    </div>
  );
}

// ── Small inline components ──────────────────────────────────────────
function ExecBlock({
  title, tone, icon, items, emptyMsg,
}: {
  title: string;
  tone: "emerald" | "rose" | "amber";
  icon: React.ReactNode;
  items: Array<{ skill: string; demand: number; coverage: number }>;
  emptyMsg: string;
}) {
  const bg = {
    emerald: "bg-emerald-50 border-emerald-100",
    rose:    "bg-rose-50 border-rose-100",
    amber:   "bg-amber-50 border-amber-100",
  }[tone];
  return (
    <div className={`rounded-lg border ${bg} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyMsg}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-sm">
              <div className="font-medium text-slate-800">{it.skill}</div>
              <div className="text-[11px] text-slate-500">
                Demand: <span className="tabular-nums">{num(it.demand)}</span> · Courses: <span className="tabular-nums">{it.coverage}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-800 tabular-nums">{num(value)}</div>
    </div>
  );
}
