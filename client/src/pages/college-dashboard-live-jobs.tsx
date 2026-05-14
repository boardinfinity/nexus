/**
 * College Dashboard — Live Jobs section
 *
 * Three tabs:
 *   - Recent          latest 50 postings with apply links
 *   - Timeline        weekly volume, all-time, stacked by source
 *   - Mix             three horizontal bar charts (source / level / country)
 *                     bars are clickable → filter applies to all three tabs
 *
 * Reads from:
 *   - GET /api/college-dashboard/:id/jobs              (authenticated)
 *   - GET /api/public/college-dashboard/by-slug/:slug/jobs (public demo)
 *   Filters: ?source=&country=&level=
 *
 * Honest data quality:
 *   - Timeline chip auto-set by backend ("live_partial" while <95% of rows
 *     have posted_at, with a footnote about collection ramp).
 *   - Mix is "live" — counted from raw rows.
 *   - Seniority levels are rolled up (L0–L5 collapsed into the canonical 6).
 *     Unspecified is suppressed from the chart with a footnote.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Briefcase, BarChart3, LineChart, CalendarClock, ExternalLink, X, MapPin,
} from "lucide-react";

type DataQuality = "live" | "live_partial" | "illustrative";

interface MixRow { key: string; n: number; }

interface RecentJob {
  id: string;
  title: string | null;
  company_name: string | null;
  posted_at: string | null;
  source: string | null;
  source_url: string | null;
  seniority_level: string | null;
  country_label: string | null;
  location_city: string | null;
}

interface LiveJobsPayload {
  view: "live_jobs";
  college_id: string;
  regions: Array<{ country_variant: string; country_label: string; is_primary: boolean }>;
  filters: { source?: string; country?: string; level?: string };
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
    unspecified_level_n: number;
  };
  recent: RecentJob[];
  facets: {
    sources: string[];
    levels: string[];
    countries: string[];
    total_jobs: number;
    with_posted_at: number;
    filtered_total_jobs?: number;
    filtered_with_posted_at?: number;
    unspecified_level_n?: number;
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

const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  google_jobs: "Google Jobs",
  clay_linkedin: "Clay · LinkedIn",
  naukrigulf_csv: "NaukriGulf (CSV)",
  "naukrigulf.com": "NaukriGulf",
  "bayt.com": "Bayt",
  unknown: "Unknown",
};
function prettySource(s: string) { return SOURCE_LABELS[s] || s; }

const LEVEL_LABELS: Record<string, string> = {
  entry_level: "Entry level",
  associate: "Associate",
  mid_senior: "Mid–Senior",
  director: "Director",
  executive: "Executive",
  internship: "Internship",
  other: "Other",
  Unspecified: "Unspecified",
};
function prettyLevel(s: string) { return LEVEL_LABELS[s] || s; }

const SOURCE_COLORS = [
  "#2563eb", "#10b981", "#f59e0b", "#7c3aed", "#ef4444", "#0891b2", "#84cc16", "#a855f7",
];

function postedAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!t) return "—";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 0) return "today";
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ── Horizontal bar chart, clickable ──────────────────────────────────
function BarRows({
  rows, prettify, max = 8, activeKey, onToggle, ariaLabel,
}: {
  rows: MixRow[];
  prettify?: (k: string) => string;
  max?: number;
  activeKey?: string;
  onToggle?: (key: string) => void;
  ariaLabel: string;
}) {
  const shown = rows.slice(0, max);
  const top = shown[0]?.n || 1;
  return (
    <div className="space-y-1.5" aria-label={ariaLabel}>
      {shown.map((r, idx) => {
        const pct = (r.n / top) * 100;
        const isActive = activeKey === r.key;
        const isDimmed = !!activeKey && !isActive;
        const interactive = !!onToggle;
        return (
          <button
            type="button"
            key={r.key + idx}
            onClick={() => onToggle && onToggle(r.key)}
            disabled={!interactive}
            className={
              "w-full flex items-center gap-2 text-sm rounded px-1 py-0.5 transition-colors text-left " +
              (interactive ? "hover:bg-slate-50 cursor-pointer " : "cursor-default ") +
              (isDimmed ? "opacity-50 " : "")
            }
          >
            <span className={`w-32 truncate ${isActive ? "text-blue-700 font-medium" : "text-slate-700"}`} title={prettify ? prettify(r.key) : r.key}>
              {prettify ? prettify(r.key) : r.key}
            </span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${isActive ? "bg-blue-700" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`w-14 text-right tabular-nums ${isActive ? "text-blue-700 font-medium" : "text-slate-600"}`}>
              {num(r.n)}
            </span>
          </button>
        );
      })}
      {rows.length === 0 && (
        <p className="text-xs text-slate-500 px-1">No data.</p>
      )}
    </div>
  );
}

// ── Stacked weekly timeline (SVG) ────────────────────────────────────
function TimelineChart({ weeks, sources, activeSource }: {
  weeks: LiveJobsPayload["timeline"]["weeks"];
  sources: string[];
  activeSource?: string;
}) {
  if (weeks.length === 0) {
    return <p className="text-sm text-slate-500">No weekly volume to plot yet.</p>;
  }
  const W = 760, H = 220, padL = 36, padR = 12, padT = 10, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxN = Math.max(1, ...weeks.map((w) => w.n));
  const barW = Math.max(2, Math.floor(plotW / weeks.length) - 1);
  const topSources = sources.slice(0, 6);
  const sourceColor = (s: string) => SOURCE_COLORS[topSources.indexOf(s) % SOURCE_COLORS.length] || "#94a3b8";
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(maxN * t));
  const labelIdx = [0, Math.floor(weeks.length / 2), weeks.length - 1];

  // Legend list: when a source filter is active, only that source remains.
  const legendSources = activeSource ? [activeSource] : topSources;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ height: H }}>
        {yTicks.map((tv, i) => {
          const y = padT + plotH - (tv / maxN) * plotH;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#64748b">{num(tv)}</text>
            </g>
          );
        })}
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
      <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-600">
        {legendSources.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: sourceColor(s) }} />
            {prettySource(s)}
          </span>
        ))}
        {!activeSource && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#cbd5e1" }} />
            Other
          </span>
        )}
      </div>
    </div>
  );
}

// ── Recent feed list ─────────────────────────────────────────────────
function RecentList({ jobs }: { jobs: RecentJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="py-10 text-center border border-dashed border-slate-200 rounded-md bg-slate-50/60">
        <p className="text-sm text-slate-600">No matching postings.</p>
      </div>
    );
  }
  return (
    <div className="border border-slate-200 rounded-md max-h-[420px] overflow-y-auto divide-y divide-slate-100">
      {jobs.map((j) => {
        const loc = [j.location_city, j.country_label].filter(Boolean).join(", ");
        return (
          <div key={j.id} className="px-3 py-2.5 hover:bg-slate-50 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-medium text-slate-800 truncate" title={j.title || ""}>
                  {j.title || "Untitled"}
                </h4>
                {j.seniority_level && (
                  <Badge variant="outline" className="text-[10px] font-normal text-slate-600 border-slate-200">
                    {prettyLevel(j.seniority_level)}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 flex-wrap">
                <span className="font-medium text-slate-600">{j.company_name || "—"}</span>
                {loc && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {loc}
                  </span>
                )}
                <span>· {postedAgo(j.posted_at)}</span>
                {j.source && (
                  <span className="text-slate-400">· {prettySource(j.source)}</span>
                )}
              </div>
            </div>
            {j.source_url && (
              <a
                href={j.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded border border-blue-200 bg-blue-50/40"
              >
                Apply <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Section component ────────────────────────────────────────────────
interface Props {
  collegeId?: string;
  slug?: string;
}

type Tab = "recent" | "timeline" | "mix";
interface Filters { source?: string; country?: string; level?: string; }

export default function LiveJobsSection({ collegeId, slug }: Props) {
  const [tab, setTab] = useState<Tab>("timeline");
  const [filters, setFilters] = useState<Filters>({});

  const isPublic = Boolean(slug);
  const baseUrl = isPublic
    ? `/api/public/college-dashboard/by-slug/${slug}/jobs`
    : `/api/college-dashboard/${collegeId}/jobs`;

  const queryUrl = useMemo(() => {
    const qs = new URLSearchParams();
    if (filters.source) qs.set("source", filters.source);
    if (filters.country) qs.set("country", filters.country);
    if (filters.level) qs.set("level", filters.level);
    const s = qs.toString();
    return s ? `${baseUrl}?${s}` : baseUrl;
  }, [baseUrl, filters]);

  const { data, isLoading, isFetching, error } = useQuery<LiveJobsPayload>({
    queryKey: [queryUrl],
    queryFn: async () => {
      const res = isPublic ? await fetch(queryUrl) : await authFetch(queryUrl);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const totalJobs = data?.facets?.total_jobs || 0;
  const filteredTotal = data?.facets?.filtered_total_jobs ?? totalJobs;
  const filteredWithPosted = data?.facets?.filtered_with_posted_at ?? data?.facets?.with_posted_at ?? 0;
  const regionLabels = Array.from(new Set((data?.regions || []).map((r) => r.country_label)));
  const hasFilters = !!(filters.source || filters.country || filters.level);

  const toggle = (k: keyof Filters) => (v: string) => {
    setFilters((prev) => ({ ...prev, [k]: prev[k] === v ? undefined : v }));
  };

  const clearAll = () => setFilters({});

  return (
    <Card className="lg:col-span-2 border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-slate-500"><Briefcase className="h-4 w-4" /></div>
            <CardTitle className="text-base font-semibold">
              Live jobs · {regionLabels.length > 0 ? regionLabels.join(" / ") : "Region"}
            </CardTitle>
            {data && (
              <span className="text-xs text-slate-500">
                ·{" "}
                {hasFilters ? (
                  <>
                    <span className="font-medium text-slate-700">{num(filteredTotal)}</span> of {num(totalJobs)} jobs
                    {" · "}{num(filteredWithPosted)} with posted date
                  </>
                ) : (
                  <>{num(totalJobs)} jobs · {num(filteredWithPosted)} with posted date</>
                )}
              </span>
            )}
            {isFetching && !isLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
            )}
          </div>
          <div className="flex items-center gap-1">
            <TabBtn active={tab === "recent"} onClick={() => setTab("recent")} icon={<CalendarClock className="h-3.5 w-3.5" />} label="Recent" />
            <TabBtn active={tab === "timeline"} onClick={() => setTab("timeline")} icon={<LineChart className="h-3.5 w-3.5" />} label="Timeline" />
            <TabBtn active={tab === "mix"} onClick={() => setTab("mix")} icon={<BarChart3 className="h-3.5 w-3.5" />} label="Mix" />
          </div>
        </div>
        {hasFilters && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <span className="text-[11px] text-slate-500">Filtering by:</span>
            {filters.source && (
              <FilterChip label={`Source: ${prettySource(filters.source)}`} onClear={() => toggle("source")(filters.source!)} />
            )}
            {filters.country && (
              <FilterChip label={`Country: ${filters.country}`} onClear={() => toggle("country")(filters.country!)} />
            )}
            {filters.level && (
              <FilterChip label={`Level: ${prettyLevel(filters.level)}`} onClear={() => toggle("level")(filters.level!)} />
            )}
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-slate-500 hover:text-slate-800 underline underline-offset-2 ml-1"
            >
              Clear all
            </button>
          </div>
        )}
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
          <div>
            <p className="text-xs text-slate-500 mb-2">
              Latest {Math.min(data.recent.length, 50)} postings{hasFilters ? " matching your filter" : ""}.
              Sorted by posted date.
            </p>
            <RecentList jobs={data.recent} />
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
            <TimelineChart weeks={data.timeline.weeks} sources={data.facets.sources} activeSource={filters.source} />
          </div>
        )}
        {data && tab === "mix" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              {qualityChip(data.mix.data_quality)}
              <span className="text-xs text-slate-500">
                Counted from {num(filteredTotal)} {hasFilters ? "matching" : "raw"} rows · click a bar to filter
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">By source</h4>
                <BarRows
                  rows={data.mix.by_source}
                  prettify={prettySource}
                  activeKey={filters.source}
                  onToggle={toggle("source")}
                  ariaLabel="Jobs by source"
                />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">By seniority level</h4>
                <BarRows
                  rows={data.mix.by_level}
                  prettify={prettyLevel}
                  activeKey={filters.level}
                  onToggle={toggle("level")}
                  ariaLabel="Jobs by seniority level"
                />
                {data.mix.unspecified_level_n > 0 && filteredTotal > 0 && (
                  <p className="text-[10px] text-slate-400 mt-2">
                    {Math.round((data.mix.unspecified_level_n / filteredTotal) * 100)}% of jobs do not declare a level — excluded from this chart.
                  </p>
                )}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">By country</h4>
                <BarRows
                  rows={data.mix.by_country}
                  activeKey={filters.country}
                  onToggle={toggle("country")}
                  ariaLabel="Jobs by country"
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void; }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="text-blue-500 hover:text-blue-800"
        aria-label={`Clear ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
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
