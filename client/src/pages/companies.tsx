import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { DataTable } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Search, Sparkles, Loader2, Save, Merge } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Company } from "@shared/schema";

export default function Companies() {
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Company | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "50");
  if (search) params.set("search", search);
  if (industry !== "all") params.set("industry", industry);

  const { data, isLoading } = useQuery<{ data: Company[]; total: number }>({
    queryKey: ["/api/companies", params.toString()],
    queryFn: async () => {
      const res = await authFetch(`/api/companies?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch companies");
      return res.json();
    },
  });

  const { data: detail } = useQuery<Company>({
    queryKey: ["/api/companies", selected?.id],
    queryFn: async () => {
      const res = await authFetch(`/api/companies/${selected!.id}`);
      if (!res.ok) throw new Error("Failed to fetch company");
      return res.json();
    },
    enabled: !!selected?.id,
  });

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/companies/auto-enrich", {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Auto-enrichment complete", description: `Enriched ${data.enriched} of ${data.total} companies from job data.` });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Enrichment failed", description: err.message, variant: "destructive" });
    },
  });

  const dedupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/companies/deduplicate", {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Deduplication complete", description: `Merged ${data.merged} duplicate companies across ${data.groups_found} groups.` });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
    onError: (err: Error) => {
      toast({ title: "Deduplication failed", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/companies/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Company updated", description: "Company details have been saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setEditing(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  function openDetail(company: Company) {
    setSelected(company);
    setEditing(false);
  }

  function startEditing() {
    if (detail) {
      setEditForm({
        industry: detail.industry || "",
        sub_industry: detail.sub_industry || "",
        company_type: detail.company_type || "",
        size_range: detail.size_range || "",
        employee_count: detail.employee_count || "",
        headquarters_city: detail.headquarters_city || "",
        headquarters_state: detail.headquarters_state || "",
        headquarters_country: detail.headquarters_country || "",
        website: detail.website || "",
        linkedin_url: detail.linkedin_url || "",
        description: detail.description || "",
        founded_year: detail.founded_year || "",
      });
      setEditing(true);
    }
  }

  function saveEdits() {
    if (selected?.id) {
      // Convert empty strings to null, numbers appropriately
      const updates: Record<string, any> = {};
      for (const [key, value] of Object.entries(editForm)) {
        if (key === "employee_count" || key === "founded_year") {
          updates[key] = value ? parseInt(value) || null : null;
        } else {
          updates[key] = value || null;
        }
      }
      saveMutation.mutate({ id: selected.id, updates });
    }
  }

  const totalPages = data ? Math.ceil(data.total / 50) : 1;

  return (
    <div className="space-y-4" data-testid="companies-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">Browse and manage company profiles</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => dedupMutation.mutate()}
            disabled={dedupMutation.isPending}
          >
            {dedupMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Merge className="h-3.5 w-3.5" />
            )}
            Deduplicate
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
          >
            {enrichMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Auto Enrich
          </Button>
        </div>
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
        onRowClick={(row) => openDetail(row)}
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

      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setEditing(false); } }}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle>{detail?.name || selected?.name}</SheetTitle>
              {!editing && (
                <Button variant="outline" size="sm" onClick={startEditing} className="gap-1">
                  <Save className="h-3 w-3" /> Edit
                </Button>
              )}
            </div>
          </SheetHeader>
          {(detail || selected) && !editing && (
            <div className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Company Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[
                    ["Industry", detail?.industry],
                    ["Sub-Industry", detail?.sub_industry],
                    ["Type", detail?.company_type],
                    ["Employees", detail?.employee_count?.toLocaleString()],
                    ["Size Range", detail?.size_range],
                    ["Founded", detail?.founded_year],
                    ["HQ", [detail?.headquarters_city, detail?.headquarters_state, detail?.headquarters_country].filter(Boolean).join(", ")],
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
          {editing && (
            <div className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Edit Company</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Industry</Label>
                      <Input className="h-8 text-sm" value={editForm.industry} onChange={(e) => setEditForm(f => ({ ...f, industry: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Sub-Industry</Label>
                      <Input className="h-8 text-sm" value={editForm.sub_industry} onChange={(e) => setEditForm(f => ({ ...f, sub_industry: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Company Type</Label>
                      <Input className="h-8 text-sm" value={editForm.company_type} placeholder="e.g. private, public" onChange={(e) => setEditForm(f => ({ ...f, company_type: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Employee Count</Label>
                      <Input className="h-8 text-sm" type="number" value={editForm.employee_count} onChange={(e) => setEditForm(f => ({ ...f, employee_count: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Founded Year</Label>
                      <Input className="h-8 text-sm" type="number" value={editForm.founded_year} onChange={(e) => setEditForm(f => ({ ...f, founded_year: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Size Range</Label>
                      <Input className="h-8 text-sm" value={editForm.size_range} placeholder="e.g. 51-200" onChange={(e) => setEditForm(f => ({ ...f, size_range: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">City</Label>
                      <Input className="h-8 text-sm" value={editForm.headquarters_city} onChange={(e) => setEditForm(f => ({ ...f, headquarters_city: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">State</Label>
                      <Input className="h-8 text-sm" value={editForm.headquarters_state} onChange={(e) => setEditForm(f => ({ ...f, headquarters_state: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Country</Label>
                      <Input className="h-8 text-sm" value={editForm.headquarters_country} onChange={(e) => setEditForm(f => ({ ...f, headquarters_country: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Website</Label>
                    <Input className="h-8 text-sm" value={editForm.website} onChange={(e) => setEditForm(f => ({ ...f, website: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">LinkedIn URL</Label>
                    <Input className="h-8 text-sm" value={editForm.linkedin_url} onChange={(e) => setEditForm(f => ({ ...f, linkedin_url: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Textarea className="text-sm min-h-[80px]" value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <Button className="flex-1 h-8 text-xs" onClick={saveEdits} disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                      Save Changes
                    </Button>
                    <Button variant="outline" className="h-8 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
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
