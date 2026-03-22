import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { KPICard } from "@/components/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Users, UserCheck, PlayCircle, CheckCircle2, Send,
  Search, ChevronLeft, ChevronRight, Download, ArrowLeft,
  Mail, ClipboardList, Star, AlertTriangle, Loader2, Copy,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Legend,
} from "recharts";

const COLORS = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1", "#ec4899", "#14b8a6", "#f97316", "#a855f7"];

const STATUS_COLORS: Record<string, string> = {
  invited: "bg-gray-100 text-gray-700",
  registered: "bg-blue-100 text-blue-700",
  started: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
};

const SECTION_LABELS: Record<string, string> = {
  profile: "A. Profile",
  hiring_overview: "B. Hiring Overview",
  skill_ratings: "C. Skill Ratings",
  gap_analysis: "D. Gap Analysis",
  emerging_trends: "E. Emerging Trends",
};

const ALL_SECTIONS = ["profile", "hiring_overview", "skill_ratings", "gap_analysis", "emerging_trends"];

interface DashboardData {
  total_invited: number;
  total_registered: number;
  total_started: number;
  total_completed: number;
  completion_rate: number;
  sections_completion: Record<string, number>;
  responses_by_industry: Array<{ industry: string; count: number }>;
  responses_by_company_size: Array<{ company_size: string; count: number }>;
  skill_ratings_summary: {
    top_importance: Array<{ skill: string; avg: number }>;
    top_gap: Array<{ skill: string; gap: number }>;
    total_skills_rated: number;
  };
}

interface Respondent {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  designation: string | null;
  industry: string | null;
  status: string;
  sections_completed: string[];
  skills_rated: number;
  created_at: string;
  last_login_at: string | null;
}

interface RespondentDetail {
  respondent: any;
  responses: Array<{
    section_key: string;
    question_key: string;
    response_type: string;
    response_value: any;
    updated_at: string;
  }>;
  skill_ratings: Array<{
    skill_name: string;
    importance_rating: number;
    demonstration_rating: number;
  }>;
}

interface AnalyticsData {
  skill_importance_vs_demonstration: Array<{
    skill: string;
    importance: number;
    demonstration: number;
    gap: number;
    respondent_count: number;
  }>;
  biggest_gaps: Array<{ skill: string; gap: number; importance: number; demonstration: number }>;
  most_adequate: Array<{ skill: string; gap: number; importance: number; demonstration: number }>;
  hiring_patterns: {
    top_roles_hired: Array<{ role: string; count: number }>;
    top_rejection_reasons: Array<{ reason: string; avg_rank: number; count: number }>;
  };
  total_respondents: number;
  total_ratings: number;
  total_responses: number;
}

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader><Skeleton className="h-4 w-40" /></CardHeader>
      <CardContent><Skeleton className="w-full h-[300px]" /></CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-700"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= rating ? "fill-amber-400 text-amber-400" : "text-gray-300"}`} />
      ))}
    </span>
  );
}

// ======================== DASHBOARD TAB ========================

function DashboardTab() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/admin/survey/dashboard"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/survey/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
  });

  if (isLoading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map(i => <ChartSkeleton key={i} />)}
      </div>
    </div>
  );

  if (!data) return null;

  const funnelData = ALL_SECTIONS.map(s => ({
    name: SECTION_LABELS[s]?.replace(/^[A-E]\. /, "") || s,
    count: data.sections_completion[s] || 0,
  }));

  const skillGapData = data.skill_ratings_summary.top_gap.slice(0, 15).map(s => ({
    skill: s.skill.length > 25 ? s.skill.substring(0, 22) + "..." : s.skill,
    gap: s.gap,
  }));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Invited" value={data.total_invited} icon={Users} />
        <KPICard title="Registered" value={data.total_registered} icon={UserCheck} subtitle={`${data.total_invited > 0 ? Math.round((data.total_registered / data.total_invited) * 100) : 0}% of invited`} />
        <KPICard title="Started" value={data.total_started} icon={PlayCircle} subtitle={`${data.total_registered > 0 ? Math.round((data.total_started / data.total_registered) * 100) : 0}% of registered`} />
        <KPICard title="Completed" value={data.total_completed} icon={CheckCircle2} subtitle={`${data.completion_rate}% completion rate`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Completion Funnel */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Completion Funnel by Section</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={funnelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Responses by Industry */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Responses by Industry</CardTitle></CardHeader>
          <CardContent>
            {data.responses_by_industry.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.responses_by_industry.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="industry" type="category" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Responses by Company Size */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Responses by Company Size</CardTitle></CardHeader>
          <CardContent>
            {data.responses_by_company_size.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={data.responses_by_company_size}
                    dataKey="count"
                    nameKey="company_size"
                    cx="50%"
                    cy="50%"
                    outerRadius={110}
                    label={({ company_size, count }) => `${company_size} (${count})`}
                  >
                    {data.responses_by_company_size.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Skill Gap Chart */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Top Skill Gaps (Importance − Demonstration)</CardTitle></CardHeader>
          <CardContent>
            {skillGapData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No skill ratings yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={skillGapData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="skill" type="category" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="gap" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ======================== RESPONDENTS TAB ========================

function RespondentsTab({ onViewDetail }: { onViewDetail: (id: string) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [inviteEmails, setInviteEmails] = useState("");
  const limit = 20;

  const { data, isLoading } = useQuery<{ respondents: Respondent[]; total: number; page: number }>({
    queryKey: ["/api/admin/survey/respondents", page, search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await authFetch(`/api/admin/survey/respondents?${params}`);
      if (!res.ok) throw new Error("Failed to fetch respondents");
      return res.json();
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (emails: string[]) => {
      const res = await apiRequest("POST", "/api/admin/survey/invite", { emails });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Invitations Processed",
        description: `${data.successful} added, ${data.failed} failed`,
      });
      setInviteEmails("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/survey/respondents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/survey/dashboard"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const remindMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/admin/survey/remind", { email });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data.email_sent ? "Reminder Sent" : "Respondent Notified",
        description: data.email_sent ? "OTP email sent successfully" : "Respondent record updated — share the survey link manually",
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleInvite = () => {
    const emails = inviteEmails
      .split(/[\n,;]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);
    if (emails.length === 0) {
      toast({ title: "No emails", description: "Enter at least one email", variant: "destructive" });
      return;
    }
    inviteMutation.mutate(emails);
  };

  const surveyUrl = `${window.location.origin}/#/survey`;

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="space-y-6">
      {/* Invite Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" /> Invite Respondents
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Enter email addresses (one per line or comma-separated)&#10;e.g. john@company.com, jane@company.com"
            value={inviteEmails}
            onChange={(e) => setInviteEmails(e.target.value)}
            rows={3}
          />
          <div className="flex items-center gap-3">
            <Button onClick={handleInvite} disabled={inviteMutation.isPending || !inviteEmails.trim()}>
              {inviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Add & Invite
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Survey URL:</span>
              <code className="bg-muted px-2 py-1 rounded text-xs">{surveyUrl}</code>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { navigator.clipboard.writeText(surveyUrl); toast({ title: "Copied!" }); }}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Respondent Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Respondents ({data?.total || 0})</CardTitle>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  className="pl-9 w-48"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="registered">Registered</SelectItem>
                  <SelectItem value="started">Started</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Name</th>
                      <th className="text-left p-3 font-medium">Email</th>
                      <th className="text-left p-3 font-medium">Company</th>
                      <th className="text-left p-3 font-medium">Industry</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-left p-3 font-medium">Sections</th>
                      <th className="text-left p-3 font-medium">Last Active</th>
                      <th className="text-right p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.respondents.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => onViewDetail(r.id)}
                      >
                        <td className="p-3">{r.full_name || "—"}</td>
                        <td className="p-3 text-muted-foreground">{r.email}</td>
                        <td className="p-3">{r.company_name || "—"}</td>
                        <td className="p-3">{r.industry || "—"}</td>
                        <td className="p-3"><StatusBadge status={r.status} /></td>
                        <td className="p-3">
                          <span className="text-xs">{r.sections_completed.length}/5</span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {r.last_login_at ? new Date(r.last_login_at).toLocaleDateString() : "Never"}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              remindMutation.mutate(r.email);
                            }}
                            disabled={remindMutation.isPending || r.status === "completed"}
                            title="Send reminder email"
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {data?.respondents.length === 0 && (
                      <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No respondents found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-muted-foreground">
                    Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data?.total || 0)} of {data?.total || 0}
                  </p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="flex items-center px-3 text-sm">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ======================== RESPONSE DETAIL VIEW ========================

function ResponseDetail({ respondentId, onBack }: { respondentId: string; onBack: () => void }) {
  const { data, isLoading } = useQuery<RespondentDetail>({
    queryKey: ["/api/admin/survey/respondent", respondentId],
    queryFn: async () => {
      const res = await authFetch(`/api/admin/survey/respondent/${respondentId}`);
      if (!res.ok) throw new Error("Failed to fetch respondent detail");
      return res.json();
    },
  });

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-60 w-full" />
    </div>
  );

  if (!data) return <div className="text-muted-foreground">Respondent not found</div>;

  const { respondent: r, responses, skill_ratings } = data;
  const completedSections = new Set(responses.map(r => r.section_key));
  if (r.full_name) completedSections.add("profile");
  const completionPct = (completedSections.size / 5) * 100;

  // Group responses by section
  const bySection: Record<string, typeof responses> = {};
  for (const resp of responses) {
    if (!bySection[resp.section_key]) bySection[resp.section_key] = [];
    bySection[resp.section_key].push(resp);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h2 className="text-lg font-semibold">{r.full_name || r.email}</h2>
        <StatusBadge status={
          completedSections.size >= 5 ? "completed" :
          completedSections.size > 0 ? "started" :
          r.last_login_at ? "registered" : "invited"
        } />
      </div>

      {/* Profile Card */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Profile</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{r.email}</span></div>
            <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{r.full_name || "—"}</span></div>
            <div><span className="text-muted-foreground">Company:</span> <span className="font-medium">{r.company_name || "—"}</span></div>
            <div><span className="text-muted-foreground">Designation:</span> <span className="font-medium">{r.designation || "—"}</span></div>
            <div><span className="text-muted-foreground">Industry:</span> <span className="font-medium">{r.industry || "—"}</span></div>
            <div><span className="text-muted-foreground">Company Size:</span> <span className="font-medium">{r.company_size || "—"}</span></div>
            <div><span className="text-muted-foreground">Experience:</span> <span className="font-medium">{r.years_of_experience ? `${r.years_of_experience} years` : "—"}</span></div>
            <div><span className="text-muted-foreground">Location:</span> <span className="font-medium">{[r.location_city, r.location_country].filter(Boolean).join(", ") || "—"}</span></div>
            <div><span className="text-muted-foreground">Joined:</span> <span className="font-medium">{new Date(r.created_at).toLocaleDateString()}</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Completion Progress */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">Completion</span>
            <Progress value={completionPct} className="flex-1 h-2" />
            <span className="text-sm text-muted-foreground">{completedSections.size}/5 sections</span>
          </div>
          <div className="flex gap-2 mt-3">
            {ALL_SECTIONS.map(s => (
              <Badge
                key={s}
                variant={completedSections.has(s) ? "default" : "secondary"}
                className="text-xs"
              >
                {SECTION_LABELS[s]}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Section-by-section responses */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Responses</CardTitle></CardHeader>
        <CardContent>
          <Accordion type="multiple" defaultValue={Object.keys(bySection)}>
            {ALL_SECTIONS.filter(s => s !== "profile" && bySection[s]?.length).map(section => (
              <AccordionItem key={section} value={section}>
                <AccordionTrigger className="text-sm">{SECTION_LABELS[section]}</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3">
                    {bySection[section]?.map((resp, i) => (
                      <div key={i} className="border rounded-lg p-3">
                        <div className="text-xs font-medium text-muted-foreground mb-1">{resp.question_key} ({resp.response_type})</div>
                        <div className="text-sm">
                          <ResponseValue value={resp.response_value} type={resp.response_type} />
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Skill Ratings Table */}
      {skill_ratings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Skill Ratings ({skill_ratings.length} skills)</CardTitle></CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Skill</th>
                    <th className="text-left p-3 font-medium">Importance</th>
                    <th className="text-left p-3 font-medium">Demonstration</th>
                    <th className="text-left p-3 font-medium">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {skill_ratings
                    .sort((a, b) => (b.importance_rating - b.demonstration_rating) - (a.importance_rating - a.demonstration_rating))
                    .map((sr, i) => {
                      const gap = sr.importance_rating - sr.demonstration_rating;
                      return (
                        <tr key={i} className="border-b">
                          <td className="p-3">{sr.skill_name}</td>
                          <td className="p-3"><StarDisplay rating={sr.importance_rating} /></td>
                          <td className="p-3"><StarDisplay rating={sr.demonstration_rating} /></td>
                          <td className="p-3">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                              gap >= 2 ? "bg-red-100 text-red-700" :
                              gap >= 1 ? "bg-amber-100 text-amber-700" :
                              "bg-green-100 text-green-700"
                            }`}>
                              {gap > 0 && <AlertTriangle className="h-3 w-3" />}
                              {gap > 0 ? `+${gap}` : gap}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResponseValue({ value, type }: { value: any; type: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;

  if (typeof value === "string") return <span>{value}</span>;
  if (typeof value === "number") return <span>{value}</span>;

  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((v, i) => (
          <Badge key={i} variant="secondary" className="text-xs">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </Badge>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    const { selected, other, rankings, text, ...rest } = value as any;
    return (
      <div className="space-y-1">
        {selected && Array.isArray(selected) && (
          <div className="flex flex-wrap gap-1">
            {selected.map((s: string, i: number) => <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>)}
          </div>
        )}
        {other && <div className="text-xs text-muted-foreground">Other: {other}</div>}
        {text && <div>{text}</div>}
        {rankings && Array.isArray(rankings) && (
          <div className="space-y-1">
            {rankings.map((r: any, i: number) => (
              <div key={i} className="text-xs">#{r.rank}: {r.reason || JSON.stringify(r)}</div>
            ))}
          </div>
        )}
        {Object.keys(rest).length > 0 && (
          <pre className="text-xs bg-muted p-2 rounded overflow-auto">{JSON.stringify(rest, null, 2)}</pre>
        )}
      </div>
    );
  }

  return <span>{String(value)}</span>;
}

// ======================== ANALYTICS TAB ========================

function AnalyticsTab() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/admin/survey/analytics"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/survey/analytics");
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json();
    },
  });

  if (isLoading) return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {[1, 2, 3, 4].map(i => <ChartSkeleton key={i} />)}
    </div>
  );

  if (!data) return null;

  const skillChartData = data.skill_importance_vs_demonstration.slice(0, 20).map(s => ({
    skill: s.skill.length > 20 ? s.skill.substring(0, 17) + "..." : s.skill,
    Importance: s.importance,
    Demonstration: s.demonstration,
    Gap: s.gap,
  }));

  function downloadCSV() {
    if (!data) return;
    const headers = ["Skill", "Importance", "Demonstration", "Gap", "Respondents"];
    const rows = data.skill_importance_vs_demonstration.map(s =>
      [s.skill, s.importance, s.demonstration, s.gap, s.respondent_count]
    );
    const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `survey-analytics-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard title="Total Respondents" value={data.total_respondents} icon={Users} />
        <KPICard title="Skill Ratings" value={data.total_ratings} icon={Star} />
        <KPICard title="Total Responses" value={data.total_responses} icon={ClipboardList} />
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={downloadCSV}>
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Skill Importance vs Demonstration */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm font-medium">Skill Importance vs Demonstration (Top 20 by Gap)</CardTitle></CardHeader>
          <CardContent>
            {skillChartData.length === 0 ? (
              <div className="h-[400px] flex items-center justify-center text-muted-foreground text-sm">No skill ratings yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={skillChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 5]} />
                  <YAxis dataKey="skill" type="category" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Importance" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Demonstration" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top Roles Hired */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Top Roles Hired</CardTitle></CardHeader>
          <CardContent>
            {data.hiring_patterns.top_roles_hired.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No hiring data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.hiring_patterns.top_roles_hired.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis dataKey="role" type="category" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Rejection Reasons */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Top Rejection Reasons (by Avg Rank)</CardTitle></CardHeader>
          <CardContent>
            {data.hiring_patterns.top_rejection_reasons.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">No rejection data yet</div>
            ) : (
              <div className="space-y-2">
                {data.hiring_patterns.top_rejection_reasons.slice(0, 10).map((r, i) => (
                  <div key={i} className="flex items-center justify-between border rounded-lg p-3">
                    <span className="text-sm">{r.reason}</span>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="text-xs">Avg rank: {r.avg_rank}</Badge>
                      <Badge variant="outline" className="text-xs">{r.count} respondents</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Biggest Gaps Table */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Biggest Skill Gaps</CardTitle></CardHeader>
          <CardContent>
            {data.biggest_gaps.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 font-medium">Skill</th>
                      <th className="text-right p-2 font-medium">Imp.</th>
                      <th className="text-right p-2 font-medium">Dem.</th>
                      <th className="text-right p-2 font-medium">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.biggest_gaps.map((s, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2">{s.skill}</td>
                        <td className="p-2 text-right">{s.importance}</td>
                        <td className="p-2 text-right">{s.demonstration}</td>
                        <td className="p-2 text-right font-medium text-red-600">+{s.gap}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Most Adequate */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Most Adequate Skills (Smallest Gap)</CardTitle></CardHeader>
          <CardContent>
            {data.most_adequate.length === 0 ? (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 font-medium">Skill</th>
                      <th className="text-right p-2 font-medium">Imp.</th>
                      <th className="text-right p-2 font-medium">Dem.</th>
                      <th className="text-right p-2 font-medium">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.most_adequate.map((s, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2">{s.skill}</td>
                        <td className="p-2 text-right">{s.importance}</td>
                        <td className="p-2 text-right">{s.demonstration}</td>
                        <td className="p-2 text-right font-medium text-green-600">{s.gap >= 0 ? `+${s.gap}` : s.gap}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ======================== MAIN COMPONENT ========================

export default function SurveyAdmin() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [viewingRespondent, setViewingRespondent] = useState<string | null>(null);

  // If viewing a respondent detail, show that instead of tabs
  if (viewingRespondent) {
    return (
      <div className="space-y-6">
        <ResponseDetail
          respondentId={viewingRespondent}
          onBack={() => setViewingRespondent(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Survey Admin</h1>
        <p className="text-sm text-muted-foreground">Manage survey respondents, track completion, and analyze responses</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="respondents">Respondents</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab />
        </TabsContent>

        <TabsContent value="respondents">
          <RespondentsTab onViewDetail={(id) => setViewingRespondent(id)} />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
