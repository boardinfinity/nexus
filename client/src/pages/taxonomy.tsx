import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Flame, TrendingUp, Search, Pencil, Check, X, Briefcase, GraduationCap, FileText, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TaxonomySkill {
  id: string;
  external_id: string;
  name: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  source: string;
  is_hot_technology: boolean;
  is_in_demand: boolean;
  aliases: string[];
  job_count: number;
  created_at: string;
}

interface TaxonomyStats {
  total: number;
  by_category: Record<string, number>;
  hot_technologies: number;
  top_skills: Array<{ name: string; job_count: number }>;
}

interface LinkedData {
  jobs: Array<{ id: string; title: string; company_name: string; source: string }>;
  courses: Array<{ id: string; course_code: string; title: string; college_id: string }>;
  reports: Array<{ id: string; title: string; report_type: string; created_at: string }>;
}

const categoryColors: Record<string, string> = {
  skill: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  knowledge: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ability: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  technology: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  soft_skill: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
};

const categoryTabs = [
  { value: "all", label: "All" },
  { value: "skill", label: "Skill" },
  { value: "knowledge", label: "Knowledge" },
  { value: "ability", label: "Ability" },
  { value: "technology", label: "Technology" },
];

export default function Taxonomy() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedSkill, setSelectedSkill] = useState<TaxonomySkill | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [sortCol, setSortCol] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  function toggleSort(col: string) {
    if (sortCol === col) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortOrder(col === "job_count" ? "desc" : "asc");
    }
    setPage(1);
  }

  function SortIcon({ col }: { col: string }) {
    if (sortCol !== col) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  }

  const { data: stats } = useQuery<TaxonomyStats>({
    queryKey: ["/api/taxonomy/stats"],
    queryFn: async () => {
      const res = await authFetch("/api/taxonomy/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<{ data: TaxonomySkill[]; total: number }>({
    queryKey: ["/api/taxonomy", page, category, search, sortCol, sortOrder],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50", sort: sortCol, order: sortOrder });
      if (category && category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      const res = await authFetch(`/api/taxonomy?${params}`);
      if (!res.ok) throw new Error("Failed to fetch taxonomy");
      return res.json();
    },
  });

  const { data: linkedData } = useQuery<LinkedData>({
    queryKey: ["/api/taxonomy", selectedSkill?.id, "linked"],
    queryFn: async () => {
      const res = await authFetch(`/api/taxonomy/${selectedSkill!.id}/linked`);
      if (!res.ok) throw new Error("Failed to fetch linked data");
      return res.json();
    },
    enabled: !!selectedSkill?.id,
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/taxonomy/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Skill updated", description: "Skill name has been changed." });
      queryClient.invalidateQueries({ queryKey: ["/api/taxonomy"] });
      setEditingId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  function startEdit(skill: TaxonomySkill, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(skill.id);
    setEditName(skill.name);
  }

  function saveEdit(e: React.MouseEvent) {
    e.stopPropagation();
    if (editingId && editName.trim()) {
      editMutation.mutate({ id: editingId, name: editName.trim() });
    }
  }

  function cancelEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(null);
    setEditName("");
  }

  return (
    <div className="space-y-6" data-testid="taxonomy-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Skill Taxonomy</h1>
        <p className="text-sm text-muted-foreground">Browse and search the O*NET skill taxonomy</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats?.total != null ? stats.total.toLocaleString() : "—"}</div>
            <p className="text-xs text-muted-foreground">Total Skills</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              <div>
                <div className="text-2xl font-bold">{stats?.hot_technologies != null ? stats.hot_technologies.toLocaleString() : "—"}</div>
                <p className="text-xs text-muted-foreground">Hot Technologies</p>
              </div>
            </div>
          </CardContent>
        </Card>
        {stats?.by_category && Object.entries(stats.by_category).slice(0, 2).map(([cat, count]) => (
          <Card key={cat}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{count.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground capitalize">{cat.replace("_", " ")}</p>
                </div>
                <Badge className={categoryColors[cat] || ""}>{cat}</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top Skills */}
      {stats?.top_skills && stats.top_skills.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Top Skills by Job Count
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.top_skills.map((s) => (
                <Badge key={s.name} variant="secondary" className="text-xs">
                  {s.name} ({s.job_count})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-4">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {categoryTabs.map((tab) => {
            const count = tab.value === "all"
              ? stats?.total
              : stats?.by_category?.[tab.value];
            return (
              <button
                key={tab.value}
                onClick={() => { setCategory(tab.value); setPage(1); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  category === tab.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {count !== undefined && (
                  <span className="ml-1 text-[10px] opacity-70">({count.toLocaleString()})</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
            data-testid="taxonomy-search"
          />
        </div>
      </div>

      {/* Skills Table */}
      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={[
              {
                header: () => (
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("name")}>
                    Name <SortIcon col="name" />
                  </button>
                ),
                accessor: (r: TaxonomySkill) => (
                  <div className="flex items-center gap-2">
                    {editingId === r.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-7 text-sm w-[200px]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(e as any);
                            if (e.key === "Escape") cancelEdit(e as any);
                          }}
                        />
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={saveEdit}>
                          <Check className="h-3 w-3 text-green-600" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={cancelEdit}>
                          <X className="h-3 w-3 text-red-600" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium">{r.name}</span>
                        {r.is_hot_technology && <span title="Hot Technology"><Flame className="h-3 w-3 text-orange-500" /></span>}
                        {r.is_in_demand && <span title="In Demand"><TrendingUp className="h-3 w-3 text-green-500" /></span>}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-40 hover:opacity-100"
                          onClick={(e) => startEdit(r, e)}
                          title="Edit name"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                ),
              },
              {
                header: () => (
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("category")}>
                    Category <SortIcon col="category" />
                  </button>
                ),
                accessor: (r: TaxonomySkill) => (
                  <Badge className={`text-xs ${categoryColors[r.category] || ""}`}>
                    {r.category.replace("_", " ")}
                  </Badge>
                ),
              },
              {
                header: () => (
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("job_count")}>
                    Jobs <SortIcon col="job_count" />
                  </button>
                ),
                accessor: (r: TaxonomySkill) => (
                  <Badge variant="outline" className="text-[11px]">
                    {r.job_count || 0}
                  </Badge>
                ),
              },
              {
                header: () => (
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("subcategory")}>
                    Subcategory <SortIcon col="subcategory" />
                  </button>
                ),
                accessor: (r: TaxonomySkill) => r.subcategory || "—",
                className: "text-muted-foreground text-sm",
              },
              {
                header: () => (
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("source")}>
                    Source <SortIcon col="source" />
                  </button>
                ),
                accessor: (r: TaxonomySkill) => r.source.toUpperCase(),
                className: "text-xs font-mono",
              },
            ]}
            data={data?.data ?? []}
            isLoading={isLoading}
            onRowClick={(row) => setSelectedSkill(row)}
            emptyMessage="No taxonomy skills found. Run the data loader to populate."
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-4">
              <span>Page {page} of {totalPages} ({data?.total.toLocaleString()} results)</span>
              <div className="flex gap-2">
                <button className="px-3 py-1 rounded border disabled:opacity-50" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="px-3 py-1 rounded border disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Skill Detail Panel */}
      <Sheet open={!!selectedSkill} onOpenChange={(open) => !open && setSelectedSkill(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedSkill?.name}</SheetTitle>
          </SheetHeader>
          {selectedSkill && (
            <div className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Skill Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Category</span>
                    <Badge className={categoryColors[selectedSkill.category] || ""}>{selectedSkill.category}</Badge>
                  </div>
                  {selectedSkill.subcategory && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subcategory</span>
                      <span>{selectedSkill.subcategory}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <span className="font-mono text-xs">{selectedSkill.source.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Jobs</span>
                    <span className="font-bold">{selectedSkill.job_count || 0}</span>
                  </div>
                  {selectedSkill.description && (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground">{selectedSkill.description}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Linked Jobs */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                    <Briefcase className="h-3 w-3" /> Linked Jobs ({linkedData?.jobs?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!linkedData?.jobs?.length ? (
                    <p className="text-xs text-muted-foreground">No linked jobs found</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {linkedData.jobs.map((j) => (
                        <div key={j.id} className="flex justify-between text-xs py-1 border-b last:border-0">
                          <span className="font-medium truncate max-w-[200px]">{j.title}</span>
                          <span className="text-muted-foreground">{j.company_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Linked Courses */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                    <GraduationCap className="h-3 w-3" /> Linked Courses ({linkedData?.courses?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!linkedData?.courses?.length ? (
                    <p className="text-xs text-muted-foreground">No linked courses found</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {linkedData.courses.map((c) => (
                        <div key={c.id} className="flex justify-between text-xs py-1 border-b last:border-0">
                          <span className="font-medium truncate max-w-[200px]">{c.title}</span>
                          <span className="text-muted-foreground font-mono">{c.course_code}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Linked Reports */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Linked Reports ({linkedData?.reports?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!linkedData?.reports?.length ? (
                    <p className="text-xs text-muted-foreground">No linked reports found</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {linkedData.reports.map((r) => (
                        <div key={r.id} className="flex justify-between text-xs py-1 border-b last:border-0">
                          <span className="font-medium truncate max-w-[200px]">{r.title}</span>
                          <span className="text-muted-foreground">{r.report_type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
