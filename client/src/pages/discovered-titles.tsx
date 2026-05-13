import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/data-table";
import {
  Sparkles, Search, CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronRight,
} from "lucide-react";

interface DiscoveredTitle {
  id: string;
  title: string;
  normalized_title: string;
  country: string | null;
  source: string | null;
  run_id: string | null;
  observed_count: number;
  status: string;
  promoted_role_id: string | null;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

const FAMILIES = ["Technology", "Management", "Core Engineering", "Others"];

export default function DiscoveredTitles() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [country, setCountry] = useState("all");
  const [page, setPage] = useState(1);

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<DiscoveredTitle | null>(null);
  const [roleName, setRoleName] = useState("");
  const [family, setFamily] = useState("Others");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setPage(1);
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery<{ items: DiscoveredTitle[]; total: number; page: number; limit: number }>({
    queryKey: ["/api/discovered-titles", status, country, debouncedSearch, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status", status);
      if (country && country !== "all") params.set("country", country);
      if (debouncedSearch) params.set("search", debouncedSearch);
      params.set("page", String(page));
      params.set("limit", "50");
      const res = await authFetch(`/api/discovered-titles?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load discovered titles");
      return res.json();
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async (payload: { id: string; role_name: string; family: string }) => {
      const res = await apiRequest("POST", `/api/discovered-titles/${payload.id}/promote`, {
        role_name: payload.role_name,
        family: payload.family,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Promote failed");
      }
      return res.json();
    },
    onSuccess: (r) => {
      toast({ title: "Promoted", description: `Created role "${r.role_name}".` });
      setPromoteOpen(false);
      setPromoteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/discovered-titles"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const ignoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/discovered-titles/${id}/ignore`, {});
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Ignore failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ignored" });
      queryClient.invalidateQueries({ queryKey: ["/api/discovered-titles"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const openPromote = (row: DiscoveredTitle) => {
    setPromoteTarget(row);
    setRoleName(row.title);
    setFamily("Others");
    setPromoteOpen(true);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Discovered Titles
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Job titles found during discovery sweeps that did not map to any known role. Promote useful ones to create new roles, or ignore noise.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">Search title</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="e.g. devops engineer"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>
            <div className="w-[160px]">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="promoted">Promoted</SelectItem>
                  <SelectItem value="ignored">Ignored</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[160px]">
              <Label className="text-xs">Country</Label>
              <Select value={country} onValueChange={(v) => { setCountry(v); setPage(1); }}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="India">India</SelectItem>
                  <SelectItem value="UAE">UAE</SelectItem>
                  <SelectItem value="Saudi Arabia">Saudi Arabia</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground pb-2">
              {data?.total ?? 0} titles
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto">
        <DataTable
          columns={[
            {
              header: "Title",
              accessor: (r: DiscoveredTitle) => (
                <div>
                  <div className="font-medium">{r.title}</div>
                  <div className="text-[10px] text-muted-foreground">{r.normalized_title}</div>
                </div>
              ),
              className: "max-w-[280px]",
            },
            {
              header: "Country",
              accessor: (r: DiscoveredTitle) => r.country || "—",
              className: "w-[120px]",
            },
            {
              header: "Source",
              accessor: (r: DiscoveredTitle) => r.source ? <Badge variant="outline" className="text-[10px]">{r.source}</Badge> : "—",
              className: "w-[120px]",
            },
            {
              header: "Seen",
              accessor: (r: DiscoveredTitle) => <span className="font-mono">{r.observed_count}</span>,
              className: "w-[60px] text-right",
            },
            {
              header: "Status",
              accessor: (r: DiscoveredTitle) => {
                const map: Record<string, string> = {
                  pending: "bg-yellow-100 text-yellow-800",
                  promoted: "bg-green-100 text-green-800",
                  ignored: "bg-gray-100 text-gray-600",
                };
                return <Badge className={`text-[10px] ${map[r.status] || ""}`} variant="outline">{r.status}</Badge>;
              },
              className: "w-[90px]",
            },
            {
              header: "Last Seen",
              accessor: (r: DiscoveredTitle) => new Date(r.last_seen_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
              className: "w-[90px]",
            },
            {
              header: "Actions",
              accessor: (r: DiscoveredTitle) => (
                <div className="flex gap-1">
                  {r.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={(e) => { e.stopPropagation(); openPromote(r); }}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Promote
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={ignoreMutation.isPending}
                        onClick={(e) => { e.stopPropagation(); ignoreMutation.mutate(r.id); }}
                      >
                        <XCircle className="h-3 w-3 mr-1" /> Ignore
                      </Button>
                    </>
                  )}
                  {r.status !== "pending" && r.reviewed_by && (
                    <span className="text-[10px] text-muted-foreground">by {r.reviewed_by}</span>
                  )}
                </div>
              ),
              className: "w-[200px]",
            },
          ]}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No discovered titles match your filters"
        />
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>Page {page} of {totalPages}</div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote to job role</DialogTitle>
            <DialogDescription>
              Creates a new entry in <span className="font-mono">job_roles</span>. The original title will be saved as a synonym.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Original title</Label>
              <div className="text-sm mt-1 p-2 bg-muted rounded">{promoteTarget?.title}</div>
            </div>
            <div>
              <Label className="text-xs">Role name (will be used for the new job_role)</Label>
              <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Family</Label>
              <Select value={family} onValueChange={setFamily}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FAMILIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteOpen(false)} disabled={promoteMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => promoteTarget && promoteMutation.mutate({ id: promoteTarget.id, role_name: roleName, family })}
              disabled={promoteMutation.isPending || !roleName.trim()}
            >
              {promoteMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Promote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
