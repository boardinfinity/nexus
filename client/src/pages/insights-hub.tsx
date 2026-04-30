import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, ArrowRight, BarChart3, Play, Users, Activity } from "lucide-react";
import { Link } from "wouter";

interface SummaryYear {
  graduation_year: number;
  total_alumni: number;
  analyzed: number;
  analyzed_complete: number;
  coverage_pct: number;
}

interface SummaryResponse {
  college: { id: string; name: string; short_name: string | null };
  totals: {
    total_alumni: number;
    analyzed: number;
    analyzed_complete: number;
  };
  by_year: SummaryYear[];
}

export default function InsightsHub({ params }: { params: { id: string } }) {
  const collegeId = params.id;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<SummaryResponse>({
    queryKey: [`insights-summary-${collegeId}`],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/insights/summary`);
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load summary");
      return res.json();
    },
  });

  const startRun = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/api/pipelines/run`, {
        method: "POST",
        body: JSON.stringify({
          pipeline_type: "person_analysis",
          config: { college_id: collegeId },
          trigger_type: "manual",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to start analysis run");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Analysis started", description: "Run is processing in the background." });
      qc.invalidateQueries({ queryKey: [`insights-summary-${collegeId}`] });
    },
    onError: (err: any) => {
      toast({ title: "Could not start run", description: err.message, variant: "destructive" });
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
        <BackButton collegeId={collegeId} />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {(error as Error)?.message || "Could not load insights"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalCoveragePct = data.totals.total_alumni > 0
    ? Math.round((data.totals.analyzed / data.totals.total_alumni) * 1000) / 10
    : 0;

  return (
    <div className="space-y-6">
      <BackButton collegeId={collegeId} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Alumni Insights</h1>
          <p className="text-muted-foreground mt-1">
            {data.college.name} — cohort outcomes, placement distribution, and YoY trends
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/colleges/${collegeId}/insights/pipeline`}>
            <Button variant="outline">
              <Activity className="h-4 w-4 mr-2" /> Pipeline console
            </Button>
          </Link>
          <Button onClick={() => startRun.mutate()} disabled={startRun.isPending}>
            {startRun.isPending
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Play className="h-4 w-4 mr-2" />}
            Run analysis
          </Button>
        </div>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<Users className="h-5 w-5 text-blue-600" />}
          label="Total alumni"
          value={data.totals.total_alumni.toLocaleString()}
        />
        <StatCard
          icon={<BarChart3 className="h-5 w-5 text-violet-600" />}
          label="Analyzed"
          value={`${data.totals.analyzed.toLocaleString()} (${totalCoveragePct}%)`}
          sub={`${data.totals.analyzed_complete.toLocaleString()} above quality threshold`}
        />
        <StatCard
          icon={<Activity className="h-5 w-5 text-emerald-600" />}
          label="Cohort years"
          value={String(data.by_year.length)}
          sub={data.by_year.length > 0
            ? `${Math.min(...data.by_year.map((y) => y.graduation_year))} – ${Math.max(...data.by_year.map((y) => y.graduation_year))}`
            : ""}
        />
      </div>

      {/* Year cards */}
      <div>
        <h2 className="text-xl font-semibold mb-3">By graduation year</h2>
        {data.by_year.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No cohorts yet. Upload alumni data and run analysis to see insights.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.by_year.map((y) => <YearCard key={y.graduation_year} collegeId={collegeId} y={y} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function BackButton({ collegeId }: { collegeId: string }) {
  return (
    <Link href={`/colleges/${collegeId}`}>
      <Button variant="ghost" size="sm">
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to college
      </Button>
    </Link>
  );
}

function StatCard({ icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="text-2xl font-bold mt-2">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function YearCard({ collegeId, y }: { collegeId: string; y: SummaryYear }) {
  const coverageColor =
    y.coverage_pct >= 80 ? "bg-emerald-100 text-emerald-700"
    : y.coverage_pct >= 40 ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-700";

  return (
    <Link href={`/colleges/${collegeId}/insights/${y.graduation_year}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl">Class of {y.graduation_year}</CardTitle>
            <Badge className={coverageColor}>{y.coverage_pct}% coverage</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Stat label="Total" value={y.total_alumni} />
            <Stat label="Analyzed" value={y.analyzed} />
            <Stat label="Quality" value={y.analyzed_complete} />
          </div>
          <div className="flex items-center justify-end mt-4 text-sm text-muted-foreground">
            View dashboard <ArrowRight className="h-4 w-4 ml-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}
