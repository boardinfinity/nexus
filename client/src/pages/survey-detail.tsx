import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Save,
  Eye,
} from "lucide-react";
import { getSurvey, updateSurvey, type AdminSurveyDetail } from "@/lib/admin-survey-api";

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
];

interface Props {
  params?: { id: string };
}

export default function SurveyDetail(_props: Props) {
  const [, params] = useRoute<{ id: string }>("/survey-admin/:id");
  const id = params?.id || "";
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [survey, setSurvey] = useState<AdminSurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    getSurvey(id)
      .then((d) => {
        setSurvey(d.survey);
        setPendingStatus(d.survey.status);
      })
      .catch((err) => toast({ title: "Failed to load", description: err.message, variant: "destructive" }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveStatus() {
    if (!survey || pendingStatus === survey.status) return;
    setSaving(true);
    try {
      const result = await updateSurvey(survey.id, { status: pendingStatus as AdminSurveyDetail["status"] });
      setSurvey(result.survey);
      toast({ title: "Status updated", description: `Now ${result.survey.status}` });
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!survey) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Survey not found.
      </Card>
    );
  }

  const sections = survey.schema?.sections || [];
  const totalQuestions = sections.reduce((acc, s) => acc + (s.questions?.length || 0), 0);
  const publicUrl = `${window.location.origin}/#/s/${survey.slug}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={() => navigate("/survey-admin")} className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> All surveys
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{survey.title}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <code className="text-xs font-mono">{survey.slug}</code>
            <Badge variant="outline" className="capitalize">
              {survey.audience_type.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="capitalize">{survey.status}</Badge>
            {survey.locked_at && <Badge variant="outline">locked</Badge>}
            <span>v{survey.version}</span>
          </div>
        </div>
        <Button variant="outline" onClick={() => window.open(publicUrl, "_blank")}>
          <ExternalLink className="h-4 w-4 mr-2" /> Open public link
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invites" disabled>
            Invites
          </TabsTrigger>
          <TabsTrigger value="respondents" disabled>
            Respondents
          </TabsTrigger>
          <TabsTrigger value="analytics" disabled>
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
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
                <div className="space-y-3 text-sm">
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
                            <span className="font-mono text-muted-foreground">[{q.type}]</span> {q.label}
                            {q.required === false && <span className="italic text-muted-foreground"> · optional</span>}
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
                  <CardTitle className="text-base">Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Select value={pendingStatus} onValueChange={setPendingStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    className="w-full"
                    disabled={pendingStatus === survey.status || saving}
                    onClick={saveStatus}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" /> Update status
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Only published surveys are reachable at <code className="text-[10px]">/#/s/{survey.slug}</code>.
                  </p>
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
                  <CardTitle className="text-base">Coming soon</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-muted-foreground">
                  <p>Invites · Respondents · Analytics tabs</p>
                  <p>SPOC scoping (college_rep filter)</p>
                  <Separator className="my-2" />
                  <p>
                    Description:{" "}
                    {survey.description || <em className="text-muted-foreground">none</em>}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
