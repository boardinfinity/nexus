import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, GitCompare, FileText } from "lucide-react";
import { Link } from "wouter";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, PieChart, Pie, Legend,
} from "recharts";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const PALETTE = [
  "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a",
  "#0891b2", "#ca8a04", "#475569", "#9333ea", "#dc2626",
];

interface CohortResponse {
  college_id: string;
  graduation_year: number;
  program_id: string | null;
  cohort_size: number;
  dashboard_eligible_count: number;
  completeness_threshold: number;
  widgets: {
    bucket_distribution: Array<{ bucket_code: string; bucket_name: string; domain: string | null; color_hex: string | null; n_alumni: number; pct_cohort: number }>;
    undergrad_tier: Array<{ tier: string; n_alumni: number; pct_cohort: number }>;
    experience_histogram: Array<{ exp_bucket: string; n_alumni: number; pct_cohort: number }>;
    top_employers: Array<{ company_name: string; n_alumni: number; pct_cohort: number }>;
    function_split: Array<{ function: string; n_alumni: number; pct_cohort: number }>;
    ppo_stats: { total_analyzed: number; had_sip: number; ppo_converted: number; ppo_conversion_rate_pct: number };
    ctc_band: Array<{ ctc_band: string; n_alumni: number; pct_cohort: number }>;
  };
}

export default function CohortDashboard({ params }: { params: { id: string; year: string } }) {
  const collegeId = params.id;
  const year = params.year;
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<CohortResponse>({
    queryKey: [`cohort-${collegeId}-${year}-${selectedProgram || "all"}`],
    queryFn: async () => {
      const qs = new URLSearchParams({ graduation_year: year });
      if (selectedProgram) qs.set("program_id", selectedProgram);
      const res = await authFetch(`/api/colleges/${collegeId}/insights/cohort?${qs}`);
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load cohort");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Header collegeId={collegeId} year={year} />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {(error as Error)?.message || "Could not load cohort"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const w = data.widgets;
  const noEligible = data.dashboard_eligible_count === 0;

  return (
    <div className="space-y-6">
      <Header collegeId={collegeId} year={year} />

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Class of {year}</h1>
          <p className="text-muted-foreground mt-1">
            {data.cohort_size} analyzed · {data.dashboard_eligible_count} above quality threshold
            ({Math.round(data.completeness_threshold * 100)}%+)
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/colleges/${collegeId}/insights/${year}/compare`}>
            <Button variant="outline"><GitCompare className="h-4 w-4 mr-2" /> Compare years</Button>
          </Link>
          <Link href={`/colleges/${collegeId}/insights/reports`}>
            <Button variant="outline"><FileText className="h-4 w-4 mr-2" /> Reports</Button>
          </Link>
        </div>
      </div>

      {noEligible ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No alumni in this cohort meet the quality threshold yet. Run analysis or wait for the pipeline to complete.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Top KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              label="Top placement"
              value={w.bucket_distribution[0]?.bucket_name || "—"}
              sub={w.bucket_distribution[0] ? `${w.bucket_distribution[0].pct_cohort}% of cohort` : ""}
              accent={w.bucket_distribution[0]?.color_hex || PALETTE[0]}
            />
            <KPICard
              label="PPO conversion"
              value={w.ppo_stats.had_sip > 0 ? `${w.ppo_stats.ppo_conversion_rate_pct}%` : "—"}
              sub={`${w.ppo_stats.ppo_converted}/${w.ppo_stats.had_sip} SIPs converted`}
              accent="#10b981"
            />
            <KPICard
              label="Top employer"
              value={w.top_employers[0]?.company_name || "—"}
              sub={w.top_employers[0] ? `${w.top_employers[0].n_alumni} alumni` : ""}
              accent="#8b5cf6"
            />
            <KPICard
              label="Top function"
              value={w.function_split[0]?.function || "—"}
              sub={w.function_split[0] ? `${w.function_split[0].pct_cohort}% of cohort` : ""}
              accent="#f59e0b"
            />
          </div>

          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard
              title="Placement bucket distribution"
              description="Where alumni landed for their first role"
            >
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={w.bucket_distribution.slice(0, 10).map((b) => ({
                    name: b.bucket_name, pct: b.pct_cohort, n: b.n_alumni, color: b.color_hex,
                  }))}
                  layout="vertical"
                  margin={{ left: 90, right: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" unit="%" />
                  <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number, _n: string, p: any) => [`${v}% (${p.payload.n} alumni)`, "Share"]} />
                  <Bar dataKey="pct" radius={[0, 6, 6, 0]}>
                    {w.bucket_distribution.slice(0, 10).map((b, i) => (
                      <Cell key={i} fill={b.color_hex || PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Undergraduate institution tier"
              description="Where alumni did their UG degree"
            >
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={w.undergrad_tier}
                    dataKey="n_alumni"
                    nameKey="tier"
                    outerRadius={120}
                    label={(e: any) => `${e.tier} (${e.pct_cohort}%)`}
                  >
                    {w.undergrad_tier.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v} alumni`, "Count"]} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Pre-MBA work experience"
              description="Months of experience before joining"
            >
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={w.experience_histogram} margin={{ left: 0, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="exp_bucket" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip formatter={(v: number) => [`${v} alumni`, "Count"]} />
                  <Bar dataKey="n_alumni" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Job function split"
              description="Function distribution at first role"
            >
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={w.function_split.slice(0, 8)}
                  layout="vertical"
                  margin={{ left: 110, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" unit="%" />
                  <YAxis dataKey="function" type="category" width={140} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number, _n: string, p: any) => [`${v}% (${p.payload.n_alumni} alumni)`, "Share"]} />
                  <Bar dataKey="pct_cohort" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Top employers + CTC table row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Top employers</CardTitle>
                <CardDescription>Companies hiring the most alumni</CardDescription>
              </CardHeader>
              <CardContent>
                {w.top_employers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No employer data available</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead>
                        <TableHead className="text-right">Alumni</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {w.top_employers.slice(0, 12).map((e, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{e.company_name}</TableCell>
                          <TableCell className="text-right">{e.n_alumni}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">{e.pct_cohort}%</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>CTC band distribution</CardTitle>
                <CardDescription>Bucket-implied compensation bands</CardDescription>
              </CardHeader>
              <CardContent>
                {w.ctc_band.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No CTC data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={w.ctc_band} margin={{ left: 0, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="ctc_band" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={70} />
                      <YAxis />
                      <Tooltip formatter={(v: number) => [`${v} alumni`, "Count"]} />
                      <Bar dataKey="n_alumni" fill="#16a34a" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Header({ collegeId, year }: { collegeId: string; year: string }) {
  return (
    <Link href={`/colleges/${collegeId}/insights`}>
      <Button variant="ghost" size="sm">
        <ArrowLeft className="h-4 w-4 mr-2" /> Insights hub
      </Button>
    </Link>
  );
}

function ChartCard({ title, description, children }: { title: string; description?: string; children: any }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function KPICard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: accent || "#3b82f6" }} />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        </div>
        <div className="text-xl font-bold mt-2 truncate" title={value}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
