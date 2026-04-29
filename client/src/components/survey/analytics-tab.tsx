import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, TrendingDown, TrendingUp, BarChart3 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { getAnalytics, type SurveyAnalytics } from "@/lib/admin-survey-api";
import type { SurveySchema, SurveyQuestion } from "@/lib/survey-api";

export function AnalyticsTab({
  surveyId,
  schema,
}: {
  surveyId: string;
  schema: SurveySchema;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<SurveyAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getAnalytics(surveyId)
      .then(setData)
      .catch((err) =>
        toast({
          title: "Failed to load analytics",
          description: err.message,
          variant: "destructive",
        })
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  const skillChartData = useMemo(() => {
    if (!data?.skill_comparison) return [];
    return data.skill_comparison
      .slice()
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 15)
      .map((s) => ({
        skill: s.skill.length > 22 ? s.skill.slice(0, 20) + "…" : s.skill,
        full: s.skill,
        importance: Number(s.importance.toFixed(2)),
        demonstration: Number(s.demonstration.toFixed(2)),
        gap: Number(s.gap.toFixed(2)),
        n: s.respondent_count,
      }));
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        No analytics data available
      </Card>
    );
  }

  const hasSkills = (data.skill_comparison?.length || 0) > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Respondents" value={data.total_respondents} />
        <SummaryCard label="Responses" value={data.total_responses} />
        <SummaryCard label="Skill ratings" value={data.total_ratings} />
        <SummaryCard
          label="Skills tracked"
          value={data.skill_comparison?.length || 0}
        />
      </div>

      {hasSkills && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Skill gap — top 15 by gap (importance vs demonstration)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={skillChartData}
                  layout="vertical"
                  margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="skill"
                    width={170}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: any, name: any) => [v, name]}
                    labelFormatter={(_, payload) => {
                      const p = payload?.[0]?.payload;
                      return p ? `${p.full} (n=${p.n})` : "";
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="importance" fill="#6366f1" name="Importance" />
                  <Bar dataKey="demonstration" fill="#10b981" name="Demonstration" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {hasSkills && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkillRankTable
            title="Biggest gaps"
            icon={<TrendingDown className="h-4 w-4 text-rose-600" />}
            rows={data.biggest_gaps || []}
            tone="rose"
          />
          <SkillRankTable
            title="Most adequate"
            icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
            rows={data.most_adequate || []}
            tone="emerald"
          />
        </div>
      )}

      <ResponseAggregations
        schema={schema}
        aggregations={data.response_aggregations || {}}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function SkillRankTable({
  title,
  icon,
  rows,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  rows: SurveyAnalytics["biggest_gaps"];
  tone: "rose" | "emerald";
}) {
  const top = rows.slice(0, 10);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {top.length === 0 ? (
          <div className="text-xs text-muted-foreground px-4 pb-4">No data</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead className="w-16 text-right">Imp</TableHead>
                <TableHead className="w-16 text-right">Dem</TableHead>
                <TableHead className="w-16 text-right">Gap</TableHead>
                <TableHead className="w-12 text-right">n</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((r, i) => (
                <TableRow key={`${r.skill}-${i}`}>
                  <TableCell className="text-xs">{r.skill}</TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    {r.importance.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    {r.demonstration.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`text-xs text-right font-mono ${
                      tone === "rose" ? "text-rose-600" : "text-emerald-600"
                    }`}
                  >
                    {r.gap >= 0 ? "+" : ""}
                    {r.gap.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs text-right text-muted-foreground">
                    {r.respondent_count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const BAR_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#14b8a6", "#f43f5e", "#8b5cf6", "#22c55e"];

function ResponseAggregations({
  schema,
  aggregations,
}: {
  schema: SurveySchema;
  aggregations: Record<string, Record<string, number>>;
}) {
  const sections = schema.sections || [];
  const aggregatableTypes = new Set([
    "single_choice",
    "multi_choice",
    "scale",
    "date",
  ]);

  const sectionsWithCharts = sections
    .map((sec) => {
      const questions = (sec.questions || []).filter(
        (q) => aggregatableTypes.has(q.type) && aggregations[q.key]
      );
      return { sec, questions };
    })
    .filter((s) => s.questions.length > 0);

  if (sectionsWithCharts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Response breakdowns</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No aggregatable responses yet (single/multi-choice, scale, date).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {sectionsWithCharts.map(({ sec, questions }) => (
        <Card key={sec.key}>
          <CardHeader>
            <CardTitle className="text-base">{sec.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {questions.map((q) => (
              <QuestionAggregation
                key={q.key}
                question={q}
                counts={aggregations[q.key] || {}}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function QuestionAggregation({
  question,
  counts,
}: {
  question: SurveyQuestion;
  counts: Record<string, number>;
}) {
  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const opt of question.options || []) {
      m.set(opt.value, opt.label);
    }
    return m;
  }, [question]);

  const data = useMemo(() => {
    const rows = Object.entries(counts).map(([k, v]) => ({
      key: k,
      label: labelMap.get(k) || k,
      count: v,
    }));
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [counts, labelMap]);

  const total = data.reduce((s, r) => s + r.count, 0);

  if (data.length === 0) {
    return (
      <div>
        <div className="text-xs font-medium mb-1">{question.label}</div>
        <div className="text-xs text-muted-foreground">No responses</div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-medium mb-1">{question.label}</div>
      <div className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1">
        <Badge variant="outline" className="text-[9px]">{question.type}</Badge>
        n = {total}
      </div>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.slice(0, 8)}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={120}
              tick={{ fontSize: 10 }}
            />
            <Tooltip />
            <Bar dataKey="count">
              {data.slice(0, 8).map((_, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
