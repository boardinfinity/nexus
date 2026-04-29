import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  Star,
} from "lucide-react";
import {
  getRespondent,
  listRespondents,
  type RespondentDetail,
  type RespondentRow,
} from "@/lib/admin-survey-api";
import type { SurveySchema } from "@/lib/survey-api";

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "invited", label: "Invited" },
  { value: "registered", label: "Registered" },
  { value: "started", label: "Started" },
  { value: "completed", label: "Completed" },
];

const STATUS_TONE: Record<string, string> = {
  invited: "bg-amber-100 text-amber-800 border-amber-200",
  registered: "bg-sky-100 text-sky-800 border-sky-200",
  started: "bg-violet-100 text-violet-800 border-violet-200",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const PAGE_SIZE = 25;

export function RespondentsTab({
  surveyId,
  schema,
}: {
  surveyId: string;
  schema: SurveySchema;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RespondentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);

  const [openRespondentId, setOpenRespondentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RespondentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = await listRespondents(surveyId, {
        page,
        limit: PAGE_SIZE,
        status,
        search,
      });
      setRows(r.respondents);
      setTotal(r.total);
    } catch (err: any) {
      toast({
        title: "Failed to load respondents",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId, page, status, search]);

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) {
        setPage(1);
        setSearch(searchInput);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  async function openDetail(id: string) {
    setOpenRespondentId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await getRespondent(surveyId, id);
      setDetail(d);
    } catch (err: any) {
      toast({
        title: "Failed to load respondent",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Respondents</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {total} total · page {page} of {totalPages}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search email or name"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-7 h-8 text-xs w-56"
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
          >
            <SelectTrigger className="h-8 text-xs w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-12">
            No respondents yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-24 text-center">Sections</TableHead>
                  <TableHead className="w-20 text-center">Skills</TableHead>
                  <TableHead className="w-28">Last login</TableHead>
                  <TableHead className="w-16 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openDetail(r.id)}
                  >
                    <TableCell className="font-mono text-xs">{r.email}</TableCell>
                    <TableCell className="text-sm">{r.full_name || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {r.company_name || "—"}
                      {r.designation && (
                        <div className="text-[10px] text-muted-foreground">{r.designation}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{r.industry || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_TONE[r.status] || ""}`}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      {r.sections_completed?.length || 0}/{schema.sections?.length || 0}
                    </TableCell>
                    <TableCell className="text-xs text-center">{r.skills_rated || 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_login_at
                        ? new Date(r.last_login_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Eye className="h-3.5 w-3.5 inline-block text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </CardContent>

      <Sheet
        open={!!openRespondentId}
        onOpenChange={(o) => {
          if (!o) {
            setOpenRespondentId(null);
            setDetail(null);
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{detail?.respondent?.full_name || detail?.respondent?.email || "Respondent"}</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {detail?.respondent?.email}
            </SheetDescription>
          </SheetHeader>

          {detailLoading || !detail ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-5 mt-5">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Status" value={detail.respondent?.status} />
                <Stat label="Industry" value={detail.respondent?.industry} />
                <Stat label="Company" value={detail.respondent?.company_name} />
                <Stat label="Designation" value={detail.respondent?.designation} />
                <Stat label="Company size" value={detail.respondent?.company_size} />
                <Stat label="Experience" value={detail.respondent?.years_of_experience} />
              </div>

              <Separator />

              <ResponsesBySection
                schema={schema}
                responses={detail.responses || []}
              />

              {detail.skill_ratings && detail.skill_ratings.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Star className="h-4 w-4" /> Skill ratings ({detail.skill_ratings.length})
                    </h3>
                    <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                      {detail.skill_ratings.map((sr, i) => (
                        <div
                          key={`${sr.skill_name}-${i}`}
                          className="flex items-center justify-between px-3 py-1.5 text-xs"
                        >
                          <span className="truncate">
                            {sr.skill_name}
                            {sr.is_custom_skill && (
                              <Badge variant="outline" className="ml-1 text-[9px]">custom</Badge>
                            )}
                          </span>
                          <span className="font-mono text-muted-foreground whitespace-nowrap">
                            imp {sr.importance_rating ?? "—"} · dem {sr.demonstration_rating ?? "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value ?? "—"}</div>
    </div>
  );
}

function ResponsesBySection({
  schema,
  responses,
}: {
  schema: SurveySchema;
  responses: { section_key: string; question_key: string; response_type: string; response_value: any }[];
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof responses>();
    for (const r of responses) {
      if (!map.has(r.section_key)) map.set(r.section_key, []);
      map.get(r.section_key)!.push(r);
    }
    return map;
  }, [responses]);

  const sections = schema.sections || [];

  if (responses.length === 0) {
    return <div className="text-xs text-muted-foreground">No responses recorded</div>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Responses</h3>
      {sections.map((sec) => {
        const sectionResponses = grouped.get(sec.key) || [];
        if (sectionResponses.length === 0) return null;
        const lookup = new Map(sectionResponses.map((r) => [r.question_key, r]));
        return (
          <div key={sec.key} className="border rounded-md p-3">
            <div className="text-sm font-medium mb-2">{sec.title}</div>
            <div className="space-y-2">
              {(sec.questions || []).map((q) => {
                const r = lookup.get(q.key);
                if (!r) return null;
                return (
                  <div key={q.key} className="text-xs">
                    <div className="text-muted-foreground">{q.label}</div>
                    <div className="mt-0.5 break-words">{renderValue(r.response_value)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderValue(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.map((x) => renderValue(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
