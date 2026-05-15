import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Pause, Play, Pencil, Trash2, Loader2, CheckCircle2, XCircle, CalendarClock, Info, ChevronDown, Search, X,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import cronstrue from "cronstrue";
import { ChipSelect } from "@/pages/pipelines/job-collection";
import {
  COUNTRIES, COUNTRY_CODE_MAP, EXP_LEVELS, WORK_TYPES, WORK_LOCATIONS, INDUSTRIES,
  TIME_OPTIONS, LIMIT_PRESETS, JOB_FAMILIES, GOOGLE_EMP_TYPES,
  type JobRole,
} from "@/lib/pipeline-constants";

interface Schedule {
  id: string;
  name: string;
  pipeline_type: string;
  config: any;
  frequency: string;
  cron_expression: string | null;
  is_active: boolean;
  max_runs: number | null;
  total_runs: number;
  last_run_at: string | null;
  last_run_status: string | null;
  next_run_at: string | null;
  credit_limit: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const PIPELINE_TYPES = [
  { value: "google_jobs", label: "Google Jobs" },
  { value: "linkedin_jobs", label: "LinkedIn Jobs" },
  { value: "bayt_jobs", label: "Bayt.com Jobs" },
  { value: "naukrigulf_jobs", label: "NaukriGulf Jobs" },
  { value: "alumni", label: "Alumni Search" },
  { value: "jd_enrichment", label: "JD Enrichment" },
  { value: "people_enrichment", label: "People Enrichment" },
  { value: "company_enrichment", label: "Company Enrichment" },
];

const FREQUENCIES = [
  { value: "hourly", label: "Hourly" },
  { value: "every_6h", label: "Every 6 Hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom Cron" },
];

function frequencyLabel(frequency: string, cron_expression?: string | null): string {
  if (frequency === "custom" && cron_expression) {
    try {
      return cronstrue.toString(cron_expression);
    } catch {
      return cron_expression;
    }
  }
  return FREQUENCIES.find(f => f.value === frequency)?.label || frequency;
}

function pipelineTypeLabel(type: string): string {
  return PIPELINE_TYPES.find(p => p.value === type)?.label || type;
}

// ── Job Roles selector (shared between LinkedIn & Google config) ─────────────

function JobRolesSection({ allRoles, rolesLoading, selectedRoleIds, onToggleRole, onClearAll }: {
  allRoles: JobRole[];
  rolesLoading: boolean;
  selectedRoleIds: string[];
  onToggleRole: (id: string) => void;
  onClearAll: () => void;
}) {
  const [selectedFamily, setSelectedFamily] = useState<string>("all");
  const [roleSearch, setRoleSearch] = useState("");

  const filteredRoles = allRoles.filter(r => {
    if (selectedFamily !== "all" && r.family !== selectedFamily) return false;
    if (roleSearch && !r.name.toLowerCase().includes(roleSearch.toLowerCase())) return false;
    return true;
  });

  const selectedRoles = allRoles.filter(r => selectedRoleIds.includes(r.id));
  const allSynonyms = selectedRoles.flatMap(r => r.synonyms);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Roles</p>
      <p className="text-[10px] text-muted-foreground">Select roles — synonyms auto-expand into search queries</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Job Family</Label>
          <Select value={selectedFamily} onValueChange={setSelectedFamily}>
            <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Families</SelectItem>
              {JOB_FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Search Roles</Label>
          <div className="relative mt-1">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={roleSearch} onChange={e => setRoleSearch(e.target.value)} placeholder="Filter..." className="text-xs h-8 pl-7" />
          </div>
        </div>
      </div>
      <ScrollArea className="h-32 rounded-md border p-2">
        {filteredRoles.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">{rolesLoading ? "Loading roles..." : "No roles match"}</p>
        ) : (
          <div className="space-y-0.5">
            {filteredRoles.map(role => (
              <label key={role.id} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-muted/50 cursor-pointer">
                <Checkbox checked={selectedRoleIds.includes(role.id)} onCheckedChange={() => onToggleRole(role.id)} />
                <span className="text-xs">{role.name}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{role.family}</span>
              </label>
            ))}
          </div>
        )}
      </ScrollArea>
      {selectedRoles.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs">Selected ({selectedRoles.length})</Label>
            <button type="button" onClick={onClearAll} className="text-[10px] text-muted-foreground hover:text-foreground">Clear all</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {selectedRoles.map(r => (
              <Badge key={r.id} variant="secondary" className="text-[10px] pr-1">
                {r.name}
                <button onClick={() => onToggleRole(r.id)} className="ml-1 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
              </Badge>
            ))}
          </div>
        </div>
      )}
      {allSynonyms.length > 0 && (
        <div>
          <Label className="text-xs mb-1 block">Synonym Preview ({allSynonyms.length} terms)</Label>
          <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto rounded-md border p-1.5 bg-muted/30">
            {allSynonyms.map((s, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-background border text-[10px] text-muted-foreground">{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Schedule Dialog ──────────────────────────────────────────────────────────

function ScheduleDialog({ open, onOpenChange, schedule }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule?: Schedule | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!schedule;

  // Schedule-level fields
  const [name, setName] = useState(schedule?.name || "");
  const [pipelineType, setPipelineType] = useState(schedule?.pipeline_type || "google_jobs");
  const [frequency, setFrequency] = useState(schedule?.frequency || "daily");
  const [cronExpression, setCronExpression] = useState(schedule?.cron_expression || "");
  const [maxRuns, setMaxRuns] = useState(schedule?.max_runs?.toString() || "");
  const [creditLimit, setCreditLimit] = useState(schedule?.credit_limit?.toString() || "");

  // Job roles (shared between LinkedIn & Google)
  const { data: allRoles = [], isLoading: rolesLoading } = useQuery<JobRole[]>({
    queryKey: ["/api/masters/job-roles"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/job-roles");
      if (!res.ok) throw new Error(`Failed to fetch job roles: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(() => {
    const ids = schedule?.config?.job_role_ids;
    return Array.isArray(ids) ? ids : [];
  });
  const toggleRole = (id: string) => setSelectedRoleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // ── LinkedIn state ──
  const [liKeywords, setLiKeywords] = useState(schedule?.config?.search_keywords || "");
  const [liLocation, setLiLocation] = useState(schedule?.config?.location || "India");
  const [liExpLevel, setLiExpLevel] = useState<string[]>(() => {
    const v = schedule?.config?.experience_level;
    return v ? v.split(",") : [];
  });
  const [liWorkType, setLiWorkType] = useState<string[]>(() => {
    const v = schedule?.config?.work_type;
    return v ? v.split(",") : ["1"];
  });
  const [liWorkLoc, setLiWorkLoc] = useState<string[]>(() => {
    const v = schedule?.config?.work_location;
    return v ? v.split(",") : [];
  });
  const [liIndustries, setLiIndustries] = useState<string[]>(() => {
    const v = schedule?.config?.industry_ids;
    return v ? v.split(",") : [];
  });
  const [liCompanyInput, setLiCompanyInput] = useState("");
  const [liCompanies, setLiCompanies] = useState<string[]>(() => {
    const v = schedule?.config?.company_names;
    return v ? v.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
  });
  const [liTimePosted, setLiTimePosted] = useState(() => {
    const dp = schedule?.config?.date_posted;
    if (!dp) return "r86400";
    const map: Record<string, string> = { "1h": "r3600", "24h": "r86400", "week": "r604800", "month": "r2592000", "any": "" };
    return map[dp] ?? "r86400";
  });
  const [liSortBy, setLiSortBy] = useState(schedule?.config?.sort_by || "DD");
  const [liFetchDesc, setLiFetchDesc] = useState(schedule?.config?.fetch_description !== false);
  const [liEasyApply, setLiEasyApply] = useState(!!schedule?.config?.easy_apply_only);
  const [liLimit, setLiLimit] = useState(schedule?.config?.limit || 100);
  const [liCustomLimit, setLiCustomLimit] = useState("");

  const addLiCompany = () => {
    const n = liCompanyInput.trim();
    if (n && !liCompanies.includes(n)) setLiCompanies([...liCompanies, n]);
    setLiCompanyInput("");
  };

  // ── Google state ──
  const [gQuery, setGQuery] = useState(schedule?.config?.query || "");
  const [gCountry, setGCountry] = useState(schedule?.config?.country || "IN");
  const [gEmpTypes, setGEmpTypes] = useState<string[]>(() => {
    const v = schedule?.config?.employment_types;
    return v ? v.split(",") : ["FULLTIME"];
  });
  const [gJobReqs, setGJobReqs] = useState(schedule?.config?.job_requirements || "");
  const [gEmployer, setGEmployer] = useState(schedule?.config?.employer_name || "");
  const [gRemoteOnly, setGRemoteOnly] = useState(!!schedule?.config?.remote_only);
  const [gDatePosted, setGDatePosted] = useState(schedule?.config?.date_posted || "week");
  const [gNumPages, setGNumPages] = useState((schedule?.config?.num_pages || 5).toString());
  const [gExcludePublishers, setGExcludePublishers] = useState(schedule?.config?.exclude_job_publishers || "");

  // ── Simple config state for other pipeline types ──
  const [simpleConfig, setSimpleConfig] = useState<any>(schedule?.config || {});
  const updateSimple = (key: string, value: any) => setSimpleConfig((prev: any) => ({ ...prev, [key]: value }));

  // Reset all pipeline config when type changes
  const handlePipelineTypeChange = (newType: string) => {
    if (newType === pipelineType) return;
    setPipelineType(newType);
    setSelectedRoleIds([]);
    setLiKeywords(""); setLiLocation("India"); setLiExpLevel([]); setLiWorkType(["1"]); setLiWorkLoc([]);
    setLiIndustries([]); setLiCompanies([]); setLiTimePosted("r86400"); setLiSortBy("DD");
    setLiFetchDesc(true); setLiEasyApply(false); setLiLimit(100); setLiCustomLimit("");
    setGQuery(""); setGCountry("IN"); setGEmpTypes(["FULLTIME"]); setGJobReqs(""); setGEmployer("");
    setGRemoteOnly(false); setGDatePosted("week"); setGNumPages("5"); setGExcludePublishers("");
    setSimpleConfig({});
  };

  // Build config matching pipeline run handler format
  const buildConfig = (): any => {
    if (pipelineType === "linkedin_jobs") {
      return {
        search_keywords: liKeywords || undefined,
        job_role_ids: selectedRoleIds.length > 0 ? selectedRoleIds : undefined,
        location: liLocation,
        date_posted: liTimePosted === "r86400" ? "24h" : liTimePosted === "r604800" ? "week" : liTimePosted === "r2592000" ? "month" : liTimePosted === "r3600" ? "1h" : "any",
        limit: liLimit,
        experience_level: liExpLevel.length > 0 ? liExpLevel.join(",") : undefined,
        work_type: liWorkType.length > 0 ? liWorkType.join(",") : undefined,
        work_location: liWorkLoc.length > 0 ? liWorkLoc.join(",") : undefined,
        industry_ids: liIndustries.length > 0 ? liIndustries.join(",") : undefined,
        company_names: liCompanies.length > 0 ? liCompanies.join(",") : undefined,
        fetch_description: liFetchDesc,
        easy_apply_only: liEasyApply || undefined,
        sort_by: liSortBy,
      };
    }
    if (pipelineType === "google_jobs") {
      const selectedRoles = allRoles.filter(r => selectedRoleIds.includes(r.id));
      let queries: string[] = [];
      if (selectedRoleIds.length > 0) {
        queries = selectedRoles.map(r => r.synonyms.map(s => `"${s}"`).join(" OR "));
      }
      if (gQuery.trim()) queries.push(gQuery.trim());
      return {
        queries: queries.length > 0 ? queries : undefined,
        job_role_ids: selectedRoleIds.length > 0 ? selectedRoleIds : undefined,
        country: gCountry,
        date_posted: gDatePosted,
        employment_types: gEmpTypes.join(",") || undefined,
        remote_only: gRemoteOnly || undefined,
        job_requirements: gJobReqs && gJobReqs !== "any" ? gJobReqs : undefined,
        employer_name: gEmployer || undefined,
        exclude_job_publishers: gExcludePublishers || undefined,
        num_pages: parseInt(gNumPages) || 5,
      };
    }
    return simpleConfig;
  };

  const cronPreview = frequency === "custom" && cronExpression ? (() => {
    try { return cronstrue.toString(cronExpression); } catch { return "Invalid cron expression"; }
  })() : null;

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        pipeline_type: pipelineType,
        config: buildConfig(),
        frequency,
        cron_expression: frequency === "custom" ? cronExpression : undefined,
        max_runs: maxRuns ? parseInt(maxRuns) : null,
        credit_limit: creditLimit ? parseInt(creditLimit) : null,
      };
      if (isEdit) {
        const res = await apiRequest("PUT", `/api/schedules/${schedule.id}`, body);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/schedules", body);
        return res.json();
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Schedule updated" : "Schedule created" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Schedule" : "New Schedule"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update the schedule configuration." : "Configure a recurring pipeline schedule."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Schedule-level fields */}
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input className="h-8 text-xs" placeholder="e.g. Daily Dubai Finance Jobs"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pipeline Type</Label>
            <Select value={pipelineType} onValueChange={handlePipelineTypeChange}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PIPELINE_TYPES.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* ── LinkedIn Jobs config ── */}
          {pipelineType === "linkedin_jobs" && (
            <div className="space-y-4">
              <JobRolesSection
                allRoles={allRoles} rolesLoading={rolesLoading}
                selectedRoleIds={selectedRoleIds} onToggleRole={toggleRole}
                onClearAll={() => setSelectedRoleIds([])}
              />
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Search</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Keywords {selectedRoleIds.length === 0 ? "*" : "(optional)"}</Label>
                    <Input value={liKeywords} onChange={e => setLiKeywords(e.target.value)} placeholder="e.g. Data Analyst" className="text-xs h-8 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Country</Label>
                    <Select value={liLocation} onValueChange={setLiLocation}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select country" /></SelectTrigger>
                      <SelectContent>
                        {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</p>
                <div>
                  <Label className="text-xs mb-1 block">Experience Level</Label>
                  <ChipSelect options={EXP_LEVELS} selected={liExpLevel} onChange={setLiExpLevel} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Work Type</Label>
                  <ChipSelect options={WORK_TYPES} selected={liWorkType} onChange={setLiWorkType} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Work Location</Label>
                  <ChipSelect options={WORK_LOCATIONS} selected={liWorkLoc} onChange={setLiWorkLoc} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Industry</Label>
                  <ChipSelect options={INDUSTRIES} selected={liIndustries} onChange={setLiIndustries} />
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Company Filter</p>
                <div className="flex gap-2">
                  <Input value={liCompanyInput} onChange={e => setLiCompanyInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addLiCompany())}
                    placeholder="Type company name + Enter" className="text-xs h-8 flex-1" />
                  <Button type="button" variant="outline" size="sm" onClick={addLiCompany} className="h-8 px-3 text-xs">Add</Button>
                </div>
                {liCompanies.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {liCompanies.map(c => (
                      <Badge key={c} variant="secondary" className="text-[10px] pr-1">
                        {c}
                        <button onClick={() => setLiCompanies(liCompanies.filter(x => x !== c))} className="ml-1 hover:text-destructive">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time & Sort</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Time Posted</Label>
                    <Select value={liTimePosted} onValueChange={setLiTimePosted}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map(o => <SelectItem key={o.value || "any"} value={o.value || "any"}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Sort By</Label>
                    <Select value={liSortBy} onValueChange={setLiSortBy}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DD">Most Recent</SelectItem>
                        <SelectItem value="R">Relevance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Options</p>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Fetch job descriptions</Label>
                    <p className="text-[10px] text-muted-foreground">Required for JD analysis and skill extraction</p>
                  </div>
                  <Switch checked={liFetchDesc} onCheckedChange={setLiFetchDesc} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Easy Apply only</Label>
                    <p className="text-[10px] text-muted-foreground">Restrict to LinkedIn one-click apply jobs</p>
                  </div>
                  <Switch checked={liEasyApply} onCheckedChange={setLiEasyApply} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Job Limit</Label>
                  <div className="flex gap-1.5 items-center">
                    {LIMIT_PRESETS.map(n => (
                      <button key={n} type="button" onClick={() => { setLiLimit(n); setLiCustomLimit(""); }}
                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                          liLimit === n && !liCustomLimit ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50"
                        }`}>{n}</button>
                    ))}
                    <Input type="number" value={liCustomLimit} onChange={e => { setLiCustomLimit(e.target.value); if (e.target.value) setLiLimit(parseInt(e.target.value) || 100); }}
                      placeholder="Custom" className="w-20 h-7 text-xs" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Google Jobs config ── */}
          {pipelineType === "google_jobs" && (
            <div className="space-y-4">
              <JobRolesSection
                allRoles={allRoles} rolesLoading={rolesLoading}
                selectedRoleIds={selectedRoleIds} onToggleRole={toggleRole}
                onClearAll={() => setSelectedRoleIds([])}
              />
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Search</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Query {selectedRoleIds.length === 0 ? "*" : "(optional)"}</Label>
                    <Input value={gQuery} onChange={e => setGQuery(e.target.value)} placeholder="e.g. Data Analyst" className="text-xs h-8 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Country</Label>
                    <Select value={gCountry} onValueChange={setGCountry}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COUNTRIES.map(c => {
                          const code = COUNTRY_CODE_MAP[c] || c.substring(0, 2).toUpperCase();
                          return <SelectItem key={code} value={code}>{c}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</p>
                <div>
                  <Label className="text-xs mb-1 block">Employment Type</Label>
                  <ChipSelect options={GOOGLE_EMP_TYPES} selected={gEmpTypes} onChange={setGEmpTypes} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Experience</Label>
                    <Select value={gJobReqs || "any"} onValueChange={v => setGJobReqs(v === "any" ? "" : v)}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="under_3_years_experience">Under 3 years</SelectItem>
                        <SelectItem value="more_than_3_years_experience">3+ years</SelectItem>
                        <SelectItem value="no_experience">No experience</SelectItem>
                        <SelectItem value="no_degree">No degree required</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Employer</Label>
                    <Input value={gEmployer} onChange={e => setGEmployer(e.target.value)} placeholder="e.g. Amazon" className="text-xs h-8 mt-1" />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Remote jobs only</Label>
                    <p className="text-[10px] text-muted-foreground">Show only remote/work-from-home positions</p>
                  </div>
                  <Switch checked={gRemoteOnly} onCheckedChange={setGRemoteOnly} />
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time & Options</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Date Posted</Label>
                    <Select value={gDatePosted} onValueChange={setGDatePosted}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="3days">Past 3 Days</SelectItem>
                        <SelectItem value="week">Past Week</SelectItem>
                        <SelectItem value="month">Past Month</SelectItem>
                        <SelectItem value="all">All Time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Pages per Query</Label>
                    <Input type="number" value={gNumPages} onChange={e => setGNumPages(e.target.value)} min={1} max={10} className="text-xs h-8 mt-1" />
                    <p className="text-[10px] text-muted-foreground mt-0.5">~10 jobs/page</p>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Exclude Publishers</Label>
                  <Input value={gExcludePublishers} onChange={e => setGExcludePublishers(e.target.value)} placeholder="e.g. BeBee, Jooble" className="text-xs h-8 mt-1" />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Comma-separated list of job boards to exclude</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Simple config for other pipeline types ── */}
          {pipelineType === "alumni" && (
            <div className="space-y-1">
              <Label className="text-xs">School URLs / Slugs (one per line)</Label>
              <Input className="h-8 text-xs" placeholder="iit-bombay"
                value={simpleConfig.university_slug || ""} onChange={(e) => updateSimple("university_slug", e.target.value)} />
            </div>
          )}
          {(pipelineType === "jd_enrichment" || pipelineType === "people_enrichment" || pipelineType === "company_enrichment") && (
            <div className="space-y-1">
              <Label className="text-xs">Batch Size</Label>
              <Input type="number" className="h-8 text-xs" placeholder="50" min={1}
                value={simpleConfig.batch_size || 50} onChange={(e) => updateSimple("batch_size", parseInt(e.target.value) || 50)} />
            </div>
          )}

          <Separator />

          {/* Schedule-level fields */}
          <div className="space-y-1">
            <Label className="text-xs">Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map(f => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {frequency === "custom" && (
            <div className="space-y-1">
              <Label className="text-xs">Cron Expression</Label>
              <Input className="h-8 text-xs font-mono" placeholder="0 */6 * * *"
                value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} />
              {cronPreview && (
                <p className="text-[11px] text-muted-foreground">{cronPreview}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Max Runs</Label>
              <Input type="number" className="h-8 text-xs" placeholder="Unlimited" min={1}
                value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Credit Limit</Label>
              <Input type="number" className="h-8 text-xs" placeholder="No limit" min={1}
                value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name}>
            {mutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Schedules() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "pause" | "resume" | "delete"; schedule: Schedule } | null>(null);

  const { data: schedules, isLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
    refetchInterval: 10000,
  });

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/schedules/${id}/pause`);
    },
    onSuccess: () => {
      toast({ title: "Schedule paused" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/schedules/${id}/resume`);
    },
    onSuccess: () => {
      toast({ title: "Schedule resumed" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/schedules/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Schedule deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const runNowMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/scheduler/run/${id}`);
    },
    onSuccess: (data) => {
      toast({ title: "Pipeline triggered", description: data.run_id ? "Run started" : "Triggered" });
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
    },
    onError: (err: Error) => toast({ title: "Trigger failed", description: err.message, variant: "destructive" }),
  });

  const handleConfirm = () => {
    if (!confirmAction) return;
    const { type, schedule } = confirmAction;
    if (type === "pause") pauseMutation.mutate(schedule.id);
    else if (type === "resume") resumeMutation.mutate(schedule.id);
    else if (type === "delete") deleteMutation.mutate(schedule.id);
    setConfirmAction(null);
  };

  return (
    <div className="space-y-6" data-testid="schedules-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline Schedules</h1>
          <p className="text-sm text-muted-foreground">Manage recurring automated pipeline runs</p>
        </div>
        <Button onClick={() => { setEditSchedule(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> New Schedule
        </Button>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3.5 w-3.5" />
          <span>How this works</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-2">
            <p><strong>How this works:</strong></p>
            <p>• Schedules automate pipeline runs on a recurring basis</p>
            <p>• The daily cron runs at midnight UTC and triggers any configured schedules</p>
            <p>• Each schedule runs the specified pipeline with its saved configuration</p>
            <p className="pt-1"><strong>How to set up:</strong></p>
            <p>1. Create a schedule with pipeline type and configuration</p>
            <p>2. Set frequency (daily is recommended for job collection)</p>
            <p>3. The scheduler checks at midnight UTC and runs all active schedules</p>
            <p className="pt-1"><strong>Limitations:</strong></p>
            <p>• Minimum frequency is daily (the cron runs once per day at midnight UTC)</p>
            <p>• If a pipeline fails during a scheduled run, check Pipeline Run History for errors</p>
            <p>• Scheduled runs count toward your API credit usage</p>
            <p>• If a schedule shows 0/0 results, the pipeline may have encountered an error — check the Pipelines page for details</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !schedules?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CalendarClock className="h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="font-medium">No schedules yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Create a schedule to automate recurring pipeline runs.</p>
            <Button className="mt-4" onClick={() => { setEditSchedule(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Create Schedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {schedules.map((s) => (
            <Card key={s.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 min-w-0 flex-1">
                    <CardTitle className="text-sm truncate">{s.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {pipelineTypeLabel(s.pipeline_type)}
                      </Badge>
                      {s.is_active ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0">
                          Paused
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-y-2 text-muted-foreground">
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">Frequency</span>
                    <span className="text-foreground">{frequencyLabel(s.frequency, s.cron_expression)}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">Runs</span>
                    <span className="text-foreground">
                      {s.total_runs}{s.max_runs ? ` / ${s.max_runs}` : " / \u221e"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">Last Run</span>
                    <span className="text-foreground flex items-center gap-1">
                      {s.last_run_at ? (
                        <>
                          {s.last_run_status === "completed" || s.last_run_status === "complete" || s.last_run_status === "success" ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          ) : s.last_run_status === "failed" ? (
                            <XCircle className="h-3 w-3 text-red-500" />
                          ) : null}
                          {new Date(s.last_run_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </>
                      ) : "Never"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider">Next Run</span>
                    <span className="text-foreground">
                      {s.is_active && s.next_run_at
                        ? new Date(s.next_run_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "Paused"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1.5 pt-1 border-t">
                  <Button variant="default" size="sm" className="h-7 text-[11px] flex-1"
                    disabled={runNowMutation.isPending}
                    onClick={() => runNowMutation.mutate(s.id)}>
                    {runNowMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />} Run Now
                  </Button>
                  {s.is_active ? (
                    <Button variant="outline" size="sm" className="h-7 text-[11px] flex-1"
                      onClick={() => setConfirmAction({ type: "pause", schedule: s })}>
                      <Pause className="h-3 w-3 mr-1" /> Pause
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 text-[11px] flex-1"
                      onClick={() => setConfirmAction({ type: "resume", schedule: s })}>
                      <Play className="h-3 w-3 mr-1" /> Resume
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-[11px]"
                    onClick={() => { setEditSchedule(s); setDialogOpen(true); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] text-red-600 hover:text-red-700"
                    onClick={() => setConfirmAction({ type: "delete", schedule: s })}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      {dialogOpen && (
        <ScheduleDialog
          open={dialogOpen}
          onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditSchedule(null); }}
          schedule={editSchedule}
        />
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === "pause" && "Pause Schedule"}
              {confirmAction?.type === "resume" && "Resume Schedule"}
              {confirmAction?.type === "delete" && "Delete Schedule"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === "pause" && `Are you sure you want to pause "${confirmAction.schedule.name}"? It will stop triggering until resumed.`}
              {confirmAction?.type === "resume" && `Resume "${confirmAction?.schedule.name}"? It will start triggering again based on its frequency.`}
              {confirmAction?.type === "delete" && `Permanently delete "${confirmAction?.schedule.name}"? This action cannot be undone. Existing pipeline runs will be preserved but unlinked.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {confirmAction?.type === "delete" ? "Delete" : confirmAction?.type === "pause" ? "Pause" : "Resume"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
