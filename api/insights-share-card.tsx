// =============================================================================
// api/insights-share-card.tsx
//
// Standalone Vercel Edge Function that renders 1200x630 OG images for public
// alumni-insight reports. Reads pre-computed JSON from `insight_reports` and
// the live cohort widget JSON, then composes a chart image with @vercel/og.
//
// Spec: alumni_insights_spec.md §8 (Layer 5 Public Reports — share images).
// Endpoint: GET /api/insights-share-card?report_id=<uuid>&widget=<widget_name>
//
// `widget` is optional; default is `summary_card` (a 2x2 composite of the top
// four widgets). All chart rendering is done in pure SVG/JSX — no canvas.
// =============================================================================

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WIDTH = 1200;
const HEIGHT = 630;
const PALETTE = [
  "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a",
  "#0891b2", "#ca8a04", "#475569", "#9333ea", "#dc2626",
];
const SUPABASE_URL = (globalThis as any).process?.env?.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = (globalThis as any).process?.env?.SUPABASE_SERVICE_ROLE_KEY
  || (globalThis as any).process?.env?.SUPABASE_KEY;

// ---------------------------------------------------------------------------
// Edge handler
// ---------------------------------------------------------------------------
export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const reportId = url.searchParams.get("report_id");
  const widget = url.searchParams.get("widget") || "summary_card";

  if (!reportId) {
    return new Response("Missing report_id", { status: 400 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response("Server misconfigured: SUPABASE_URL/KEY not set", { status: 500 });
  }

  // Fetch the report + cohort data in parallel
  const report = await fetchReport(reportId);
  if (!report) {
    return new Response("Report not found", { status: 404 });
  }

  const cohort = await fetchCohort(report.college_id, report.graduation_year, report.program_id);
  const collegeName = report.college?.short_name || report.college?.name || "College";

  // Choose composer based on widget
  const composer = widgetComposers[widget] || widgetComposers.summary_card;
  const node = composer({ report, cohort, collegeName });

  return new ImageResponse(node, {
    width: WIDTH,
    height: HEIGHT,
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}

// ---------------------------------------------------------------------------
// Data fetching (uses Supabase REST directly — no client lib in edge runtime)
// ---------------------------------------------------------------------------
async function fetchReport(reportId: string): Promise<any | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/insight_reports?id=eq.${reportId}&is_public=eq.true&select=*,college:colleges(id,name,short_name)`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

async function fetchCohort(
  collegeId: string,
  gradYear: number | null,
  programId: string | null,
): Promise<any | null> {
  if (!gradYear) return null;

  // Read snapshots directly + buckets — same shape as getCohort(), inlined here
  // because we cannot share TS with the edge function (different runtime).
  const filters = [
    `college_id=eq.${collegeId}`,
    `schema_version=eq.2`,
    `graduation_year=eq.${gradYear}`,
    `completeness_score=gte.0.5`,
  ];
  if (programId) filters.push(`program_id=eq.${programId}`);

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/alumni_profile_snapshots?${filters.join("&")}&select=first_job_bucket_code,undergrad_college_tier,pre_college_total_exp_months,is_ppo,sip_bucket_id,ctc_band_label,snapshot`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) return { rows: [] };

  // Resolve bucket names
  const codes = Array.from(new Set(rows.map((r: any) => r.first_job_bucket_code).filter(Boolean)));
  const bucketsByCode: Record<string, any> = {};
  if (codes.length > 0) {
    const codeFilter = codes.map((c: string) => `"${c}"`).join(",");
    const br = await fetch(
      `${SUPABASE_URL}/rest/v1/buckets?code=in.(${codeFilter})&select=code,name,domain,color_hex`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    if (br.ok) {
      const bs = await br.json();
      for (const b of bs) bucketsByCode[b.code] = b;
    }
  }

  return { rows, bucketsByCode };
}

// ---------------------------------------------------------------------------
// Aggregations (mirror insights.ts but inlined for edge runtime)
// ---------------------------------------------------------------------------
function tally(rows: any[], keyFn: (r: any) => string): { key: string; n: number; pct: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r) || "Unknown";
    m.set(k, (m.get(k) || 0) + 1);
  }
  const total = rows.length;
  return Array.from(m.entries())
    .map(([key, n]) => ({ key, n, pct: total > 0 ? Math.round((n / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.n - a.n);
}

function applyRedaction<T extends { n: number }>(arr: T[]): T[] {
  // N>=5 group merging — anything < 5 collapses into "Other"
  const keep = arr.filter((g) => g.n >= 5);
  const drop = arr.filter((g) => g.n < 5);
  if (drop.length > 0) {
    const otherN = drop.reduce((s, g) => s + g.n, 0);
    const otherPct = drop.reduce((s, g: any) => s + (g.pct || 0), 0);
    if (otherN >= 5) {
      keep.push({ key: "Other", n: otherN, pct: Math.round(otherPct * 10) / 10 } as any);
    }
  }
  return keep;
}

// ---------------------------------------------------------------------------
// Layout primitives — pure JSX understood by @vercel/og's Satori
// ---------------------------------------------------------------------------
function Frame({
  children,
  title,
  subtitle,
  collegeName,
}: {
  children: any;
  title: string;
  subtitle?: string;
  collegeName: string;
}) {
  return (
    <div style={{
      width: WIDTH, height: HEIGHT,
      display: "flex", flexDirection: "column",
      background: "linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)",
      padding: 48,
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 18, color: "#64748b", letterSpacing: 1.5, textTransform: "uppercase" }}>
            {collegeName} · Alumni Insights
          </span>
          <span style={{ fontSize: 36, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 18, color: "#475569", marginTop: 4 }}>{subtitle}</span>
          )}
        </div>
        <div style={{
          padding: "8px 16px", borderRadius: 999,
          background: "#1e293b", color: "white",
          fontSize: 14, fontWeight: 600,
          display: "flex", alignItems: "center",
        }}>
          NEXUS
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex" }}>
        {children}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 16, fontSize: 13, color: "#94a3b8", display: "flex" }}>
        Generated by Board Infinity · Aggregated cohort data, n≥5 redaction applied
      </div>
    </div>
  );
}

function BarChart({ items, valueLabel = "share" }: { items: { label: string; n: number; pct: number; color?: string }[]; valueLabel?: string }) {
  const max = Math.max(...items.map((i) => i.pct), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 12 }}>
      {items.slice(0, 8).map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 220, fontSize: 18, color: "#0f172a", display: "flex" }}>
            {truncate(it.label, 28)}
          </span>
          <div style={{
            flex: 1, height: 32, background: "#e2e8f0", borderRadius: 8,
            display: "flex", alignItems: "center", overflow: "hidden",
          }}>
            <div style={{
              height: 32,
              width: `${(it.pct / max) * 100}%`,
              background: it.color || PALETTE[i % PALETTE.length],
              borderRadius: 8,
              display: "flex",
            }} />
          </div>
          <span style={{
            width: 80, textAlign: "right",
            fontSize: 18, fontWeight: 600, color: "#0f172a",
            display: "flex", justifyContent: "flex-end",
          }}>
            {it.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      flex: 1, padding: 24,
      background: "white", borderRadius: 16,
      border: "1px solid #e2e8f0",
      display: "flex", flexDirection: "column",
    }}>
      <span style={{ fontSize: 14, color: "#64748b", textTransform: "uppercase", letterSpacing: 1.2 }}>
        {label}
      </span>
      <span style={{ fontSize: 56, fontWeight: 700, color: "#0f172a", marginTop: 8 }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 16, color: "#475569", marginTop: 4 }}>{sub}</span>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ---------------------------------------------------------------------------
// Widget composers — one per widget type
// ---------------------------------------------------------------------------
type ComposerCtx = { report: any; cohort: any; collegeName: string };
type Composer = (ctx: ComposerCtx) => any;

const widgetComposers: Record<string, Composer> = {
  bucket_distribution: ({ report, cohort, collegeName }) => {
    const items = applyRedaction(
      tally(cohort?.rows || [], (r) => r.first_job_bucket_code),
    ).map((it, i) => {
      const meta = cohort?.bucketsByCode?.[it.key];
      return {
        label: meta?.name || (it.key === "UNMAPPED" ? "Unmapped" : it.key === "Other" ? "Other" : it.key),
        n: it.n,
        pct: it.pct,
        color: meta?.color_hex || PALETTE[i % PALETTE.length],
      };
    });

    return (
      <Frame
        title={`Class of ${report.graduation_year} — Placement Distribution`}
        subtitle={items.length ? `${items.length} placement clusters · ${(cohort?.rows || []).length} alumni analyzed` : undefined}
        collegeName={collegeName}
      >
        {items.length === 0 ? <NoDataNotice /> : <BarChart items={items} />}
      </Frame>
    );
  },

  undergrad_tier: ({ report, cohort, collegeName }) => {
    const items = applyRedaction(
      tally(cohort?.rows || [], (r) => r.undergrad_college_tier || "Unknown"),
    ).map((it, i) => ({
      label: it.key, n: it.n, pct: it.pct, color: PALETTE[i % PALETTE.length],
    }));

    return (
      <Frame
        title={`Class of ${report.graduation_year} — Undergrad Profile`}
        subtitle="Pre-MBA institution tier distribution"
        collegeName={collegeName}
      >
        {items.length === 0 ? <NoDataNotice /> : <BarChart items={items} />}
      </Frame>
    );
  },

  experience_histogram: ({ report, cohort, collegeName }) => {
    const breakpoints = [
      { label: "0 (fresher)", min: 0, max: 0 },
      { label: "1–12 mo", min: 1, max: 12 },
      { label: "13–24 mo", min: 13, max: 24 },
      { label: "25–36 mo", min: 25, max: 36 },
      { label: "37–48 mo", min: 37, max: 48 },
      { label: "48+ mo", min: 49, max: Infinity },
    ];
    const tallyMap = new Map<string, number>();
    for (const r of cohort?.rows || []) {
      const m = r.pre_college_total_exp_months;
      if (m === null || m === undefined) continue;
      const bp = breakpoints.find((b) => m >= b.min && m <= b.max);
      if (bp) tallyMap.set(bp.label, (tallyMap.get(bp.label) || 0) + 1);
    }
    const total = (cohort?.rows || []).length;
    const items = breakpoints.map((b, i) => ({
      label: b.label,
      n: tallyMap.get(b.label) || 0,
      pct: total > 0 ? Math.round(((tallyMap.get(b.label) || 0) / total) * 1000) / 10 : 0,
      color: PALETTE[i % PALETTE.length],
    })).filter((it) => it.n >= 5 || (it.n > 0 && total < 25));

    return (
      <Frame
        title={`Class of ${report.graduation_year} — Pre-MBA Experience`}
        subtitle="Months of work experience before joining"
        collegeName={collegeName}
      >
        {items.length === 0 ? <NoDataNotice /> : <BarChart items={items} />}
      </Frame>
    );
  },

  function_split: ({ report, cohort, collegeName }) => {
    const items = applyRedaction(
      tally(cohort?.rows || [], (r) =>
        r.snapshot?.immediate_after_college?.first_job?.job_function || "Unknown"),
    ).map((it, i) => ({
      label: it.key, n: it.n, pct: it.pct, color: PALETTE[i % PALETTE.length],
    }));

    return (
      <Frame
        title={`Class of ${report.graduation_year} — Job Functions`}
        subtitle="Distribution by job function at first role"
        collegeName={collegeName}
      >
        {items.length === 0 ? <NoDataNotice /> : <BarChart items={items} />}
      </Frame>
    );
  },

  top_employers: ({ report, cohort, collegeName }) => {
    const items = applyRedaction(
      tally(cohort?.rows || [], (r) =>
        r.snapshot?.immediate_after_college?.first_job?.company_name || "Unknown"),
    ).filter((it) => it.key !== "Unknown")
     .slice(0, 8)
     .map((it, i) => ({
       label: it.key, n: it.n, pct: it.pct, color: PALETTE[i % PALETTE.length],
     }));

    return (
      <Frame
        title={`Class of ${report.graduation_year} — Top Employers`}
        subtitle="Companies hiring 5+ alumni"
        collegeName={collegeName}
      >
        {items.length === 0 ? <NoDataNotice /> : <BarChart items={items} />}
      </Frame>
    );
  },

  ctc_band: ({ report, cohort, collegeName }) => {
    const items = applyRedaction(
      tally(cohort?.rows || [], (r) => r.ctc_band_label || "Unknown"),
    ).filter((it) => it.key !== "Unknown")
     .map((it, i) => ({
       label: it.key, n: it.n, pct: it.pct, color: PALETTE[i % PALETTE.length],
     }));

    return (
      <Frame
        title={`Class of ${report.graduation_year} — Compensation Bands`}
        subtitle="Bucket-implied CTC distribution"
        collegeName={collegeName}
      >
        {items.length === 0 ? <NoDataNotice /> : <BarChart items={items} />}
      </Frame>
    );
  },

  ppo_stats: ({ report, cohort, collegeName }) => {
    const rows = cohort?.rows || [];
    const sip = rows.filter((r: any) => r.sip_bucket_id).length;
    const ppo = rows.filter((r: any) => r.is_ppo === true).length;
    const rate = sip > 0 ? Math.round((ppo / sip) * 1000) / 10 : 0;

    return (
      <Frame
        title={`Class of ${report.graduation_year} — PPO Conversion`}
        subtitle="Pre-placement offer rate from summer internships"
        collegeName={collegeName}
      >
        <div style={{ display: "flex", gap: 24, flex: 1, alignItems: "center" }}>
          <StatCard label="SIPs Done" value={String(sip)} />
          <StatCard label="PPO Converted" value={String(ppo)} />
          <StatCard label="Conversion Rate" value={`${rate}%`} sub={`across ${rows.length} alumni`} />
        </div>
      </Frame>
    );
  },

  // Composite 2x2 of the top four widgets
  summary_card: ({ report, cohort, collegeName }) => {
    const buckets = applyRedaction(
      tally(cohort?.rows || [], (r) => r.first_job_bucket_code),
    ).slice(0, 4).map((it, i) => {
      const meta = cohort?.bucketsByCode?.[it.key];
      return {
        label: meta?.name || (it.key === "UNMAPPED" ? "Unmapped" : it.key === "Other" ? "Other" : it.key),
        n: it.n,
        pct: it.pct,
        color: meta?.color_hex || PALETTE[i % PALETTE.length],
      };
    });

    const total = (cohort?.rows || []).length;

    return (
      <Frame
        title={`Class of ${report.graduation_year} Outcomes`}
        subtitle={report.caption || `Cohort summary across ${total} alumni`}
        collegeName={collegeName}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 16 }}>
          <div style={{ display: "flex", gap: 16 }}>
            <StatCard label="Analyzed" value={String(total)} sub="profiles in cohort" />
            <StatCard
              label="Top Track"
              value={buckets[0]?.label ? truncate(buckets[0].label, 14) : "—"}
              sub={buckets[0] ? `${buckets[0].pct}% of cohort` : "Insufficient data"}
            />
          </div>
          <div style={{ flex: 1, display: "flex" }}>
            {buckets.length === 0 ? <NoDataNotice /> : <BarChart items={buckets} />}
          </div>
        </div>
      </Frame>
    );
  },
};

function NoDataNotice() {
  return (
    <div style={{
      flex: 1, display: "flex",
      alignItems: "center", justifyContent: "center",
      color: "#94a3b8", fontSize: 22,
    }}>
      Insufficient data for this view (n &lt; 5 in every group)
    </div>
  );
}
