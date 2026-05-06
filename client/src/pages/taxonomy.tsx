import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Flame, TrendingUp, Search, Pencil, Check, X, Briefcase, GraduationCap,
  FileText, ArrowUpDown, ArrowUp, ArrowDown, Info, ChevronDown, Globe,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface TaxonomySkill {
  id: string;
  external_id: string;
  name: string;
  category: string;
  subcategory: string | null;
  l1: string | null;
  l2: string | null;
  domain_tag: string | null;
  india_relevance: string | null;
  regions: string[] | null;
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
  by_l1: Record<string, number>;
  by_l2: Record<string, Record<string, number>>;
  by_region: Record<string, number>;
  hot_technologies: number;
  top_skills: Array<{ name: string; job_count: number }>;
}

interface LinkedData {
  jobs: Array<{ id: string; title: string; company_name: string; source: string }>;
  courses: Array<{ id: string; course_code: string; title: string; college_id: string }>;
  reports: Array<{ id: string; title: string; report_type: string; created_at: string }>;
}

// ── L1 / L2 model definitions ────────────────────────────────────────────────
const L1_VALUES = ["TECHNICAL SKILLS", "KNOWLEDGE", "COMPETENCIES", "CREDENTIAL"] as const;
type L1 = typeof L1_VALUES[number];

const L1_TO_L2: Record<L1, string[]> = {
  "TECHNICAL SKILLS": ["Methodology", "Technology", "Tool"],
  "KNOWLEDGE": ["Domain", "Knowledge"],
  "COMPETENCIES": ["Ability", "Competency", "Skill"],
  "CREDENTIAL": ["Certification", "Language"],
};

const L1_LABELS: Record<L1, string> = {
  "TECHNICAL SKILLS": "Technical",
  "KNOWLEDGE": "Knowledge",
  "COMPETENCIES": "Competencies",
  "CREDENTIAL": "Credential",
};

const L1_COLORS: Record<L1, string> = {
  "TECHNICAL SKILLS": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-700",
  "KNOWLEDGE": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-purple-300 dark:border-purple-700",
  "COMPETENCIES": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-green-300 dark:border-green-700",
  "CREDENTIAL": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700",
};

// Legacy O*NET color fallback (used until backfill completes)
const LEGACY_CATEGORY_COLORS: Record<string, string> = {
  skill: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  knowledge: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ability: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  technology: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

const REGION_OPTIONS = ["India", "Global", "UAE/GCC", "SEA", "US", "EU"] as const;

const SOURCE_FILTER_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "v2", label: "v2 Modern (1,419)" },
  { value: "legacy", label: "Legacy O*NET (8,888)" },
];

export default function Taxonomy() {
  const [search, setSearch] = useState("");
  const [l1Filter, setL1Filter] = useState<L1 | "all">("all");
  const [l2Filter, setL2Filter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedSkill, setSelectedSkill] = useState<TaxonomySkill | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [sortCol, setSortCol] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // L2 options depend on L1 selection
  const l2Options = useMemo(() => {
    if (l1Filter === "all") return [];
    return L1_TO_L2[l1Filter];
  }, [l1Filter]);

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

  function toggleRegion(region: string) {
    setRegionFilter(prev =>
      prev.includes(region) ? prev.filter(r => r !== region) : [...prev, region]
    );
    setPage(1);
  }

  function clearFilters() {
    setL1Filter("all");
    setL2Filter("all");
    setRegionFilter([]);
    setSourceFilter("all");
    setSearch("");
    setPage(1);
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
    queryKey: ["/api/taxonomy", page, l1Filter, l2Filter, regionFilter, sourceFilter, search, sortCol, sortOrder],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50", sort: sortCol, order: sortOrder });
      if (l1Filter !== "all") params.set("l1", l1Filter);
      if (l2Filter !== "all" && l1Filter !== "all") params.set("l2", l2Filter);
      if (regionFilter.length > 0) params.set("regions", regionFilter.join(","));
      if (sourceFilter !== "all") params.set("source_filter", sourceFilter);
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

  const filtersActive =
    l1Filter !== "all" || l2Filter !== "all" || regionFilter.length > 0 ||
    sourceFilter !== "all" || search !== "";

  return (
    <div className="space-y-6" data-testid="taxonomy-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Skill Taxonomy</h1>
        <p className="text-sm text-muted-foreground">
          Browse and search the unified skill taxonomy — 4-category model (L1 / L2) with multi-region tagging.
        </p>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
          <span>How this works</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
            <p><strong>4-category model:</strong></p>
            <p>• <strong>L1</strong> (parent): TECHNICAL SKILLS · KNOWLEDGE · COMPETENCIES · CREDENTIAL</p>
            <p>• <strong>L2</strong> (sub-type): Methodology / Technology / Tool · Domain / Knowledge · Ability / Competency / Skill · Certification / Language</p>
            <p>• <strong>Regions</strong>: India, Global, UAE/GCC, SEA, US, EU (multi-select)</p>
            <p className="pt-1"><strong>Sources:</strong></p>
            <p>• <strong>Legacy O*NET</strong> — 8,888 skills imported from O*NET, mapped via deterministic rules</p>
            <p>• <strong>v2 Modern</strong> — 1,419 contemporary skills (AI/ML, Modern SWE, Business/Ops, EdTech) classified into the 4-category model</p>
            <p>• Auto-created from JD Analyzer — new skills appear with status "unverified" until 10+ mentions across 3+ companies</p>
            <p className="pt-1"><strong>Tips:</strong></p>
            <p>• Pick an L1 to unlock the matching L2 dropdown</p>
            <p>• Region filter is OR (skill has ANY of the picked regions)</p>
            <p>• Click any row to see linked jobs, courses, and reports</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Stats Cards: 4 cards, one per L1 */}
      <div className="grid gap-4 md:grid-cols-4">
        {L1_VALUES.map((l1) => {
          const count = stats?.by_l1?.[l1] ?? 0;
          const isActive = l1Filter === l1;
          return (
            <Card
              key={l1}
              className={`cursor-pointer transition-colors ${isActive ? "ring-2 ring-primary" : "hover:bg-muted/50"}`}
              onClick={() => {
                setL1Filter(isActive ? "all" : l1);
                setL2Filter("all");
                setPage(1);
              }}
            >
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold">{count.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">{L1_LABELS[l1]}</p>
                  </div>
                  <Badge className={`text-[10px] border ${L1_COLORS[l1]}`}>{l1}</Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        {/* Row 1: L1 chips + L2 select */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => { setL1Filter("all"); setL2Filter("all"); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                l1Filter === "all"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All L1
              {stats?.total != null && (
                <span className="ml-1 text-[10px] opacity-70">({stats.total.toLocaleString()})</span>
              )}
            </button>
            {L1_VALUES.map((l1) => {
              const count = stats?.by_l1?.[l1];
              return (
                <button
                  key={l1}
                  onClick={() => { setL1Filter(l1); setL2Filter("all"); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    l1Filter === l1
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {L1_LABELS[l1]}
                  {count !== undefined && (
                    <span className="ml-1 text-[10px] opacity-70">({count.toLocaleString()})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* L2 dropdown — only enabled when L1 is set */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">L2:</span>
            <Select
              value={l2Filter}
              onValueChange={(v) => { setL2Filter(v); setPage(1); }}
              disabled={l1Filter === "all"}
            >
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="All L2" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All L2</SelectItem>
                {l2Options.map((l2) => {
                  const count = l1Filter !== "all" ? stats?.by_l2?.[l1Filter]?.[l2] : undefined;
                  return (
                    <SelectItem key={l2} value={l2}>
                      {l2}{count !== undefined && ` (${count.toLocaleString()})`}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Source filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Source:</span>
            <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filtersActive && (
            <Button variant="ghost" size="sm" className="h-8 text-xs ml-auto" onClick={clearFilters}>
              <X className="h-3 w-3 mr-1" /> Clear filters
            </Button>
          )}
        </div>

        {/* Row 2: Region multi-select + search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Regions:</span>
            <div className="flex flex-wrap gap-1">
              {REGION_OPTIONS.map((region) => {
                const isActive = regionFilter.includes(region);
                const count = stats?.by_region?.[region];
                return (
                  <button
                    key={region}
                    onClick={() => toggleRegion(region)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground hover:text-foreground border-border"
                    }`}
                  >
                    {region}
                    {count !== undefined && (
                      <span className="ml-1 opacity-70">({count.toLocaleString()})</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search skills by name..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 h-8 text-sm"
              data-testid="taxonomy-search"
            />
          </div>
        </div>
      </div>

      {/* Top Skills (unchanged) */}
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
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("l1")}>
                    L1 / L2 <SortIcon col="l1" />
                  </button>
                ),
                accessor: (r: TaxonomySkill) => {
                  if (r.l1 && L1_VALUES.includes(r.l1 as L1)) {
                    return (
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge className={`text-[10px] border ${L1_COLORS[r.l1 as L1]}`}>
                          {L1_LABELS[r.l1 as L1]}
                        </Badge>
                        {r.l2 && (
                          <Badge variant="outline" className="text-[10px]">
                            {r.l2}
                          </Badge>
                        )}
                      </div>
                    );
                  }
                  // Fallback: legacy category if l1 not yet backfilled
                  return (
                    <Badge className={`text-[10px] ${LEGACY_CATEGORY_COLORS[r.category] || ""}`}>
                      {r.category} (legacy)
                    </Badge>
                  );
                },
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
                header: () => <span>Regions</span>,
                accessor: (r: TaxonomySkill) => {
                  const regions = r.regions || [];
                  if (regions.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
                  return (
                    <div className="flex flex-wrap gap-1">
                      {regions.slice(0, 3).map((region) => (
                        <Badge key={region} variant="secondary" className="text-[10px]">{region}</Badge>
                      ))}
                      {regions.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{regions.length - 3}</span>
                      )}
                    </div>
                  );
                },
              },
              {
                header: () => (
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("source")}>
                    Source <SortIcon col="source" />
                  </button>
                ),
                accessor: (r: TaxonomySkill) => {
                  const isV2 = r.source === "nexus_taxonomy_v2_2026_05";
                  return (
                    <Badge variant={isV2 ? "default" : "outline"} className="text-[10px] font-mono">
                      {isV2 ? "v2" : (r.source || "—").toUpperCase().slice(0, 12)}
                    </Badge>
                  );
                },
              },
            ]}
            data={data?.data ?? []}
            isLoading={isLoading}
            onRowClick={(row) => setSelectedSkill(row)}
            emptyMessage="No taxonomy skills match these filters."
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
                  {selectedSkill.l1 && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">L1</span>
                      <Badge className={`text-[10px] border ${L1_COLORS[selectedSkill.l1 as L1] || ""}`}>
                        {selectedSkill.l1}
                      </Badge>
                    </div>
                  )}
                  {selectedSkill.l2 && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">L2</span>
                      <Badge variant="outline" className="text-[10px]">{selectedSkill.l2}</Badge>
                    </div>
                  )}
                  {!selectedSkill.l1 && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Legacy category</span>
                      <Badge className={`text-[10px] ${LEGACY_CATEGORY_COLORS[selectedSkill.category] || ""}`}>
                        {selectedSkill.category}
                      </Badge>
                    </div>
                  )}
                  {selectedSkill.domain_tag && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Domain</span>
                      <span className="text-xs">{selectedSkill.domain_tag}</span>
                    </div>
                  )}
                  {selectedSkill.regions && selectedSkill.regions.length > 0 && (
                    <div className="flex justify-between items-start">
                      <span className="text-muted-foreground">Regions</span>
                      <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                        {selectedSkill.regions.map((r) => (
                          <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                        ))}
                      </div>
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
                  {selectedSkill.aliases && selectedSkill.aliases.length > 0 && (
                    <div className="flex justify-between items-start">
                      <span className="text-muted-foreground">Aliases</span>
                      <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                        {selectedSkill.aliases.map((a) => (
                          <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedSkill.description && (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground">{selectedSkill.description}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

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
