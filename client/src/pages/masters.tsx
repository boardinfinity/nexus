import { useState, useMemo, useEffect } from "react";
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

interface College {
  id: string;
  name: string;
  short_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  degree_level: string | null;
  nirf_rank: number | null;
  ranking_source: string | null;
  ranking_year: number | null;
  ranking_score: number | null;
  tier: string | null;
  linkedin_slug: string | null;
  website: string | null;
  created_at: string;
  updated_at: string | null;
}

interface MasterSummary {
  job_roles: number;
  skills: number;
  job_families: number;
  job_industries: number;
  job_functions: number;
  colleges: number;
}

const FAMILIES = ["Management", "Technology", "Core Engineering", "Others"];
const DEGREE_LEVELS = ["MBA", "Engineering", "Medical", "Law", "Pharmacy", "Arts", "Science", "Commerce"];
const TIERS = ["Top 10", "Top 25", "Top 50", "Top 100", "Unranked"];

type SortKey = "name" | "family" | "synonyms";
type SortDir = "asc" | "desc";

type CollegeSortKey = "nirf_rank" | "name" | "ranking_score";
type CollegeSortDir = "asc" | "desc";

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

  // Sync state whenever initial data changes (e.g. switching between edit targets)
  useEffect(() => {
    setName(initial?.name || "");
    setFamily(initial?.family || "");
    setSynonymsText(initial?.synonyms?.join("\n") || "");
  }, [initial?.name, initial?.family, initial?.synonyms]);

  const handleOpenChange = (open: boolean) => {
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

// ==================== COLLEGES TAB ====================

function CollegesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [degreeLevelFilter, setDegreeLevelFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [sortKey, setSortKey] = useState<CollegeSortKey>("nirf_rank");
  const [sortDir, setSortDir] = useState<CollegeSortDir>("asc");
  const [editCollege, setEditCollege] = useState<College | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteCollege, setDeleteCollege] = useState<College | null>(null);

  const { data: colleges, isLoading } = useQuery<College[]>({
    queryKey: ["/api/masters/colleges"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/colleges");
      if (!res.ok) throw new Error("Failed to fetch colleges");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Partial<College>) => {
      const res = await apiRequest("POST", "/api/masters/colleges", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "College created" });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/colleges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/summary"] });
      setShowAdd(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: Partial<College> & { id: string }) => {
      const res = await apiRequest("PUT", `/api/masters/colleges/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "College updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/colleges"] });
      setEditCollege(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/masters/colleges/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      return data;
    },
    onSuccess: () => {
      toast({ title: "College deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/colleges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/summary"] });
      setDeleteCollege(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleSort = (key: CollegeSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const uniqueCountries = useMemo(() => {
    if (!colleges) return [];
    return Array.from(new Set(colleges.map(c => c.country).filter(Boolean))).sort() as string[];
  }, [colleges]);

  const uniqueStates = useMemo(() => {
    if (!colleges) return [];
    return Array.from(new Set(colleges.map(c => c.state).filter(Boolean))).sort() as string[];
  }, [colleges]);

  const filtered = useMemo(() => {
    if (!colleges) return [];
    let result = colleges;
    if (countryFilter !== "all") result = result.filter(c => c.country === countryFilter);
    if (degreeLevelFilter !== "all") result = result.filter(c => c.degree_level === degreeLevelFilter);
    if (tierFilter !== "all") result = result.filter(c => c.tier === tierFilter);
    if (stateFilter !== "all") result = result.filter(c => c.state === stateFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.short_name?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "nirf_rank") cmp = (a.nirf_rank ?? 9999) - (b.nirf_rank ?? 9999);
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "ranking_score") cmp = (a.ranking_score ?? 0) - (b.ranking_score ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [colleges, countryFilter, degreeLevelFilter, tierFilter, stateFilter, search, sortKey, sortDir]);

  const uniqueDegreeLevels = new Set(colleges?.map(c => c.degree_level).filter(Boolean) || []);
  const uniqueCountriesCount = new Set(colleges?.map(c => c.country).filter(Boolean) || []);

  return (
    <div className="space-y-4">
      {/* Summary + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          {colleges?.length ?? 0} colleges &bull; {uniqueCountriesCount.size} {uniqueCountriesCount.size === 1 ? "country" : "countries"} &bull; {Array.from(uniqueDegreeLevels).join(", ") || "—"}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={countryFilter} onValueChange={v => setCountryFilter(v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All Countries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              {uniqueCountries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={degreeLevelFilter} onValueChange={v => setDegreeLevelFilter(v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All Degrees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Degrees</SelectItem>
              {DEGREE_LEVELS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={tierFilter} onValueChange={v => setTierFilter(v)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="All Tiers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tiers</SelectItem>
              {TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={v => setStateFilter(v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All States" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {uniqueStates.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search colleges..."
              className="pl-9 w-56"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add College
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
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("nirf_rank")}>
                      <span className="inline-flex items-center gap-1">Rank <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                      <span className="inline-flex items-center gap-1">Name <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium">Short Name</th>
                    <th className="text-left p-3 font-medium">City</th>
                    <th className="text-left p-3 font-medium">State</th>
                    <th className="text-left p-3 font-medium">Tier</th>
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("ranking_score")}>
                      <span className="inline-flex items-center gap-1">Score <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium">Degree</th>
                    <th className="text-left p-3 font-medium">LinkedIn Slug</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(college => (
                    <tr key={college.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="p-3 text-center font-medium">{college.nirf_rank ?? "—"}</td>
                      <td className="p-3 font-medium">{college.name}</td>
                      <td className="p-3 text-muted-foreground">{college.short_name ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">{college.city ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">{college.state ?? "—"}</td>
                      <td className="p-3">
                        {college.tier ? <Badge variant="secondary" className="text-xs">{college.tier}</Badge> : "—"}
                      </td>
                      <td className="p-3">{college.ranking_score ?? "—"}</td>
                      <td className="p-3">
                        {college.degree_level ? <Badge variant="outline" className="text-xs">{college.degree_level}</Badge> : "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[120px] truncate" title={college.linkedin_slug ?? undefined}>
                        {college.linkedin_slug ?? "—"}
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditCollege(college)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteCollege(college)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-8 text-center text-muted-foreground">
                        {search || countryFilter !== "all" || degreeLevelFilter !== "all" || tierFilter !== "all" || stateFilter !== "all"
                          ? "No colleges match your filters"
                          : "No colleges found"}
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
      <CollegeDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        onSave={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        title="Add College"
      />

      {/* Edit Dialog */}
      <CollegeDialog
        open={!!editCollege}
        onOpenChange={(open) => { if (!open) setEditCollege(null); }}
        onSave={(data) => editCollege && updateMutation.mutate({ id: editCollege.id, ...data })}
        isPending={updateMutation.isPending}
        title="Edit College"
        initial={editCollege || undefined}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteCollege} onOpenChange={(open) => { if (!open) setDeleteCollege(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteCollege?.name}?</DialogTitle>
            <DialogDescription>
              This will permanently remove this college. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCollege(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteCollege && deleteMutation.mutate(deleteCollege.id)}
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

// ==================== COLLEGE DIALOG ====================

function CollegeDialog({
  open,
  onOpenChange,
  onSave,
  isPending,
  title,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: Partial<College>) => void;
  isPending: boolean;
  title: string;
  initial?: College;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [shortName, setShortName] = useState(initial?.short_name || "");
  const [city, setCity] = useState(initial?.city || "");
  const [state, setState] = useState(initial?.state || "");
  const [country, setCountry] = useState(initial?.country || "");
  const [degreeLevel, setDegreeLevel] = useState(initial?.degree_level || "");
  const [rankingSource, setRankingSource] = useState(initial?.ranking_source || "");
  const [rankingYear, setRankingYear] = useState(initial?.ranking_year?.toString() || "");
  const [nirfRank, setNirfRank] = useState(initial?.nirf_rank?.toString() || "");
  const [rankingScore, setRankingScore] = useState(initial?.ranking_score?.toString() || "");
  const [tier, setTier] = useState(initial?.tier || "");
  const [linkedinSlug, setLinkedinSlug] = useState(initial?.linkedin_slug || "");
  const [website, setWebsite] = useState(initial?.website || "");

  useEffect(() => {
    setName(initial?.name || "");
    setShortName(initial?.short_name || "");
    setCity(initial?.city || "");
    setState(initial?.state || "");
    setCountry(initial?.country || "");
    setDegreeLevel(initial?.degree_level || "");
    setRankingSource(initial?.ranking_source || "");
    setRankingYear(initial?.ranking_year?.toString() || "");
    setNirfRank(initial?.nirf_rank?.toString() || "");
    setRankingScore(initial?.ranking_score?.toString() || "");
    setTier(initial?.tier || "");
    setLinkedinSlug(initial?.linkedin_slug || "");
    setWebsite(initial?.website || "");
  }, [initial]);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      short_name: shortName.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      country: country.trim() || null,
      degree_level: degreeLevel || null,
      ranking_source: rankingSource.trim() || null,
      ranking_year: rankingYear ? parseInt(rankingYear) : null,
      nirf_rank: nirfRank ? parseInt(nirfRank) : null,
      ranking_score: rankingScore ? parseFloat(rankingScore) : null,
      tier: tier || null,
      linkedin_slug: linkedinSlug.trim() || null,
      website: website.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Name *</label>
            <Input placeholder="e.g. Indian Institute of Management Ahmedabad" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Short Name</label>
              <Input placeholder="e.g. IIM-A" value={shortName} onChange={e => setShortName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Country</label>
              <Input placeholder="e.g. India" value={country} onChange={e => setCountry(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">City</label>
              <Input placeholder="e.g. Ahmedabad" value={city} onChange={e => setCity(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">State</label>
              <Input placeholder="e.g. Gujarat" value={state} onChange={e => setState(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Degree Level</label>
              <Select value={degreeLevel} onValueChange={setDegreeLevel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select degree..." />
                </SelectTrigger>
                <SelectContent>
                  {DEGREE_LEVELS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Tier</label>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tier..." />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Ranking Source</label>
              <Input placeholder="e.g. NIRF" value={rankingSource} onChange={e => setRankingSource(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Ranking Year</label>
              <Input type="number" placeholder="e.g. 2025" value={rankingYear} onChange={e => setRankingYear(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">NIRF Rank</label>
              <Input type="number" placeholder="e.g. 1" value={nirfRank} onChange={e => setNirfRank(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Ranking Score</label>
              <Input type="number" step="0.01" placeholder="e.g. 82.75" value={rankingScore} onChange={e => setRankingScore(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">LinkedIn Slug</label>
            <Input placeholder="e.g. iim-ahmedabad" value={linkedinSlug} onChange={e => setLinkedinSlug(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Website</label>
            <Input placeholder="e.g. https://iima.ac.in" value={website} onChange={e => setWebsite(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isPending || !name.trim()}>
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
          <TabsTrigger value="colleges">
            Colleges {summary && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{summary.colleges}</Badge>}
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

        <TabsContent value="colleges">
          <CollegesTab />
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
