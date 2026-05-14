/**
 * College Dashboard — Live Jobs section (Phase 0 v0)
 *
 * Three tabs:
 *   - Recent          placeholder ("Coming soon")
 *   - Timeline        weekly volume, all-time, stacked by source
 *   - Mix             three horizontal bar charts (source / level / country)
 *
 * Reads from:
 *   - GET /api/college-dashboard/:id/jobs              (authenticated)
 *   - GET /api/public/college-dashboard/by-slug/:slug/jobs (public demo)
 *
 * Honest data quality:
 *   - Timeline carries its own quality chip; today it is "live_partial"
 *     because ~13% of UAE/GCC jobs have no posted_at, and volume before
 *     mid-March 2026 reflects collection ramp, not market trend.
 *   - Mix is "live" — counted from raw rows.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Briefcase, BarChart3, LineChart, CalendarClock } from "lucide-react";

type DataQuality = "live" | "live_partial" | "illustrative";

interface MixRow { key: string; n: number; }

interface LiveJobsPayload {
  view: "live_jobs";
  college_id: string;
  regions: Array<{ country_variant: string; country_label: string; is_primary: boolean }>;
  timeline: {
    data_quality: DataQuality;
    note?: string;
    window: string;
    weeks: Array<{ week: string; n: number; by_source: Record<string, number> }>;
    total_jobs: number;
  };
  mix: {
    data_quality: DataQuality;
    by_source: MixRow[];
    by_level: MixRow[];
    by_country: MixRow[];
  };
  facets: {
    sources: string[];
    levels: string[];
    countries: string[];
    total_jobs: number;
    with_posted_at: number;
  };
}

function qualityChip(q: DataQuality) {
  const cfg = {
    live:          { label: "Live",           cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    live_partial:  { label: "Live · Partial", cls: "bg-amber-100 text-amber-800 border-amber-200" },
    illustrative:  { label: "Illustrative",   cls: "bg-slate-100 text-slate-700 border-slate-200" },
  }[q];
  return (
    <Badge variant="outline" className={`text-[10px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </Badge>
  );
}

function num(n: number) {
  return new Intl.NumberFormat("en-IN").format(n || 0);
}

// Friendly source labels
const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  google_jobs: "Google Jobs",
  clay_linkedin: "Clay · LinkedIn",
  naukrigulf_csv: "NaukriGulf (CSV)",
  "naukrigulf.com": "NaukriGulf",
  "bayt.com": "Bayt",
  unknown: "Unknown",
};
function prettySource(s: string) {
  return SOURCE_LABELS[s] || s;
}

// Friendly level labels
const LEVEL_LABELS: Record<string, string> = {
  entry_level: "Entry level",
  associate: "Associate",
  mid_senior: "Mid–Senior",
  director: "Director",
  executive: "Executive",
  internship: "Internship",
  Unspecified: "Unspecified",
};
function prettyLevel(s: string) {
  return LEVEL_LABELS[s] || s;
}

// Stable color palette for the timeline stack
const SOURCE_COLORS = [
  "#2563eb", // blue-600
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#7c3aed", // violet-600
  "#ef4444", // red-500
  "#0891b2", // cyan-600
  "#84cc16", // lime-500
  "#a855f7", // purple-500
];

// ── Horizontal bar chart (small, CSS-only) ───────────────────────────
function BarRows({ rows, prettify, max = 8 }: { rows: MixRow[]; prettify?: (k: string) => string; max?: number }) {
  const shown = rows.slice(0, max);
  const top = shown[0]?.n || 1;
  return (
    <div className="space-y-1.5">
      {shown.map((r, idx) => {
        const pct = (r.n / top) * 100;
        return (
          <div key={r.key + idx} className="flex items-center gap-2 text-sm">
            <span className="w-32 text-slate-700 truncate" title={prettify ? prettify(r.key) : r.key}>
              {prettify ? prettify(r.key) : r.key}
            </span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-14 text-right text-slate-600 tabular-nums">{num(r.n)}</span>
          </div>
        );
      })}
      {rows.length === 0 && (
        <p className="text-xs text-slate-500">No data.</p>
      )}
    </div>
  );
}

// ── Stacked weekly timeline (SVG) ────────────────────────────────────
function TimelineChart({ weeks, sources }: { weeks: LiveJobsPayload["timeline"]["weeks"]; sources: string[] }) {
  if (weeks.length === 0) {
    return <p className="text-sm text-slate-500">No weekly volume to plot yet.</p>;
  }
  // Layout
  const W = 760;
  const H = 220;
  const padL = 36;
  const padR = 12;
  const padT = 10;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxN = Math.max(1, ...weeks.map((w) => w.n));
  const barW = Math.max(2, Math.floor(plotW / weeks.length) - 1);

  // Top 6 sources globally; everything else becomes "Other"
  const topSources = sources.slice(0, 6);
  const sourceColor = (s: string) => SOURCE_COLORS[topSources.indexOf(s) % SOURCE_COLORS.length] || "#94a3b8";

  // Y axis ticks (4)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(maxN * t));

  // X axis labels: first, middle, last
  const labelIdx = [0, Math.floor(weeks.length / 2), weeks.length - 1];

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ height: H }}>
        {/* Y grid + ticks */}
        {yTicks.map((tv, i) => {
          const y = padT + plotH - (tv / maxN) * plotH;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#64748b">{num(tv)}</text>
            </g>
          );
        })}
        {/* Bars */}
        {weeks.map((w, idx) => {
          const x = padL + idx * (barW + 1);
          let yCursor = padT + plotH;
          const segments: Array<{ src: string; n: number }> = [];
          let otherN = 0;
          for (const [src, n] of Object.entries(w.by_source)) {
            if (topSources.includes(src)) segments.push({ src, n });
            else otherN += n;
          }
          if (otherN > 0) segments.push({ src: "Other", n: otherN });
          return (
            <g key={w.week}>
              {segments.map((seg, j) => {
                const segH = (seg.n / maxN) * plotH;
                yCursor -= segH;
                return (
                  <rect
                    key={j}
                    x={x}
                    y={yCursor}
                    width={barW}
                    height={Math.max(0.5, segH)}
                    fill={seg.src === "Other" ? "#cbd5e1" : sourceColor(seg.src)}
                  >
                    <title>{`Week of ${w.week} · ${seg.src === "Other" ? "Other" : prettySource(seg.src)}: ${num(seg.n)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
        {/* X labels */}
        {labelIdx.map((idx, i) => {
          if (idx < 0 || idx >= weeks.length) return null;
          const x = padL + idx * (barW + 1) + barW / 2;
          return (
            <text key={i} x={x} y={H - 10} textAnchor="middle" fontSize="9" fill="#64748b">
              {weeks[idx].week}
            </text>
          );
        })}
      </svg>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-600">
        {topSources.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: sourceColor(s) }} />
            {prettySource(s)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#cbd5e1" }} />
          Other
        </span>
      </div>
    </div>
  );
}

// ── Section component ────────────────────────────────────────────────
interface Props {
  collegeId?: string;
  slug?: string; // public demo
}

type Tab = "recent" | "timeline" | "mix";

export default function LiveJobsSection({ collegeId, slug }: Props) {
  const [tab, setTab] = useState<Tab>("timeline");

  const isPublic = Boolean(slug);
  const url = isPublic
    ? `/api/public/college-dashboard/by-slug/${slug}/jobs`
    : `/api/college-dashboard/${collegeId}/jobs`;

  const { data, isLoading, error } = useQuery<LiveJobsPayload>({
    queryKey: [url],
    queryFn: async () => {
      const res = isPublic ? await fetch(url) : await authFetch(url);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const totalJobs = data?.facets?.total_jobs || 0;
  const withPosted = data?.facets?.with_posted_at || 0;
  const regionLabels = Array.from(new Set((data?.regions || []).map((r) => r.country_label)));

  return (
    <Card className="lg:col-span-2 border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="text-slate-500"><Briefcase className="h-4 w-4" /></div>
            <CardTitle className="text-base font-semibold">
              Live jobs · {regionLabels.length > 0 ? regionLabels.join(" / ") : "Region"}
            </CardTitle>
            {data && (
              <span className="text-xs text-slate-500">
                · {num(totalJobs)} jobs · {num(withPosted)} with posted date
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <TabBtn active={tab === "recent"} onClick={() => setTab("recent")} icon={<CalendarClock className="h-3.5 w-3.5" />} label="Recent" />
            <TabBtn active={tab === "timeline"} onClick={() => setTab("timeline")} icon={<LineChart className="h-3.5 w-3.5" />} label="Timeline" />
            <TabBtn active={tab === "mix"} onClick={() => setTab("mix")} icon={<BarChart3 className="h-3.5 w-3.5" />} label="Mix" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        )}
        {error && (
          <p className="text-sm text-rose-600">Could not load live jobs: {(error as Error).message}</p>
        )}
        {data && tab === "recent" && (
          <div className="py-10 text-center border border-dashed border-slate-200 rounded-md bg-slate-50/60">
            <p className="text-sm font-medium text-slate-700">Recent jobs feed</p>
            <p className="text-xs text-slate-500 mt-1">
              Coming soon — a scrollable list of the newest postings with apply links.
            </p>
          </div>
        )}
        {data && tab === "timeline" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              {qualityChip(data.timeline.data_quality)}
              <span className="text-xs text-slate-500">
                Weekly volume · {data.timeline.window === "all_time" ? "All time" : data.timeline.window} · stacked by source
              </span>
            </div>
            {data.timeline.note && (
              <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">{data.timeline.note}</p>
            )}
            <TimelineChart weeks={data.timeline.weeks} sources={data.facets.sources} />
          </div>
        )}
        {data && tab === "mix" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              {qualityChip(data.mix.data_quality)}
              <span className="text-xs text-slate-500">Counted from {num(totalJobs)} raw rows</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">By source</h4>
                <BarRows rows={data.mix.by_source} prettify={prettySource} />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">By seniority level</h4>
                <BarRows rows={data.mix.by_level} prettify={prettyLevel} />
                {data.facets.total_jobs > 0 && (
                  <p className="text-[10px] text-slate-400 mt-2">
                    {Math.round(((data.mix.by_level.find((r) => r.key === "Unspecified")?.n || 0) / data.facets.total_jobs) * 100)}% of jobs do not declare a level.
                  </p>
                )}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">By country</h4>
                <BarRows rows={data.mix.by_country} />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border transition-colors " +
        (active
          ? "bg-slate-900 text-white border-slate-900"
          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
      }
    >
      {icon}
      {label}
    </button>
  );
}
