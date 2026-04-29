import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Eye, Loader2 } from "lucide-react";
import { getDashboard, type AdminSurveyDetail, type SurveyDashboard } from "@/lib/admin-survey-api";

export function OverviewTab({
  survey,
  publicUrl,
}: {
  survey: AdminSurveyDetail;
  publicUrl: string;
}) {
  const { toast } = useToast();
  const [dash, setDash] = useState<SurveyDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard(survey.id)
      .then(setDash)
      .catch(() => setDash(null))
      .finally(() => setLoading(false));
  }, [survey.id]);

  const sections = survey.schema?.sections || [];
  const totalQuestions = sections.reduce((acc, s) => acc + (s.questions?.length || 0), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Schema</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            {sections.length} sections · {totalQuestions} questions ·{" "}
            {survey.estimated_minutes ? `${survey.estimated_minutes} min` : "no time estimate"}
          </p>
          <div className="space-y-3 text-sm max-h-[500px] overflow-y-auto">
            {sections.map((sec, i) => (
              <div key={sec.key} className="border rounded-md p-3">
                <div className="font-medium">
                  {i + 1}. {sec.title}
                  <span className="text-xs text-muted-foreground ml-2 font-mono">{sec.key}</span>
                </div>
                {sec.description && (
                  <div className="text-xs text-muted-foreground mt-1">{sec.description}</div>
                )}
                <ul className="ml-4 mt-2 space-y-1 text-xs">
                  {(sec.questions || []).map((q) => (
                    <li key={q.key}>
                      <span className="font-mono text-muted-foreground">[{q.type}]</span>{" "}
                      {q.label}
                      {q.required === false && (
                        <span className="italic text-muted-foreground"> · optional</span>
                      )}
                      {q.profile_field && (
                        <Badge variant="outline" className="ml-1 text-[9px]">
                          profile:{q.profile_field}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live counts</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
              </div>
            ) : dash ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Invited" value={dash.total_invited} />
                <Stat label="Registered" value={dash.total_registered} />
                <Stat label="Started" value={dash.total_respondents} />
                <Stat label="Completed" value={dash.total_completed} />
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Completion rate</div>
                  <div className="text-lg font-semibold">{dash.completion_rate}%</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No data yet</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Public URL</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <code className="block text-xs bg-muted rounded p-2 break-all">{publicUrl}</code>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                toast({ title: "Copied" });
              }}
            >
              Copy link
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => window.open(publicUrl, "_blank")}
            >
              <Eye className="h-4 w-4 mr-2" /> Preview as respondent
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {survey.description || (
                <em className="text-muted-foreground">No description</em>
              )}
            </p>
            <Separator className="my-3" />
            <p className="text-xs text-muted-foreground">
              Created {new Date(survey.created_at).toLocaleDateString()} · last updated{" "}
              {new Date(survey.updated_at).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
