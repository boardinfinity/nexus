import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Search,
  Loader2,
  ExternalLink,
  Sparkles,
  Copy,
  Eye,
} from "lucide-react";
import { listSurveys, cloneSurvey, type AdminSurveyListItem } from "@/lib/admin-survey-api";
import { SurveyWizard } from "@/components/survey-wizard";

const STATUS_COLOR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  published: "default",
  paused: "secondary",
  closed: "secondary",
  archived: "secondary",
};

const AUDIENCE_FILTERS = [
  { value: "all", label: "All audiences" },
  { value: "employer", label: "Employer" },
  { value: "industry_sme", label: "Industry SME" },
  { value: "alumni", label: "Alumni" },
  { value: "faculty", label: "Faculty" },
  { value: "student", label: "Student" },
  { value: "other", label: "Other" },
];

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "paused", label: "Paused" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
];

interface MeResponse { role: string }

export default function SurveyAdmin() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: me } = useQuery<MeResponse>({ queryKey: ["/api/users/me"], staleTime: 30000 });
  const isCollegeRep = me?.role === "college_rep";

  const [surveys, setSurveys] = useState<AdminSurveyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [audienceFilter, setAudienceFilter] = useState("all");
  const [wizardOpen, setWizardOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await listSurveys({
        status: statusFilter !== "all" ? statusFilter : undefined,
        audience: audienceFilter !== "all" ? audienceFilter : undefined,
      });
      setSurveys(result.surveys || []);
    } catch (err: any) {
      toast({ title: "Failed to load surveys", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, audienceFilter]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return surveys;
    return surveys.filter(
      (sv) =>
        sv.title.toLowerCase().includes(s) ||
        sv.slug.toLowerCase().includes(s) ||
        (sv.description || "").toLowerCase().includes(s)
    );
  }, [surveys, search]);

  async function handleClone(s: AdminSurveyListItem) {
    try {
      const result = await cloneSurvey(s.id);
      toast({ title: "Cloned", description: `New draft: ${result.survey.title}` });
      load();
    } catch (err: any) {
      toast({ title: "Clone failed", description: err.message, variant: "destructive" });
    }
  }

  function handlePreview(slug: string) {
    // Open the public runtime in a new tab
    window.open(`${window.location.origin}/#/s/${slug}`, "_blank");
  }

  function publicUrl(slug: string) {
    return `${window.location.origin}/#/s/${slug}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Surveys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Multi-survey admin with AI-assisted survey builder. Public URLs:{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/#/s/&lt;slug&gt;</code>
          </p>
        </div>
        {!isCollegeRep && (
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New survey
          </Button>
        )}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search by title, slug, or description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={audienceFilter} onValueChange={setAudienceFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIENCE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading surveys…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Sparkles className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="font-medium">No surveys yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Create your first survey from a brief, an uploaded document, or by cloning an existing one.
            </p>
            {!isCollegeRep && (
              <Button className="mt-4" onClick={() => setWizardOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> New survey
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sections / Questions</TableHead>
                <TableHead className="text-right">Respondents</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted/40">
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium text-left hover:underline"
                      onClick={() => navigate(`/survey-admin/${s.id}`)}
                    >
                      {s.title}
                    </button>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      {s.slug}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {s.audience_type.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLOR[s.status] || "outline"} className="capitalize">
                      {s.status}
                    </Badge>
                    {s.locked_at && (
                      <Badge variant="outline" className="ml-1 text-[10px]">
                        locked
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {s.section_count} / {s.question_count}
                  </TableCell>
                  <TableCell className="text-right text-sm">{s.respondent_count}</TableCell>
                  <TableCell className="text-right text-sm">{s.completed_count}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(s.updated_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Open public URL"
                        onClick={() => handlePreview(s.slug)}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      {!isCollegeRep && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Clone"
                          onClick={() => handleClone(s)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Open admin"
                        onClick={() => navigate(`/survey-admin/${s.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <SurveyWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(id) => navigate(`/survey-admin/${id}`)}
      />
    </div>
  );
}
