import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Search } from "lucide-react";
import type { Company } from "@shared/schema";

export default function Companies() {
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Company | null>(null);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "50");
  if (search) params.set("search", search);
  if (industry !== "all") params.set("industry", industry);

  const { data, isLoading } = useQuery<{ data: Company[]; total: number }>({
    queryKey: ["/api/companies", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/companies?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch companies");
      return res.json();
    },
  });

  const { data: detail } = useQuery<Company>({
    queryKey: ["/api/companies", selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${selected!.id}`);
      if (!res.ok) throw new Error("Failed to fetch company");
      return res.json();
    },
    enabled: !!selected?.id,
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="space-y-4" data-testid="companies-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
        <p className="text-sm text-muted-foreground">Browse and manage company profiles</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search companies..."
            className="pl-8 h-9 text-sm"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            data-testid="search-companies"
          />
        </div>
        <Select value={industry} onValueChange={(v) => { setIndustry(v); setPage(1); }}>
          <SelectTrigger className="w-[160px] h-9 text-xs" data-testid="filter-industry">
            <SelectValue placeholder="Industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            <SelectItem value="Technology">Technology</SelectItem>
            <SelectItem value="Finance">Finance</SelectItem>
            <SelectItem value="Healthcare">Healthcare</SelectItem>
            <SelectItem value="Education">Education</SelectItem>
            <SelectItem value="Consulting">Consulting</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={[
          { header: "Name", accessor: "name" as keyof Company, className: "font-medium" },
          { header: "Industry", accessor: (r: Company) => r.industry || "—" },
          { header: "Size", accessor: (r: Company) => r.employee_count ? r.employee_count.toLocaleString() : "—" },
          { header: "Country", accessor: (r: Company) => r.headquarters_country || "—" },
          {
            header: "Enrichment",
            accessor: (r: Company) => (
              <div className="flex items-center gap-2 min-w-[120px]">
                <Progress value={r.enrichment_score ?? 0} className="h-2 flex-1" />
                <span className="text-xs text-muted-foreground w-8">{r.enrichment_score ?? 0}%</span>
              </div>
            ),
          },
          {
            header: "Updated",
            accessor: (r: Company) =>
              r.updated_at ? new Date(r.updated_at).toLocaleDateString() : "—",
          },
        ]}
        data={data?.data ?? []}
        isLoading={isLoading}
        onRowClick={(row) => setSelected(row)}
        emptyMessage="No companies match your filters"
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded border disabled:opacity-50" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="px-3 py-1 rounded border disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{detail?.name || selected?.name}</SheetTitle>
          </SheetHeader>
          {(detail || selected) && (
            <div className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Company Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[
                    ["Industry", detail?.industry],
                    ["Employees", detail?.employee_count?.toLocaleString()],
                    ["Founded", detail?.founded_year],
                    ["HQ", [detail?.headquarters_city, detail?.headquarters_country].filter(Boolean).join(", ")],
                    ["Website", detail?.website],
                    ["LinkedIn", detail?.linkedin_url],
                  ].map(([label, val]) => val ? (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="text-right max-w-[200px] truncate">{val as string}</span>
                    </div>
                  ) : null)}
                </CardContent>
              </Card>
              {detail?.description && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase">Description</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{detail.description}</p>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Enrichment Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Progress value={detail?.enrichment_score ?? 0} className="h-3 flex-1" />
                    <span className="text-lg font-bold">{detail?.enrichment_score ?? 0}%</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
