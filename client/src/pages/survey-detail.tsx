import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ExternalLink, Eye, Loader2, Save } from "lucide-react";
import { getSurvey, updateSurvey, type AdminSurveyDetail } from "@/lib/admin-survey-api";
import { OverviewTab } from "@/components/survey/overview-tab";
import { InvitesTab } from "@/components/survey/invites-tab";
import { RespondentsTab } from "@/components/survey/respondents-tab";
import { AnalyticsTab } from "@/components/survey/analytics-tab";

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

interface MeResponse { role: string }

export default function SurveyDetail(_props: Props) {
  const [, params] = useRoute<{ id: string }>("/survey-admin/:id");
  const id = params?.id || "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: me } = useQuery<MeResponse>({ queryKey: ["/api/users/me"], staleTime: 30000 });
  const isCollegeRep = me?.role === "college_rep";

  const [survey, setSurvey] = useState<AdminSurveyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string>("");

  async function reload() {
    try {
      const d = await getSurvey(id);
      setSurvey(d.survey);
      setPendingStatus(d.survey.status);
    } catch (err: any) {
      toast({ title: "Failed to load", description: err.message, variant: "destructive" });
    }
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    reload().finally(() => setLoading(false));
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
      <Card className="p-8 text-center text-sm text-muted-foreground">Survey not found.</Card>
    );
  }

  const publicUrl = `${window.location.origin}/#/s/${survey.slug}`;
  const previewUrl = `${window.location.origin}/#/s/${survey.slug}?preview=1`;
  const isOpen = ["published"].includes(survey.status);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/survey-admin")}
            className="-ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> All surveys
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{survey.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <code className="text-xs font-mono">{survey.slug}</code>
            <Badge variant="outline" className="capitalize">
              {survey.audience_type.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="capitalize">{survey.status}</Badge>
            {survey.locked_at && <Badge variant="outline">locked</Badge>}
            <span>v{survey.version}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isCollegeRep && (
            <>
              <Select value={pendingStatus} onValueChange={setPendingStatus}>
                <SelectTrigger className="w-[140px]">
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
                size="sm"
                disabled={pendingStatus === survey.status || saving}
                onClick={saveStatus}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Update status
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => window.open(previewUrl, "_blank")}>
            <Eye className="h-4 w-4 mr-2" /> Preview
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open(publicUrl, "_blank")}>
            <ExternalLink className="h-4 w-4 mr-2" /> Public link
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="respondents">Respondents</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab survey={survey} publicUrl={publicUrl} />
        </TabsContent>

        <TabsContent value="invites" className="space-y-4">
          <InvitesTab surveyId={survey.id} surveyTitle={survey.title} canSend={isOpen} />
        </TabsContent>

        <TabsContent value="respondents" className="space-y-4">
          <RespondentsTab surveyId={survey.id} schema={survey.schema} />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <AnalyticsTab surveyId={survey.id} schema={survey.schema} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
