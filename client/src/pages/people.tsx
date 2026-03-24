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
import { authFetch } from "@/lib/queryClient";

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function monthToNum(m: any): number {
  if (!m) return 0;
  if (typeof m === "number") return m;
  return MONTHS[String(m).slice(0, 3)] || 0;
}

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
      const res = await authFetch(`/api/people?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch people");
      return res.json();
    },
  });

  const { data: detail } = useQuery<Person>({
    queryKey: ["/api/people", selected?.id],
    queryFn: async () => {
      const res = await authFetch(`/api/people/${selected!.id}`);
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
                <div className="flex items-center gap-2">
                  {r.profile_picture_url && (
                    <img src={r.profile_picture_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                  )}
                  <span className="font-medium">{r.full_name}</span>
                </div>
                {r.headline && <div className="text-[11px] text-muted-foreground truncate max-w-[250px]">{r.headline}</div>}
                <div className="flex gap-1 mt-0.5">
                  {r.is_recruiter && <Badge variant="outline" className="text-[10px] py-0">Recruiter</Badge>}
                  {r.is_hiring_manager && <Badge variant="outline" className="text-[10px] py-0">HM</Badge>}
                </div>
              </div>
            ),
          },
          { header: "Title", accessor: "current_title" as keyof Person, className: "max-w-[200px] truncate" },
          { header: "Company", accessor: (r: Person) => {
            const company = (r as any).company;
            return company?.name || r.current_company_id || "—";
          }},
          { header: "Location", accessor: (r: Person) => r.location_city ? `${r.location_city}, ${r.location_country}` : r.location_country || "—" },
          { header: "Score", accessor: (r: Person) => (
            <div className="flex items-center gap-1">
              <span className={`text-xs font-medium ${r.enrichment_score >= 70 ? "text-green-600" : r.enrichment_score >= 40 ? "text-yellow-600" : "text-red-500"}`}>
                {r.enrichment_score}
              </span>
            </div>
          )},
          { header: "Transitions", accessor: (r: Person) => {
            const transitions = r.career_transitions as any[] | undefined;
            return transitions?.length ? <span className="text-xs">{transitions.length}</span> : <span className="text-xs text-muted-foreground">—</span>;
          }},
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
          {(detail || selected) && (() => {
            const p = detail || selected!;
            const transitions = (p.career_transitions || []) as any[];
            const certs = (p.certifications || []) as any[];
            const langs = p.languages_spoken || [];
            return (
            <div className="space-y-4 mt-4">
              {p.profile_picture_url && (
                <img src={p.profile_picture_url} alt="" className="w-16 h-16 rounded-full object-cover" />
              )}
              {p.headline && <p className="text-sm text-muted-foreground">{p.headline}</p>}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs text-muted-foreground uppercase">Profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {[
                    ["Title", p.current_title],
                    ["Company", (p as any).company?.name || p.current_company_id],
                    ["Location", [p.location_city, p.location_country].filter(Boolean).join(", ")],
                    ["Email", p.email],
                    ["Phone", p.phone],
                    ["Seniority", p.seniority],
                    ["Function", p.function],
                    ["Enrichment Score", p.enrichment_score != null ? `${p.enrichment_score}/100` : null],
                    ["Connections", p.connections_count],
                    ["Last Enriched", p.last_enriched_at ? new Date(p.last_enriched_at).toLocaleDateString() : null],
                  ].map(([label, val]) => val ? (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="text-right">{String(val)}</span>
                    </div>
                  ) : null)}
                  <div className="flex gap-2 pt-1">
                    {p.is_recruiter && <Badge>Recruiter</Badge>}
                    {p.is_hiring_manager && <Badge>Hiring Manager</Badge>}
                  </div>
                </CardContent>
              </Card>
              {(() => {
                const experience = (p.experience || []) as any[];
                const education = (p.education || []) as any[];
                type TimelineEntry = { type: "experience" | "education"; title: string; subtitle: string; extra?: string; dateRange: string; initial: string; sortKey: number };
                const entries: TimelineEntry[] = [];
                for (const e of experience) {
                  if (!e.position) continue;
                  const startYear = e.startDate?.year;
                  const start = e.startDate?.text || (startYear ? `${startYear}` : "");
                  const end = e.endDate?.text || "Present";
                  const parts = [start, end].filter(Boolean).join(" - ");
                  const extras = [e.duration, e.location].filter(Boolean).join(" · ");
                  entries.push({
                    type: "experience",
                    title: e.position,
                    subtitle: e.companyName || "",
                    extra: extras || undefined,
                    dateRange: parts,
                    initial: (e.companyName || e.position || "W").charAt(0).toUpperCase(),
                    sortKey: ((startYear || 0) * 100) + monthToNum(e.startDate?.month),
                  });
                }
                for (const e of education) {
                  if (!e.degree && !e.schoolName) continue;
                  const startYear = e.startDate?.year;
                  const start = e.startDate?.text || (startYear ? `${startYear}` : "");
                  const end = e.endDate?.text || e.endDate?.year?.toString() || "";
                  const parts = [start, end].filter(Boolean).join(" - ");
                  entries.push({
                    type: "education",
                    title: e.degree || e.fieldOfStudy || "Education",
                    subtitle: e.schoolName || "",
                    extra: e.fieldOfStudy && e.degree ? e.fieldOfStudy : undefined,
                    dateRange: e.period || parts,
                    initial: (e.schoolName || e.degree || "E").charAt(0).toUpperCase(),
                    sortKey: ((startYear || 0) * 100) + monthToNum(e.startDate?.month),
                  });
                }
                entries.sort((a, b) => b.sortKey - a.sortKey);
                if (entries.length === 0) return null;
                return (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-muted-foreground uppercase">Career Journey</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm">
                      <div className="relative ml-4">
                        <div className="absolute left-0 top-0 bottom-0 w-px bg-border" />
                        {entries.map((entry, i) => (
                          <div key={i} className="relative pl-6 pb-5 last:pb-0">
                            <div className={`absolute left-[-3px] top-1 w-1.5 h-1.5 rounded-full ${entry.type === "education" ? "bg-blue-500" : "bg-green-500"}`} />
                            <div className="flex gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${entry.type === "education" ? "bg-blue-500" : "bg-green-500"}`}>
                                {entry.initial}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-xs leading-tight">{entry.title}</div>
                                {entry.subtitle && <div className="text-xs text-muted-foreground">{entry.subtitle}</div>}
                                {entry.extra && <div className="text-xs text-muted-foreground">{entry.extra}</div>}
                                <div className="text-[11px] text-muted-foreground mt-0.5">{entry.dateRange}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
              {transitions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase">Career Transitions ({transitions.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    {transitions.map((t: any, i: number) => (
                      <div key={i} className="border-l-2 border-muted pl-2">
                        <div className="font-medium">{t.from_title} → {t.to_title}</div>
                        <div className="text-muted-foreground">{t.from_company}{t.from_company !== t.to_company ? ` → ${t.to_company}` : ""}</div>
                        <Badge variant="outline" className="text-[10px] mt-0.5">{t.type?.replace("_", " ")}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {(p.skills?.length > 0 || certs.length > 0 || langs.length > 0) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase">Skills & Qualifications</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {p.skills?.length > 0 && (
                      <div>
                        <span className="text-xs text-muted-foreground">Skills:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {p.skills.slice(0, 15).map((s: string) => (
                            <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                          ))}
                          {p.skills.length > 15 && <span className="text-[10px] text-muted-foreground">+{p.skills.length - 15} more</span>}
                        </div>
                      </div>
                    )}
                    {certs.length > 0 && (
                      <div>
                        <span className="text-xs text-muted-foreground">Certifications:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {certs.map((c: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px]">{typeof c === "string" ? c : c.name || c.title || "Cert"}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {langs.length > 0 && (
                      <div>
                        <span className="text-xs text-muted-foreground">Languages:</span>
                        <span className="text-xs ml-1">{langs.join(", ")}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              {p.linkedin_url && (
                <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="text-primary text-sm hover:underline block">
                  View LinkedIn Profile
                </a>
              )}
            </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
