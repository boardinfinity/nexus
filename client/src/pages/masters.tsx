import { useState, useMemo, useEffect, Fragment } from "react";
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
  Info, ChevronRight, ChevronDown, ShieldCheck, Archive,
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
  job_buckets: number;
}

interface JobBucket {
  id: string;
  bucket_code: string;
  name: string;
  description: string | null;
  bucket_scope: string | null;
  function_id: string | null;
  function_name: string | null;
  family_id: string | null;
  family_name: string | null;
  industry_id: string | null;
  industry_name: string | null;
  seniority_level: string | null;
  standardized_title: string | null;
  company_type: string | null;
  geography_scope: string | null;
  nature_of_work: string | null;
  exclusion_rules: string[] | null;
  status: "candidate" | "validated" | "deprecated" | "merged";
  confidence_threshold: number | null;
  mention_count: number | null;
  company_count: number | null;
  evidence_count: number | null;
  source: string | null;
  first_seen_at: string | null;
  validated_at: string | null;
  validated_by: string | null;
  deprecated_at: string | null;
  merged_into_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  alias_count: number;
  job_count: number;
}

interface JobBucketDetail extends JobBucket {
  aliases: Array<{ id: string; alias: string; alias_norm: string; source: string | null; confidence: number | null; created_at: string }>;
  overlays: Array<{ id: string; overlay_type: string; program_type: string | null; college_segment: string | null; geography: string | null; ctc_min: number | null; ctc_median: number | null; ctc_max: number | null; ctc_currency: string | null; evidence_count: number | null; updated_at: string }>;
  evidence_count_actual: number;
  skill_map_count: number;
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

// ==================== BUCKETS TAB ====================

const BUCKET_STATUS_OPTIONS = ["all", "candidate", "validated", "deprecated", "merged"] as const;

type BucketSortKey = "name" | "status" | "bucket_code" | "job_count" | "alias_count" | "updated_at";

function bucketStatusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "validated") return "default";
  if (status === "candidate") return "secondary";
  if (status === "deprecated") return "outline";
  if (status === "merged") return "outline";
  return "secondary";
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function BucketsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  const [geoFilter, setGeoFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<BucketSortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusAction, setStatusAction] = useState<{ bucket: JobBucket; next: "validated" | "deprecated" } | null>(null);

  const { data: buckets, isLoading } = useQuery<JobBucket[]>({
    queryKey: ["/api/masters/buckets"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/buckets");
      if (!res.ok) throw new Error("Failed to fetch buckets");
      return res.json();
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "validated" | "deprecated" }) => {
      const res = await apiRequest("PATCH", `/api/masters/buckets/${id}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bucket status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/buckets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/masters/summary"] });
      if (expandedId) {
        queryClient.invalidateQueries({ queryKey: ["/api/masters/buckets", expandedId] });
      }
      setStatusAction(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleSort = (key: BucketSortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const uniqueScopes = useMemo(() => {
    if (!buckets) return [];
    return Array.from(new Set(buckets.map(b => b.bucket_scope).filter(Boolean))).sort() as string[];
  }, [buckets]);

  const uniqueGeos = useMemo(() => {
    if (!buckets) return [];
    return Array.from(new Set(buckets.map(b => b.geography_scope).filter(Boolean))).sort() as string[];
  }, [buckets]);

  const filtered = useMemo(() => {
    if (!buckets) return [];
    let result = buckets;
    if (statusFilter !== "all") result = result.filter(b => b.status === statusFilter);
    if (scopeFilter !== "all") result = result.filter(b => b.bucket_scope === scopeFilter);
    if (geoFilter !== "all") result = result.filter(b => b.geography_scope === geoFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(b =>
        b.bucket_code?.toLowerCase().includes(q) ||
        b.name?.toLowerCase().includes(q) ||
        b.standardized_title?.toLowerCase().includes(q) ||
        b.company_type?.toLowerCase().includes(q) ||
        b.geography_scope?.toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
      else if (sortKey === "bucket_code") cmp = a.bucket_code.localeCompare(b.bucket_code);
      else if (sortKey === "job_count") cmp = (a.job_count || 0) - (b.job_count || 0);
      else if (sortKey === "alias_count") cmp = (a.alias_count || 0) - (b.alias_count || 0);
      else if (sortKey === "updated_at") cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [buckets, statusFilter, scopeFilter, geoFilter, search, sortKey, sortDir]);

  const counts = useMemo(() => {
    const out = { total: buckets?.length ?? 0, candidate: 0, validated: 0, deprecated: 0, merged: 0 };
    for (const b of buckets || []) {
      if (b.status in out) (out as any)[b.status] += 1;
    }
    return out;
  }, [buckets]);

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <Card>
        <CardContent className="py-3 px-4 flex items-start gap-3">
          <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            Job buckets are canonical, globally-scoped role archetypes. Program / college / geography
            variants live as overlays on each bucket. <span className="font-medium text-foreground">Candidate</span> buckets
            are admin-only and are not visible to non-admin users until they are validated. Use
            <span className="font-medium text-foreground"> Validate</span> to promote candidate → validated, or
            <span className="font-medium text-foreground"> Deprecate</span> to retire a validated bucket. Merge / reject
            are not available in this release.
          </div>
        </CardContent>
      </Card>

      {/* Summary + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          {counts.total} buckets &bull; {counts.validated} validated &bull; {counts.candidate} candidate
          {counts.deprecated > 0 && <> &bull; {counts.deprecated} deprecated</>}
          {counts.merged > 0 && <> &bull; {counts.merged} merged</>}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              {BUCKET_STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {uniqueScopes.length > 0 && (
            <Select value={scopeFilter} onValueChange={setScopeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Scopes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Scopes</SelectItem>
                {uniqueScopes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {uniqueGeos.length > 0 && (
            <Select value={geoFilter} onValueChange={setGeoFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="All Geographies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Geographies</SelectItem>
                {uniqueGeos.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search code / name / title..."
              className="pl-9 w-64"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
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
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="w-8" />
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("bucket_code")}>
                      <span className="inline-flex items-center gap-1">Code <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                      <span className="inline-flex items-center gap-1">Name <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("status")}>
                      <span className="inline-flex items-center gap-1">Status <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium">Scope</th>
                    <th className="text-left p-3 font-medium">Function</th>
                    <th className="text-left p-3 font-medium">Family</th>
                    <th className="text-left p-3 font-medium">Industry</th>
                    <th className="text-left p-3 font-medium">Geography</th>
                    <th className="text-left p-3 font-medium">Company Type</th>
                    <th className="text-right p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("job_count")}>
                      <span className="inline-flex items-center gap-1">Jobs <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-right p-3 font-medium">Mentions</th>
                    <th className="text-right p-3 font-medium">Companies</th>
                    <th className="text-right p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("alias_count")}>
                      <span className="inline-flex items-center gap-1">Aliases <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-left p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("updated_at")}>
                      <span className="inline-flex items-center gap-1">Updated <ArrowUpDown className="h-3 w-3" /></span>
                    </th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(bucket => {
                    const isExpanded = expandedId === bucket.id;
                    return (
                      <Fragment key={bucket.id}>
                        <tr
                          className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : bucket.id)}
                        >
                          <td className="p-3 align-top">
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </td>
                          <td className="p-3 font-mono text-xs whitespace-nowrap">{bucket.bucket_code}</td>
                          <td className="p-3 font-medium">{bucket.name}</td>
                          <td className="p-3">
                            <Badge variant={bucketStatusVariant(bucket.status)} className="text-xs capitalize">
                              {bucket.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-muted-foreground text-xs">{bucket.bucket_scope ?? "—"}</td>
                          <td className="p-3 text-xs" title={bucket.function_id ?? undefined}>
                            {bucket.function_name ?? bucket.function_id ?? "—"}
                          </td>
                          <td className="p-3 text-xs" title={bucket.family_id ?? undefined}>
                            {bucket.family_name ?? bucket.family_id ?? "—"}
                          </td>
                          <td className="p-3 text-xs" title={bucket.industry_id ?? undefined}>
                            {bucket.industry_name ?? bucket.industry_id ?? "—"}
                          </td>
                          <td className="p-3 text-muted-foreground text-xs">{bucket.geography_scope ?? "—"}</td>
                          <td className="p-3 text-muted-foreground text-xs">{bucket.company_type ?? "—"}</td>
                          <td className="p-3 text-right tabular-nums">{bucket.job_count ?? 0}</td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">{bucket.mention_count ?? 0}</td>
                          <td className="p-3 text-right tabular-nums text-muted-foreground">{bucket.company_count ?? 0}</td>
                          <td className="p-3 text-right tabular-nums">{bucket.alias_count ?? 0}</td>
                          <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(bucket.updated_at)}</td>
                          <td className="p-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            {bucket.status === "candidate" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-green-700 hover:text-green-800 hover:bg-green-50"
                                onClick={() => setStatusAction({ bucket, next: "validated" })}
                                title="Promote candidate to validated"
                              >
                                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                                Validate
                              </Button>
                            )}
                            {bucket.status === "validated" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-amber-700 hover:text-amber-800 hover:bg-amber-50"
                                onClick={() => setStatusAction({ bucket, next: "deprecated" })}
                                title="Deprecate this bucket"
                              >
                                <Archive className="h-3.5 w-3.5 mr-1" />
                                Deprecate
                              </Button>
                            )}
                            {(bucket.status === "deprecated" || bucket.status === "merged") && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-muted/20 border-b">
                            <td colSpan={16} className="p-4">
                              <BucketDetailPanel bucketId={bucket.id} summary={bucket} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={16} className="p-8 text-center text-muted-foreground">
                        {search || statusFilter !== "all" || scopeFilter !== "all" || geoFilter !== "all"
                          ? "No buckets match your filters"
                          : "No buckets found"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status change confirmation */}
      <Dialog open={!!statusAction} onOpenChange={(open) => { if (!open) setStatusAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {statusAction?.next === "validated" ? "Validate" : "Deprecate"} bucket?
            </DialogTitle>
            <DialogDescription>
              {statusAction && (
                <>
                  <span className="font-medium">{statusAction.bucket.bucket_code}</span> &mdash; {statusAction.bucket.name}
                  <br />
                  {statusAction.next === "validated"
                    ? "This bucket will become visible to all authenticated users and may be assigned to jobs by the resolver."
                    : "Deprecated buckets are kept for history but should not be used for new assignments."}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusAction(null)}>Cancel</Button>
            <Button
              onClick={() => statusAction && updateStatusMutation.mutate({ id: statusAction.bucket.id, status: statusAction.next })}
              disabled={updateStatusMutation.isPending}
            >
              {updateStatusMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {statusAction?.next === "validated" ? "Validate" : "Deprecate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BucketDetailPanel({ bucketId, summary }: { bucketId: string; summary: JobBucket }) {
  const { data, isLoading } = useQuery<JobBucketDetail>({
    queryKey: ["/api/masters/buckets", bucketId],
    queryFn: async () => {
      const res = await authFetch(`/api/masters/buckets/${bucketId}`);
      if (!res.ok) throw new Error("Failed to fetch bucket detail");
      return res.json();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const detail = data ?? (summary as JobBucketDetail);

  return (
    <div className="space-y-4">
      {detail.description && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Description</div>
          <p className="text-sm">{detail.description}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Field label="Standardized Title" value={detail.standardized_title} />
        <Field label="Seniority Level" value={detail.seniority_level} />
        <Field label="Nature of Work" value={detail.nature_of_work} />
        <Field label="Source" value={detail.source} />
        <Field label="Confidence Threshold" value={detail.confidence_threshold?.toString() ?? null} />
        <Field label="First Seen" value={fmtDate(detail.first_seen_at)} />
        <Field label="Validated At" value={fmtDate(detail.validated_at)} />
        <Field label="Validated By" value={detail.validated_by} />
      </div>

      {detail.exclusion_rules && detail.exclusion_rules.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Exclusion Rules</div>
          <div className="flex flex-wrap gap-1">
            {detail.exclusion_rules.map((r, i) => (
              <Badge key={i} variant="outline" className="text-xs">{r}</Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <CountTile label="Aliases" value={(data?.aliases?.length ?? summary.alias_count) || 0} />
        <CountTile label="Overlays" value={data?.overlays?.length ?? 0} />
        <CountTile label="Evidence" value={data?.evidence_count_actual ?? summary.evidence_count ?? 0} />
        <CountTile label="Skill Map" value={data?.skill_map_count ?? 0} />
      </div>

      {data?.aliases && data.aliases.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Aliases ({data.aliases.length})</div>
          <div className="flex flex-wrap gap-1">
            {data.aliases.slice(0, 30).map(a => (
              <Badge key={a.id} variant="secondary" className="text-xs font-normal">{a.alias}</Badge>
            ))}
            {data.aliases.length > 30 && (
              <span className="text-xs text-muted-foreground self-center">+{data.aliases.length - 30} more</span>
            )}
          </div>
        </div>
      )}

      {data?.overlays && data.overlays.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Overlays ({data.overlays.length})</div>
          <div className="border rounded text-xs overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left p-2 font-medium">Type</th>
                  <th className="text-left p-2 font-medium">Program</th>
                  <th className="text-left p-2 font-medium">Segment</th>
                  <th className="text-left p-2 font-medium">Geography</th>
                  <th className="text-right p-2 font-medium">CTC Median</th>
                  <th className="text-right p-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {data.overlays.map(o => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="p-2 capitalize">{o.overlay_type}</td>
                    <td className="p-2">{o.program_type ?? "—"}</td>
                    <td className="p-2">{o.college_segment ?? "—"}</td>
                    <td className="p-2">{o.geography ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">
                      {o.ctc_median != null ? `${o.ctc_currency ?? ""} ${o.ctc_median}` : "—"}
                    </td>
                    <td className="p-2 text-right tabular-nums">{o.evidence_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t">
        <Button variant="outline" size="sm" disabled title="Merge is not yet implemented">
          Merge into… (not yet available)
        </Button>
        <Button variant="outline" size="sm" disabled title="Reject is not yet implemented">
          Reject (not yet available)
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
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
          <TabsTrigger value="buckets">
            Buckets {summary && <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{summary.job_buckets ?? 0}</Badge>}
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

        <TabsContent value="buckets">
          <BucketsTab />
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
