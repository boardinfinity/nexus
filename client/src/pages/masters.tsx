import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Search, Plus, Pencil, Trash2, Loader2, ArrowUpDown,
} from "lucide-react";

// ==================== TYPES ====================

interface JobRole {
  id: string;
  name: string;
  family: string;
  synonyms: string[];
  created_at: string;
}

interface MasterSummary {
  job_roles: number;
  skills: number;
  job_families: number;
  job_industries: number;
  job_functions: number;
}

const FAMILIES = ["Management", "Technology", "Core Engineering", "Others"];

type SortKey = "name" | "family" | "synonyms";
type SortDir = "asc" | "desc";

// ==================== JOB ROLES TAB ====================

function JobRolesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [editRole, setEditRole] = useState<JobRole | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteRole, setDeleteRole] = useState<JobRole | null>(null);

  const { data: roles, isLoading } = useQuery<JobRole[]>({
    queryKey: ["/api/masters/job-roles"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/job-roles");
      if (!res.ok) throw new Error("Failed to fetch job roles");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: { name: string; family: string; synonyms: string[] }) => {
      const res = await apiRequest("POST", "/api/masters/job-roles", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Role created" });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/job-roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/summary"] });
      setShowAdd(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name: string; family: string; synonyms: string[] }) => {
      const res = await apiRequest("PUT", `/api/masters/job-roles/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Role updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/job-roles"] });
      setEditRole(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/masters/job-roles/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to delete");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Role deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/job-roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/summary"] });
      setDeleteRole(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    if (!roles) return [];
    let result = roles;
    if (familyFilter !== "all") {
      result = result.filter(r => r.family === familyFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.synonyms?.some(s => s.toLowerCase().includes(q))
      );
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "family") cmp = a.family.localeCompare(b.family);
      else if (sortKey === "synonyms") cmp = (a.synonyms?.length || 0) - (b.synonyms?.length || 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [roles, familyFilter, search, sortKey, sortDir]);

  const totalSynonyms = roles?.reduce((s, r) => s + (r.synonyms?.length || 0), 0) ?? 0;
  const uniqueFamilies = new Set(roles?.map(r => r.family) || []);

  return (
    <div className="space-y-4">
      {/* Summary + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          {roles?.length ?? 0} roles &bull; {totalSynonyms} synonyms &bull; {uniqueFamilies.size} families
        </p>
        <div className="flex items-center gap-2">
          <Select value={familyFilter} onValueChange={v => setFamilyFilter(v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All Families" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Families</SelectItem>
              {FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search roles or synonyms..."
              className="pl-9 w-56"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Role
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                      <span className="inline-flex items-center gap-1">Name <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("family")}>
                      <span className="inline-flex items-center gap-1">Family <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium">Synonyms</th>
                    <th className="text-center p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("synonyms")}>
                      <span className="inline-flex items-center gap-1">Count <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium">Created</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(role => (
                    <tr
                      key={role.id}
                      className="border-b hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-3 font-medium">{role.name}</td>
                      <td className="p-3">
                        <Badge variant="secondary" className="text-xs">{role.family}</Badge>
                      </td>
                      <td className="p-3 text-muted-foreground text-xs max-w-xs truncate" title={role.synonyms?.join(", ")}>
                        {role.synonyms?.slice(0, 3).join(", ")}
                        {(role.synonyms?.length || 0) > 3 && ` +${role.synonyms.length - 3} more`}
                      </td>
                      <td className="p-3 text-center">{role.synonyms?.length || 0}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(role.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditRole(role)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteRole(role)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        {search || familyFilter !== "all" ? "No roles match your filters" : "No job roles found"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <RoleDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        onSave={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        title="Add Job Role"
      />

      {/* Edit Dialog */}
      <RoleDialog
        open={!!editRole}
        onOpenChange={(open) => { if (!open) setEditRole(null); }}
        onSave={(data) => editRole && updateMutation.mutate({ id: editRole.id, ...data })}
        isPending={updateMutation.isPending}
        title="Edit Job Role"
        initial={editRole || undefined}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteRole} onOpenChange={(open) => { if (!open) setDeleteRole(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteRole?.name}?</DialogTitle>
            <DialogDescription>
              This will permanently remove this role and its synonyms. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRole(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteRole && deleteMutation.mutate(deleteRole.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== ROLE DIALOG ====================

function RoleDialog({
  open,
  onOpenChange,
  onSave,
  isPending,
  title,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { name: string; family: string; synonyms: string[] }) => void;
  isPending: boolean;
  title: string;
  initial?: { name: string; family: string; synonyms: string[] };
}) {
  const [name, setName] = useState(initial?.name || "");
  const [family, setFamily] = useState(initial?.family || "");
  const [synonymsText, setSynonymsText] = useState(initial?.synonyms?.join("\n") || "");

  // Reset form when dialog opens with new initial values
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setName(initial?.name || "");
      setFamily(initial?.family || "");
      setSynonymsText(initial?.synonyms?.join("\n") || "");
    }
    onOpenChange(open);
  };

  const parsedSynonyms = synonymsText
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const handleSave = () => {
    if (!name.trim() || !family) return;
    onSave({ name: name.trim(), family, synonyms: parsedSynonyms });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Name</label>
            <Input
              placeholder="e.g. Backend Engineer"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Family</label>
            <Select value={family} onValueChange={setFamily}>
              <SelectTrigger>
                <SelectValue placeholder="Select family..." />
              </SelectTrigger>
              <SelectContent>
                {FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Synonyms</label>
              <span className="text-xs text-muted-foreground">{parsedSynonyms.length} synonyms</span>
            </div>
            <Textarea
              placeholder="One per line or comma-separated&#10;e.g. Backend Developer, Back End Engineer"
              value={synonymsText}
              onChange={e => setSynonymsText(e.target.value)}
              rows={5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isPending || !name.trim() || !family}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== FUTURE TAB PLACEHOLDER ====================

function FutureTab({ label, count }: { label: string; count: number }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Badge variant="secondary" className="mb-3">Coming soon</Badge>
        <p className="text-muted-foreground text-sm">
          {count > 0 ? `${count} ${label.toLowerCase()} in the database` : `${label} management coming soon`}
        </p>
      </CardContent>
    </Card>
  );
}

// ==================== MAIN COMPONENT ====================

export default function MasterData() {
  const [activeTab, setActiveTab] = useState("job-roles");

  const { data: summary } = useQuery<MasterSummary>({
    queryKey: ["/api/masters/summary"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/summary");
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Master Data Management</h1>
        <p className="text-sm text-muted-foreground">Manage reference data tables — job roles, skills, families, industries, and functions</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="job-roles">
            Job Roles {summary && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{summary.job_roles}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="skills">
            Skills {summary && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{summary.skills}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="families">
            Job Families {summary && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{summary.job_families}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="industries">
            Industries {summary && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{summary.job_industries}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="functions">
            Functions {summary && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{summary.job_functions}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="job-roles">
          <JobRolesTab />
        </TabsContent>

        <TabsContent value="skills">
          <FutureTab label="Skills" count={summary?.skills ?? 0} />
        </TabsContent>

        <TabsContent value="families">
          <FutureTab label="Job Families" count={summary?.job_families ?? 0} />
        </TabsContent>

        <TabsContent value="industries">
          <FutureTab label="Industries" count={summary?.job_industries ?? 0} />
        </TabsContent>

        <TabsContent value="functions">
          <FutureTab label="Functions" count={summary?.job_functions ?? 0} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
