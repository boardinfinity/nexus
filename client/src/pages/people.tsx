import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import type { Person } from "@shared/schema";

export default function People() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Person | null>(null);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "50");
  if (search) params.set("search", search);
  if (roleFilter === "recruiter") params.set("is_recruiter", "true");
  if (roleFilter === "hiring_manager") params.set("is_hiring_manager", "true");

  const { data, isLoading } = useQuery<{ data: Person[]; total: number }>({
    queryKey: ["/api/people", params.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/people?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch people");
      return res.json();
    },
  });

  const { data: detail } = useQuery<Person>({
    queryKey: ["/api/people", selected?.id],
    queryFn: async () => {
      const res = await fetch(`/api/people/${selected!.id}`);
      if (!res.ok) throw new Error("Failed to fetch person");
      return res.json();
    },
    enabled: !!selected?.id,
  });

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="space-y-4" data-testid="people-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">People</h1>
        <p className="text-sm text-muted-foreground">Browse recruiters, hiring managers, and professionals</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search people..."
            className="pl-8 h-9 text-sm"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            data-testid="search-people"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px] h-9 text-xs" data-testid="filter-role">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="recruiter">Recruiters</SelectItem>
            <SelectItem value="hiring_manager">Hiring Managers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={[
          {
            header: "Name",
            accessor: (r: Person) => (
              <div>
                <span className="font-medium">{r.full_name}</span>
                <div className="flex gap-1 mt-0.5">
                  {r.is_recruiter && <Badge variant="outline" className="text-[10px] py-0">Recruiter</Badge>}
                  {r.is_hiring_manager && <Badge variant="outline" className="text-[10px] py-0">HM</Badge>}
                </div>
              </div>
            ),
          },
          { header: "Title", accessor: "current_title" as keyof Person, className: "max-w-[200px] truncate" },
          { header: "Company", accessor: "current_company_id" as keyof Person },
          { header: "Location", accessor: (r: Person) => r.location_city ? `${r.location_city}, ${r.location_country}` : r.location_country || "—" },
          { header: "Status", accessor: (r: Person) => <StatusBadge status={r.enrichment_status} /> },
        ]}
        data={data?.data ?? []}
        isLoading={isLoading}
        onRowClick={(row) => setSelected(row)}
        emptyMessage="No people match your filters"
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
            <SheetTitle>{detail?.full_name || selected?.full_name}</SheetTitle>
          </SheetHeader>
          {(detail || selected) && (
            <div className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[
                    ["Title", detail?.current_title],
                    ["Company", detail?.current_company_id],
                    ["Location", [detail?.location_city, detail?.location_country].filter(Boolean).join(", ")],
                    ["Email", detail?.email],
                    ["Phone", detail?.phone],
                    ["Seniority", detail?.seniority],
                    ["Function", detail?.function],
                  ].map(([label, val]) => val ? (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="text-right">{val as string}</span>
                    </div>
                  ) : null)}
                  <div className="flex gap-2 pt-1">
                    {detail?.is_recruiter && <Badge>Recruiter</Badge>}
                    {detail?.is_hiring_manager && <Badge>Hiring Manager</Badge>}
                  </div>
                </CardContent>
              </Card>
              {detail?.linkedin_url && (
                <a href={detail.linkedin_url} target="_blank" rel="noreferrer" className="text-primary text-sm hover:underline block">
                  View LinkedIn Profile
                </a>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
