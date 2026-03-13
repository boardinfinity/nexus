import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { Flame, TrendingUp, Search } from "lucide-react";

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
  created_at: string;
}

interface TaxonomyStats {
  total: number;
  by_category: Record<string, number>;
  hot_technologies: number;
  top_skills: Array<{ name: string; job_count: number }>;
}

const categoryColors: Record<string, string> = {
  skill: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  knowledge: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ability: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  technology: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  soft_skill: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
};

export default function Taxonomy() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);

  const { data: stats } = useQuery<TaxonomyStats>({
    queryKey: ["/api/taxonomy/stats"],
    queryFn: async () => {
      const res = await authFetch("/api/taxonomy/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const { data, isLoading } = useQuery<{ data: TaxonomySkill[]; total: number }>({
    queryKey: ["/api/taxonomy", page, category, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (category && category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      const res = await authFetch(`/api/taxonomy?${params}`);
      if (!res.ok) throw new Error("Failed to fetch taxonomy");
      return res.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

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
            <div className="text-2xl font-bold">{stats?.total?.toLocaleString() || "—"}</div>
            <p className="text-xs text-muted-foreground">Total Skills</p>
          </CardContent>
        </Card>
        {stats?.by_category && Object.entries(stats.by_category).map(([cat, count]) => (
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
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              <div>
                <div className="text-2xl font-bold">{stats?.hot_technologies || "—"}</div>
                <p className="text-xs text-muted-foreground">Hot Technologies</p>
              </div>
            </div>
          </CardContent>
        </Card>
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

      {/* Search & Filter */}
      <div className="flex gap-3">
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
        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]" data-testid="taxonomy-category-filter">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="skill">Skills</SelectItem>
            <SelectItem value="knowledge">Knowledge</SelectItem>
            <SelectItem value="ability">Abilities</SelectItem>
            <SelectItem value="technology">Technology</SelectItem>
            <SelectItem value="soft_skill">Soft Skills</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Skills Table */}
      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={[
              {
                header: "Name",
                accessor: (r: TaxonomySkill) => (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {r.is_hot_technology && <Flame className="h-3 w-3 text-orange-500" title="Hot Technology" />}
                    {r.is_in_demand && <TrendingUp className="h-3 w-3 text-green-500" title="In Demand" />}
                  </div>
                ),
              },
              {
                header: "Category",
                accessor: (r: TaxonomySkill) => (
                  <Badge className={`text-xs ${categoryColors[r.category] || ""}`}>
                    {r.category.replace("_", " ")}
                  </Badge>
                ),
              },
              { header: "Subcategory", accessor: (r: TaxonomySkill) => r.subcategory || "—", className: "text-muted-foreground text-sm" },
              { header: "Source", accessor: (r: TaxonomySkill) => r.source.toUpperCase(), className: "text-xs font-mono" },
              {
                header: "Description",
                accessor: (r: TaxonomySkill) => r.description ? (
                  <span className="text-xs text-muted-foreground line-clamp-2" title={r.description}>{r.description}</span>
                ) : "—",
              },
            ]}
            data={data?.data ?? []}
            isLoading={isLoading}
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
    </div>
  );
}
