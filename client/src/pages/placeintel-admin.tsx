import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { authFetch, apiRequest } from "@/lib/queryClient";
import {
  GraduationCap, Mail, Download, RefreshCw, Search, CheckCircle2, Clock,
  Send, Eye, ShieldCheck, XCircle, Loader2, Building2, Users, BarChart3,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  not_invited: { label: "Not Invited", color: "bg-gray-100 text-gray-700", icon: null },
  invited: { label: "Invited", color: "bg-blue-100 text-blue-700", icon: Mail },
  in_progress: { label: "In Progress", color: "bg-yellow-100 text-yellow-700", icon: Clock },
  submitted: { label: "Submitted", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  verified: { label: "Verified", color: "bg-emerald-100 text-emerald-700", icon: ShieldCheck },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.not_invited;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
      {config.icon && <config.icon className="h-3 w-3" />}
      {config.label}
    </span>
  );
}

export default function PlaceIntelAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteCollegeId, setInviteCollegeId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>(null);

  // Fetch colleges
  const { data: colleges = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/placeintel/admin/colleges", statusFilter, stateFilter, tierFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (stateFilter !== "all") params.set("state", stateFilter);
      if (tierFilter !== "all") params.set("tier", tierFilter);
      if (search) params.set("search", search);
      const res = await authFetch(`/api/placeintel/admin/colleges?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  // Fetch college detail
  const { data: collegeDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["/api/placeintel/admin/colleges", selectedCollegeId],
    queryFn: async () => {
      if (!selectedCollegeId) return null;
      const res = await authFetch(`/api/placeintel/admin/colleges/${selectedCollegeId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!selectedCollegeId,
  });

  // Invite mutation
  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/placeintel/admin/invite", {
        college_id: inviteCollegeId,
        email: inviteEmail,
        name: inviteName,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Invite sent", description: `Invite link generated for ${inviteEmail}` });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteName("");
      queryClient.invalidateQueries({ queryKey: ["/api/placeintel/admin/colleges"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Verify mutation
  const verifyMutation = useMutation({
    mutationFn: async ({ collegeId, action }: { collegeId: string; action: string }) => {
      const res = await apiRequest("POST", `/api/placeintel/admin/verify/${collegeId}`, { action });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/placeintel/admin/colleges"] });
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/placeintel/sync-board-hub", {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Sync complete", description: `New: ${data.new_count}, Updated: ${data.updated_count}, Skipped: ${data.skipped_count}` });
      queryClient.invalidateQueries({ queryKey: ["/api/placeintel/admin/colleges"] });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Export
  const handleExport = async () => {
    try {
      const res = await authFetch("/api/placeintel/admin/export");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `placeintel_export_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  // Unique states and tiers from data
  const uniqueStates = [...new Set(colleges.map((c: any) => c.state).filter(Boolean))].sort();
  const uniqueTiers = [...new Set(colleges.map((c: any) => c.tier).filter(Boolean))].sort();

  // Summary stats
  const statCounts = {
    total: colleges.length,
    submitted: colleges.filter((c: any) => c.placeintel_status === "submitted" || c.placeintel_status === "verified").length,
    in_progress: colleges.filter((c: any) => c.placeintel_status === "in_progress").length,
    invited: colleges.filter((c: any) => c.placeintel_status === "invited").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GraduationCap className="h-6 w-6" />
            PlaceIntel Admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Campus Placement Intelligence — manage submissions and invites</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Sync Board Hub
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{statCounts.total}</div>
            <div className="text-xs text-muted-foreground">Total Colleges</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-green-600">{statCounts.submitted}</div>
            <div className="text-xs text-muted-foreground">Submitted</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-yellow-600">{statCounts.in_progress}</div>
            <div className="text-xs text-muted-foreground">In Progress</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-blue-600">{statCounts.invited}</div>
            <div className="text-xs text-muted-foreground">Invited</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search colleges..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {uniqueStates.length > 0 && (
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="State" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {uniqueStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {uniqueTiers.length > 0 && (
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              {uniqueTiers.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>College</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Completeness</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {colleges.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No colleges found. Try syncing from Board Hub.
                    </TableCell>
                  </TableRow>
                )}
                {colleges.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{c.name}</div>
                        {c.city && <div className="text-xs text-muted-foreground">{c.city}</div>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{c.state || "—"}</TableCell>
                    <TableCell className="text-sm">{c.tier || "—"}</TableCell>
                    <TableCell><StatusBadge status={c.placeintel_status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <Progress value={c.completeness_score || 0} className="h-1.5 w-16" />
                        <span className="text-xs text-muted-foreground">{c.completeness_score || 0}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {/* View detail */}
                        <Sheet>
                          <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedCollegeId(c.id)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </SheetTrigger>
                          <SheetContent className="sm:max-w-xl overflow-y-auto">
                            <SheetHeader>
                              <SheetTitle>{c.name}</SheetTitle>
                            </SheetHeader>
                            {detailLoading ? (
                              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                            ) : collegeDetail ? (
                              <CollegeDetailView data={collegeDetail} onVerify={(action) => {
                                verifyMutation.mutate({ collegeId: c.id, action });
                              }} />
                            ) : (
                              <p className="text-sm text-muted-foreground py-4">No placement data available.</p>
                            )}
                          </SheetContent>
                        </Sheet>
                        {/* Invite */}
                        {(c.placeintel_status === "not_invited" || c.placeintel_status === "invited") && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                            setInviteCollegeId(c.id);
                            setInviteDialogOpen(true);
                          }}>
                            <Send className="h-4 w-4" />
                          </Button>
                        )}
                        {/* Verify */}
                        {c.placeintel_status === "submitted" && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" onClick={() => verifyMutation.mutate({ collegeId: c.id, action: "verify" })}>
                              <ShieldCheck className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => verifyMutation.mutate({ collegeId: c.id, action: "reject" })}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Invite</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email Address *</Label>
              <Input
                type="email"
                placeholder="tpo@college.ac.in"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input
                placeholder="Full name"
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
              />
            </div>
            <Button
              className="w-full"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending || !inviteEmail}
            >
              {inviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Send Invite
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== COLLEGE DETAIL VIEW ====================

function CollegeDetailView({ data, onVerify }: { data: any; onVerify: (action: string) => void }) {
  const { college, profile, programs, respondents } = data;

  return (
    <div className="space-y-6 mt-4">
      {/* College info */}
      <div>
        <h4 className="font-medium flex items-center gap-2 mb-2"><Building2 className="h-4 w-4" /> College Info</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">City:</span> {college.city || "—"}</div>
          <div><span className="text-muted-foreground">State:</span> {college.state || "—"}</div>
          <div><span className="text-muted-foreground">Tier:</span> {college.tier || "—"}</div>
          <div><span className="text-muted-foreground">Priority:</span> {college.priority || "—"}</div>
          <div><span className="text-muted-foreground">NIRF Rank:</span> {college.nirf_rank || "—"}</div>
        </div>
      </div>

      <Separator />

      {/* Respondents */}
      <div>
        <h4 className="font-medium flex items-center gap-2 mb-2"><Users className="h-4 w-4" /> Respondents ({respondents.length})</h4>
        {respondents.map((r: any) => (
          <div key={r.id} className="text-sm py-1 flex items-center gap-2">
            <Mail className="h-3 w-3 text-muted-foreground" />
            {r.email}
            {r.name && <span className="text-muted-foreground">({r.name})</span>}
            {r.is_verified && <Badge variant="secondary" className="text-[10px]">Verified</Badge>}
            {r.domain_verified && <Badge variant="secondary" className="text-[10px]">Domain OK</Badge>}
          </div>
        ))}
        {respondents.length === 0 && <p className="text-sm text-muted-foreground">No respondents yet.</p>}
      </div>

      {profile ? (
        <>
          <Separator />
          {/* Profile data */}
          <div>
            <h4 className="font-medium flex items-center gap-2 mb-2"><BarChart3 className="h-4 w-4" /> Placement Profile</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Academic Year:</span> {profile.academic_year || "—"}</div>
              <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={profile.status} /></div>
              <div><span className="text-muted-foreground">Completeness:</span> {profile.completeness_score}%</div>
              <div><span className="text-muted-foreground">Placement Rate:</span> {profile.overall_placement_rate ? `${profile.overall_placement_rate}%` : "—"}</div>
              <div><span className="text-muted-foreground">Eligible:</span> {profile.total_students_eligible || "—"}</div>
              <div><span className="text-muted-foreground">Placed:</span> {profile.total_students_placed || "—"}</div>
              <div><span className="text-muted-foreground">Companies Visited:</span> {profile.total_companies_visited || "—"}</div>
              <div><span className="text-muted-foreground">Median CTC:</span> {profile.median_ctc_last_year ? `${(profile.median_ctc_last_year / 100000).toFixed(1)} LPA` : "—"}</div>
              <div><span className="text-muted-foreground">Highest CTC:</span> {profile.highest_ctc_last_year ? `${(profile.highest_ctc_last_year / 100000).toFixed(1)} LPA` : "—"}</div>
              <div><span className="text-muted-foreground">Dream Policy:</span> {profile.dream_offer_policy || "—"}</div>
            </div>

            {profile.top_recruiters?.length > 0 && (
              <div className="mt-2">
                <span className="text-sm text-muted-foreground">Top Recruiters:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {profile.top_recruiters.map((r: string) => <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>)}
                </div>
              </div>
            )}
            {profile.sectors_hiring?.length > 0 && (
              <div className="mt-2">
                <span className="text-sm text-muted-foreground">Sectors:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {profile.sectors_hiring.map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                </div>
              </div>
            )}

            {profile.placement_cell_head && (
              <div className="mt-2 text-sm">
                <span className="text-muted-foreground">Placement Head:</span> {profile.placement_cell_head}
                {profile.placement_cell_email && ` (${profile.placement_cell_email})`}
              </div>
            )}

            {profile.placement_season_start && (
              <div className="mt-1 text-sm">
                <span className="text-muted-foreground">Season:</span> {profile.placement_season_start} → {profile.placement_season_end}
              </div>
            )}
          </div>

          {/* Programs */}
          {programs.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="font-medium flex items-center gap-2 mb-2"><GraduationCap className="h-4 w-4" /> Programs ({programs.length})</h4>
                {programs.map((p: any) => (
                  <div key={p.id} className="border rounded-md p-3 mb-2 text-sm space-y-1">
                    <div className="font-medium">{p.program_name}{p.specialization ? ` — ${p.specialization}` : ""}</div>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {p.placement_rate && <div>Placement: {p.placement_rate}%</div>}
                      {p.intake_count && <div>Intake: {p.intake_count}</div>}
                      {p.avg_ctc && <div>Avg CTC: {(p.avg_ctc / 100000).toFixed(1)} LPA</div>}
                      {p.median_ctc && <div>Median CTC: {(p.median_ctc / 100000).toFixed(1)} LPA</div>}
                      {p.min_ctc && <div>Min CTC: {(p.min_ctc / 100000).toFixed(1)} LPA</div>}
                      {p.max_ctc && <div>Max CTC: {(p.max_ctc / 100000).toFixed(1)} LPA</div>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Verify/Reject buttons */}
          {profile.status === "submitted" && (
            <>
              <Separator />
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => onVerify("verify")}>
                  <ShieldCheck className="h-4 w-4 mr-1" /> Verify Submission
                </Button>
                <Button variant="destructive" className="flex-1" onClick={() => onVerify("reject")}>
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <Separator />
          <p className="text-sm text-muted-foreground">No placement profile submitted yet.</p>
        </>
      )}
    </div>
  );
}
