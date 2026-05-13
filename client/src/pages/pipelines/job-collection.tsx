import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Loader2, CalendarClock, Link2, Globe, X, Search, Info, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { RunHistory } from "./run-history";

import { authFetch } from "@/lib/queryClient";
import {
  COUNTRIES, COUNTRY_CODE_MAP, EXP_LEVELS, WORK_TYPES, WORK_LOCATIONS, INDUSTRIES,
  TIME_OPTIONS, LIMIT_PRESETS, JOB_FAMILIES, GOOGLE_EMP_TYPES,
  type JobRole,
} from "@/lib/pipeline-constants";

// ── Preset data ──────────────────────────────────────────────────────────────

const FREQUENCIES = [
  { value: "daily", label: "Daily (once)" }, { value: "twice_daily", label: "Twice Daily" },
  { value: "weekly", label: "Weekly" }, { value: "hourly", label: "Every Hour" },
];

// ── Chip toggle component ────────────────────────────────────────────────────

export function ChipSelect({ options, selected, onChange }: {
  options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => toggle(o.value)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
            selected.includes(o.value)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:border-primary/50"
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Main LinkedIn form ───────────────────────────────────────────────────────

function LinkedInForm() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Job Roles — uses the same working endpoint as Masters page
  const { data: allRoles = [], isLoading: rolesLoading, error: rolesError } = useQuery<JobRole[]>({
    queryKey: ["/api/masters/job-roles"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/job-roles");
      if (!res.ok) throw new Error(`Failed to fetch job roles: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const [selectedFamily, setSelectedFamily] = useState<string>("all");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleSearch, setRoleSearch] = useState("");

  const filteredRoles = allRoles.filter(r => {
    if (selectedFamily !== "all" && r.family !== selectedFamily) return false;
    if (roleSearch && !r.name.toLowerCase().includes(roleSearch.toLowerCase())) return false;
    return true;
  });

  const selectedRoles = allRoles.filter(r => selectedRoleIds.includes(r.id));
  const allSynonyms = selectedRoles.flatMap(r => r.synonyms);

  const toggleRole = (id: string) => {
    setSelectedRoleIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Search
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("India");


  // Filters
  const [expLevel, setExpLevel] = useState<string[]>([]);
  const [workType, setWorkType] = useState<string[]>(["1"]);
  const [workLoc, setWorkLoc] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);

  // Company
  const [companyInput, setCompanyInput] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);

  // Time & Sort
  const [timePosted, setTimePosted] = useState("r86400");
  const [sortBy, setSortBy] = useState("DD");

  // Options
  const [fetchDesc, setFetchDesc] = useState(true);
  const [easyApply, setEasyApply] = useState(false);
  const [limit, setLimit] = useState(100);
  const [customLimit, setCustomLimit] = useState("");

  // Schedule
  const [scheduleMode, setScheduleMode] = useState(false);
  const [frequency, setFrequency] = useState("daily");
  const [scheduleName, setScheduleName] = useState("");

  const addCompany = () => {
    const name = companyInput.trim();
    if (name && !companies.includes(name)) setCompanies([...companies, name]);
    setCompanyInput("");
  };

  const autoScheduleName = `${frequency === "daily" ? "Daily" : frequency === "weekly" ? "Weekly" : "Recurring"} ${keywords} in ${location}`;

  const buildConfig = () => ({
    search_keywords: keywords || undefined,
    job_role_ids: selectedRoleIds.length > 0 ? selectedRoleIds : undefined,
    location,
    date_posted: timePosted === "r86400" ? "24h" : timePosted === "r604800" ? "week" : timePosted === "r2592000" ? "month" : timePosted === "r3600" ? "1h" : "any",
    limit,
    experience_level: expLevel.length > 0 ? expLevel.join(",") : undefined,
    work_type: workType.length > 0 ? workType.join(",") : undefined,
    work_location: workLoc.length > 0 ? workLoc.join(",") : undefined,
    industry_ids: industries.length > 0 ? industries.join(",") : undefined,
    company_names: companies.length > 0 ? companies.join(",") : undefined,
    fetch_description: fetchDesc,
    easy_apply_only: easyApply || undefined,
    sort_by: sortBy,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST", body: JSON.stringify({ pipeline_type: "linkedin_jobs", config: buildConfig() }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "LinkedIn scraper started" }); qc.invalidateQueries({ queryKey: ["/api/pipelines"] }); },
    onError: (e: any) => toast({ title: "Failed to start", description: e.message, variant: "destructive" }),
  });

  const saveSchedule = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/scheduler/schedules", {
        method: "POST", body: JSON.stringify({
          name: scheduleName || autoScheduleName,
          pipeline_type: "linkedin_jobs",
          config: buildConfig(),
          frequency,
          cron_expression: frequency === "daily" ? "0 0 * * *" : frequency === "twice_daily" ? "0 0,12 * * *" : frequency === "weekly" ? "0 0 * * 1" : "0 * * * *",
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Schedule saved", description: "Will run automatically based on frequency" }); },
    onError: (e: any) => toast({ title: "Failed to save schedule", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Link2 className="h-5 w-5 text-blue-600" /> LinkedIn Job Scraper
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">$0.001/job via Apify</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Info className="h-3 w-3" /> How to use
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-lg p-3">
            <p>1. <strong>Select Job Roles</strong> from the taxonomy — each role's synonyms are auto-expanded into precise LinkedIn OR queries</p>
            <p>2. <strong>Or use Keywords</strong> as free-text fallback (less precise, LinkedIn interprets loosely)</p>
            <p>3. <strong>Set filters</strong> — experience level, work type, location, industry narrow results server-side</p>
            <p>4. <strong>Fetch descriptions ON</strong> is required for JD analysis and skill extraction</p>
            <p>5. <strong>One Apify run per role</strong> — selecting 3 roles = 3 parallel searches for better relevance</p>
            <p>6. <strong>Schedule</strong> to run daily/weekly for continuous collection</p>
          </CollapsibleContent>
        </Collapsible>

        {/* ── JOB ROLES ─────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Job Roles</p>
          <p className="text-[10px] text-muted-foreground mb-2">Select roles to search — synonyms are auto-expanded into LinkedIn search queries</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Job Family</Label>
                <Select value={selectedFamily} onValueChange={setSelectedFamily}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Families</SelectItem>
                    {JOB_FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Search Roles</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input value={roleSearch} onChange={e => setRoleSearch(e.target.value)} placeholder="Filter roles..." className="text-sm h-9 pl-8" />
                </div>
              </div>
            </div>
            <ScrollArea className="h-40 rounded-md border p-2">
              {filteredRoles.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  {rolesError ? `Error: ${(rolesError as Error).message}` : rolesLoading ? "Loading roles..." : "No roles match your filter"}
                </p>
              ) : (
                <div className="space-y-1">
                  {filteredRoles.map(role => (
                    <label key={role.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer">
                      <Checkbox
                        checked={selectedRoleIds.includes(role.id)}
                        onCheckedChange={() => toggleRole(role.id)}
                      />
                      <span className="text-xs">{role.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{role.family}</span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
            {selectedRoles.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs">Selected ({selectedRoles.length})</Label>
                  <button type="button" onClick={() => setSelectedRoleIds([])} className="text-[10px] text-muted-foreground hover:text-foreground">Clear all</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedRoles.map(r => (
                    <Badge key={r.id} variant="secondary" className="text-[10px] pr-1">
                      {r.name}
                      <button onClick={() => toggleRole(r.id)} className="ml-1 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {allSynonyms.length > 0 && (
              <div>
                <Label className="text-xs mb-1 block">Synonym Preview ({allSynonyms.length} search terms)</Label>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto rounded-md border p-2 bg-muted/30">
                  {allSynonyms.map((s, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-background border text-[10px] text-muted-foreground">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* ── SEARCH (keywords fallback) ─────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Search</p>
          <p className="text-[10px] text-muted-foreground mb-2">Free-text keywords override — used if no roles selected, or combined with roles</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Keywords {selectedRoleIds.length === 0 ? "*" : "(optional override)"}</Label>
              <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="e.g. Data Analyst" className="text-sm h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Country</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select country" /></SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* ── FILTERS ──────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Filters</p>
          <p className="text-[10px] text-muted-foreground mb-2">LinkedIn native filters — applied server-side to narrow search results</p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-1.5 block">Experience Level</Label>
              <ChipSelect options={EXP_LEVELS} selected={expLevel} onChange={setExpLevel} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Work Type</Label>
              <ChipSelect options={WORK_TYPES} selected={workType} onChange={setWorkType} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Work Location</Label>
              <ChipSelect options={WORK_LOCATIONS} selected={workLoc} onChange={setWorkLoc} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Industry</Label>
              <ChipSelect options={INDUSTRIES} selected={industries} onChange={setIndustries} />
            </div>
          </div>
        </div>

        <Separator />

        {/* ── COMPANY ──────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Company Filter</p>
          <p className="text-[10px] text-muted-foreground mb-2">Restrict results to specific companies — LinkedIn resolves names to company IDs</p>
          <div className="flex gap-2">
            <Input value={companyInput} onChange={e => setCompanyInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCompany())}
              placeholder="Type company name + Enter" className="text-sm h-9 flex-1" />
            <Button type="button" variant="outline" size="sm" onClick={addCompany} className="h-9 px-3 text-xs">Add</Button>
          </div>
          {companies.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {companies.map(c => (
                <Badge key={c} variant="secondary" className="text-xs pr-1">
                  {c}
                  <button onClick={() => setCompanies(companies.filter(x => x !== c))} className="ml-1 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* ── TIME & SORT ──────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Time & Sort</p>
          <p className="text-[10px] text-muted-foreground mb-2">Control recency and ordering of results</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Time Posted</Label>
              <Select value={timePosted} onValueChange={setTimePosted}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map(o => <SelectItem key={o.value || "any"} value={o.value || "any"}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sort By</Label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD">Most Recent</SelectItem>
                  <SelectItem value="R">Relevance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* ── OPTIONS ──────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Options</p>
          <p className="text-[10px] text-muted-foreground mb-2">Controls for description fetching, job limits, and apply type</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Fetch job descriptions</Label>
                <p className="text-[10px] text-muted-foreground">Fetches full JD text per job — required for skill extraction and JD analysis</p>
              </div>
              <Switch checked={fetchDesc} onCheckedChange={setFetchDesc} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Easy Apply only</Label>
                <p className="text-[10px] text-muted-foreground">Restrict to jobs with LinkedIn's one-click apply — usually a smaller subset</p>
              </div>
              <Switch checked={easyApply} onCheckedChange={setEasyApply} />
            </div>
            <div>
              <Label className="text-xs mb-0.5 block">Job Limit</Label>
              <p className="text-[10px] text-muted-foreground mb-1.5">Max jobs to collect per run — LinkedIn returns ~10 jobs/page</p>
              <div className="flex gap-1.5 items-center">
                {LIMIT_PRESETS.map(n => (
                  <button key={n} type="button" onClick={() => { setLimit(n); setCustomLimit(""); }}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                      limit === n && !customLimit ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    }`}>{n}</button>
                ))}
                <Input type="number" value={customLimit} onChange={e => { setCustomLimit(e.target.value); if (e.target.value) setLimit(parseInt(e.target.value) || 100); }}
                  placeholder="Custom" className="w-20 h-8 text-xs" />
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* ── SCHEDULE ─────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Save this configuration as a recurring pipeline</p>
            </div>
            <Switch checked={scheduleMode} onCheckedChange={setScheduleMode} />
          </div>
          {scheduleMode && (
            <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Schedule Name</Label>
                  <Input value={scheduleName} onChange={e => setScheduleName(e.target.value)} placeholder={autoScheduleName} className="text-sm h-9 mt-1" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── ACTIONS ──────────────────────────────────────── */}
        <div className="flex gap-3 pt-1">
          <Button onClick={() => runNow.mutate()} disabled={runNow.isPending || (!keywords.trim() && selectedRoleIds.length === 0)} className="flex-1 h-10">
            {runNow.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run Now
          </Button>
          {scheduleMode && (
            <Button onClick={() => saveSchedule.mutate()} disabled={saveSchedule.isPending} variant="outline" className="flex-1 h-10">
              {saveSchedule.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Save Schedule
            </Button>
          )}
        </div>

        {/* ── COST ESTIMATE ────────────────────────────────── */}
        <div className="rounded-md bg-muted/50 p-2.5 text-[10px] text-muted-foreground">
          <span className="font-medium">Estimated cost:</span> {limit} jobs × ${fetchDesc ? "0.002" : "0.001"} = <span className="font-semibold text-foreground">${((limit * (fetchDesc ? 0.002 : 0.001))).toFixed(2)}</span> + Apify compute
        </div>
      </CardContent>
    </Card>
  );
}

// ── Google Jobs form (simpler) ───────────────────────────────────────────────

function GoogleJobsForm() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Job Roles (same taxonomy as LinkedIn)
  const { data: gRoles = [], isLoading: gRolesLoading } = useQuery<JobRole[]>({
    queryKey: ["/api/masters/job-roles"],
    staleTime: 5 * 60 * 1000,
  });
  const [gSelectedFamily, setGSelectedFamily] = useState<string>("all");
  const [gSelectedRoleIds, setGSelectedRoleIds] = useState<string[]>([]);
  const [gRoleSearch, setGRoleSearch] = useState("");

  const gFilteredRoles = gRoles.filter(r => {
    if (gSelectedFamily !== "all" && r.family !== gSelectedFamily) return false;
    if (gRoleSearch && !r.name.toLowerCase().includes(gRoleSearch.toLowerCase())) return false;
    return true;
  });
  const gSelectedRoles = gRoles.filter(r => gSelectedRoleIds.includes(r.id));
  const gAllSynonyms = gSelectedRoles.flatMap(r => r.synonyms);
  const gToggleRole = (id: string) => setGSelectedRoleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // Schedule
  const [gScheduleMode, setGScheduleMode] = useState(false);
  const [gFrequency, setGFrequency] = useState("daily");
  const [gScheduleName, setGScheduleName] = useState("");

  // Search & Filters
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("IN");
  const [datePosted, setDatePosted] = useState("week");
  const [empTypes, setEmpTypes] = useState<string[]>(["FULLTIME"]);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [jobReqs, setJobReqs] = useState("");
  const [employer, setEmployer] = useState("");
  const [excludePublishers, setExcludePublishers] = useState("");
  const [numPages, setNumPages] = useState("5");

  const buildGoogleConfig = () => {
    // Build queries: one per role (synonym expansion) or free text
    let queries: string[] = [];
    if (gSelectedRoleIds.length > 0) {
      queries = gSelectedRoles.map(r => r.synonyms.map(s => `"${s}"`).join(" OR "));
    }
    if (query.trim()) queries.push(query.trim());
    if (queries.length === 0) queries = ["software engineer"];
    return {
      queries,
      job_role_ids: gSelectedRoleIds.length > 0 ? gSelectedRoleIds : undefined,
      country,
      date_posted: datePosted,
      employment_types: empTypes.join(",") || undefined,
      remote_only: remoteOnly || undefined,
      job_requirements: jobReqs && jobReqs !== "any" ? jobReqs : undefined,
      employer_name: employer || undefined,
      exclude_job_publishers: excludePublishers || undefined,
      num_pages: parseInt(numPages) || 5,
    };
  };

  const run = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST", body: JSON.stringify({ pipeline_type: "google_jobs", config: buildGoogleConfig() }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Google Jobs search started" }); qc.invalidateQueries({ queryKey: ["/api/pipelines"] }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const gAutoScheduleName = `${gFrequency === "daily" ? "Daily" : gFrequency === "weekly" ? "Weekly" : "Recurring"} Google Jobs ${query || "search"} in ${country}`;

  const gSaveSchedule = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/scheduler/schedules", {
        method: "POST", body: JSON.stringify({
          name: gScheduleName || gAutoScheduleName,
          pipeline_type: "google_jobs",
          config: buildGoogleConfig(),
          frequency: gFrequency,
          cron_expression: gFrequency === "daily" ? "0 0 * * *" : gFrequency === "twice_daily" ? "0 0,12 * * *" : gFrequency === "weekly" ? "0 0 * * 1" : "0 * * * *",
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Schedule saved", description: "Will run automatically based on frequency" }); },
    onError: (e: any) => toast({ title: "Failed to save schedule", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-green-600" /> Google Jobs
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">via Apify • Aggregates 20+ job boards</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">

        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Info className="h-3 w-3" /> How to use
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-lg p-3">
            <p>1. <strong>Select Job Roles</strong> — same taxonomy as LinkedIn, synonyms become Google Jobs search queries</p>
            <p>2. <strong>Google aggregates 20+ boards</strong> — Indeed, LinkedIn, Glassdoor, Naukri, company pages, etc.</p>
            <p>3. <strong>Results include publisher</strong> — shows which job board originally listed each job</p>
            <p>4. <strong>Descriptions included</strong> — full JD text, qualifications, and benefits come automatically</p>
            <p>5. <strong>Exclude publishers</strong> to skip low-quality boards (e.g. "BeBee, Jooble")</p>
            <p>6. <strong>~10 jobs per page</strong> — 5 pages = ~50 jobs per query</p>
          </CollapsibleContent>
        </Collapsible>

        {/* ── JOB ROLES ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Job Roles</p>
          <p className="text-[10px] text-muted-foreground mb-2">Select roles — synonyms become search queries across Google for Jobs aggregated boards</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Job Family</Label>
              <Select value={gSelectedFamily} onValueChange={setGSelectedFamily}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Families</SelectItem>
                  {JOB_FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Search Roles</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={gRoleSearch} onChange={e => setGRoleSearch(e.target.value)} placeholder="Filter roles..." className="text-sm h-9 pl-8" />
              </div>
            </div>
          </div>
          <ScrollArea className="h-36 rounded-md border p-2 mt-2">
            {gFilteredRoles.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">{gRolesLoading ? "Loading roles..." : "No roles match"}</p>
            ) : (
              <div className="space-y-1">
                {gFilteredRoles.map(role => (
                  <label key={role.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={gSelectedRoleIds.includes(role.id)} onCheckedChange={() => gToggleRole(role.id)} />
                    <span className="text-xs">{role.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{role.family}</span>
                  </label>
                ))}
              </div>
            )}
          </ScrollArea>
          {gSelectedRoles.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Selected ({gSelectedRoles.length})</Label>
                <button type="button" onClick={() => setGSelectedRoleIds([])} className="text-[10px] text-muted-foreground hover:text-foreground">Clear</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {gSelectedRoles.map(r => (
                  <Badge key={r.id} variant="secondary" className="text-[10px] pr-1">
                    {r.name}
                    <button onClick={() => gToggleRole(r.id)} className="ml-1 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {gAllSynonyms.length > 0 && (
            <div className="mt-2">
              <Label className="text-xs mb-1 block">Search terms ({gAllSynonyms.length})</Label>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto rounded-md border p-2 bg-muted/30">
                {gAllSynonyms.map((s, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-background border text-[10px] text-muted-foreground">{s}</span>)}
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* ── SEARCH ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Search</p>
          <p className="text-[10px] text-muted-foreground mb-2">Free-text query — used if no roles selected, or added alongside role queries</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Query {gSelectedRoleIds.length === 0 ? "*" : "(optional)"}</Label>
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. Data Analyst" className="text-sm h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
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

        {/* ── FILTERS ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Filters</p>
          <p className="text-[10px] text-muted-foreground mb-2">Google Jobs native filters — applied via Apify scraper</p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-1.5 block">Employment Type</Label>
              <ChipSelect options={GOOGLE_EMP_TYPES} selected={empTypes} onChange={setEmpTypes} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Experience</Label>
                <Select value={jobReqs} onValueChange={setJobReqs}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
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
                <Input value={employer} onChange={e => setEmployer(e.target.value)} placeholder="e.g. Amazon" className="text-sm h-9 mt-1" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Remote jobs only</Label>
                <p className="text-[10px] text-muted-foreground">Show only remote/work-from-home positions</p>
              </div>
              <Switch checked={remoteOnly} onCheckedChange={setRemoteOnly} />
            </div>
          </div>
        </div>

        <Separator />

        {/* ── TIME & OPTIONS ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Time & Options</p>
          <p className="text-[10px] text-muted-foreground mb-2">Control recency and result volume</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date Posted</Label>
              <Select value={datePosted} onValueChange={setDatePosted}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
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
              <Input type="number" value={numPages} onChange={e => setNumPages(e.target.value)} min={1} max={10} className="text-sm h-9 mt-1" />
              <p className="text-[10px] text-muted-foreground mt-0.5">~10 jobs/page • max 10 pages</p>
            </div>
          </div>
          <div className="mt-3">
            <Label className="text-xs">Exclude Publishers</Label>
            <Input value={excludePublishers} onChange={e => setExcludePublishers(e.target.value)} placeholder="e.g. BeBee, Jooble" className="text-sm h-9 mt-1" />
            <p className="text-[10px] text-muted-foreground mt-0.5">Comma-separated list of job boards to exclude from results</p>
          </div>
        </div>

        <Separator />

        {/* ── SCHEDULE ─── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Save this configuration as a recurring pipeline</p>
            </div>
            <Switch checked={gScheduleMode} onCheckedChange={setGScheduleMode} />
          </div>
          {gScheduleMode && (
            <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Frequency</Label>
                  <Select value={gFrequency} onValueChange={setGFrequency}>
                    <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Schedule Name</Label>
                  <Input value={gScheduleName} onChange={e => setGScheduleName(e.target.value)} placeholder={gAutoScheduleName} className="text-sm h-9 mt-1" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── ACTIONS ─── */}
        <div className="flex gap-3 pt-1">
          <Button onClick={() => run.mutate()} disabled={run.isPending || (!query.trim() && gSelectedRoleIds.length === 0)} className="flex-1 h-10">
            {run.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run Google Jobs Search
          </Button>
          {gScheduleMode && (
            <Button onClick={() => gSaveSchedule.mutate()} disabled={gSaveSchedule.isPending} variant="outline" className="flex-1 h-10">
              {gSaveSchedule.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Save Schedule
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── ME_COUNTRIES constant ────────────────────────────────────────────────────

const ME_COUNTRIES_BAYT = [
  { value: "UAE", label: "UAE" },
  { value: "Saudi Arabia", label: "Saudi Arabia" },
  { value: "Kuwait", label: "Kuwait" },
  { value: "Qatar", label: "Qatar" },
  { value: "Bahrain", label: "Bahrain" },
  { value: "Oman", label: "Oman" },
  { value: "Egypt", label: "Egypt" },
  { value: "Jordan", label: "Jordan" },
  { value: "Lebanon", label: "Lebanon" },
];

const ME_COUNTRIES_NG = [
  { value: "UAE", label: "UAE" },
  { value: "Saudi Arabia", label: "Saudi Arabia" },
  { value: "Kuwait", label: "Kuwait" },
  { value: "Qatar", label: "Qatar" },
  { value: "Bahrain", label: "Bahrain" },
  { value: "Oman", label: "Oman" },
];

// ── Bayt.com Form ─────────────────────────────────────────────────────────────

function BaytForm() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: allRoles = [], isLoading: rolesLoading } = useQuery<JobRole[]>({
    queryKey: ["/api/masters/job-roles"],
    staleTime: 5 * 60 * 1000,
  });
  const [selectedFamily, setSelectedFamily] = useState<string>("all");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleSearch, setRoleSearch] = useState("");

  const filteredRoles = allRoles.filter(r => {
    if (selectedFamily !== "all" && r.family !== selectedFamily) return false;
    if (roleSearch && !r.name.toLowerCase().includes(roleSearch.toLowerCase())) return false;
    return true;
  });
  const selectedRoles = allRoles.filter(r => selectedRoleIds.includes(r.id));
  const toggleRole = (id: string) => setSelectedRoleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const [keywords, setKeywords] = useState("");
  const [country, setCountry] = useState("UAE");
  const [daysOld, setDaysOld] = useState("7");
  const [limit, setLimit] = useState(200);
  const [incremental, setIncremental] = useState(true);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [frequency, setFrequency] = useState("daily");
  const [scheduleName, setScheduleName] = useState("");

  const buildConfig = () => ({
    search_keywords: keywords || undefined,
    job_role_ids: selectedRoleIds.length > 0 ? selectedRoleIds : undefined,
    country,
    days_old: parseInt(daysOld) || 7,
    limit,
    incremental,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST",
        body: JSON.stringify({ pipeline_type: "bayt_jobs", config: buildConfig() }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Bayt.com collection started" }); qc.invalidateQueries({ queryKey: ["/api/pipelines"] }); },
    onError: (e: any) => toast({ title: "Failed to start", description: e.message, variant: "destructive" }),
  });

  const autoScheduleName = `${frequency === "daily" ? "Daily" : "Weekly"} Bayt ${country}`;
  const saveSchedule = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/scheduler/schedules", {
        method: "POST",
        body: JSON.stringify({
          name: scheduleName || autoScheduleName,
          pipeline_type: "bayt_jobs",
          config: buildConfig(),
          frequency,
          cron_expression: frequency === "daily" ? "0 0 * * *" : "0 0 * * 1",
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => toast({ title: "Bayt schedule saved" }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-orange-500" /> Bayt.com — Middle East Jobs
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">$0.001/job · UAE/KSA/GCC</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Info className="h-3 w-3" /> How to use <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-lg p-3">
            <p>1. <strong>Bayt.com</strong> is the #1 job board in MENA — UAE, Saudi, Kuwait, Qatar, Bahrain, Oman, Egypt</p>
            <p>2. <strong>Select Job Roles</strong> — synonyms become keyword OR-queries, one Apify run per role</p>
            <p>3. <strong>Incremental mode ON</strong> — subsequent runs only fetch new/changed listings (saves cost)</p>
            <p>4. <strong>Full descriptions included</strong> — salary, skills[], career level, company size all structured</p>
            <p>5. <strong>Salary in AED/SAR</strong> — already numeric min/max in the actor output, flows to JD Analyzer</p>
          </CollapsibleContent>
        </Collapsible>

        {/* ── JOB ROLES ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Job Roles</p>
          <p className="text-[10px] text-muted-foreground mb-2">Select roles — synonyms become Bayt.com search queries</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Job Family</Label>
              <Select value={selectedFamily} onValueChange={setSelectedFamily}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Families</SelectItem>
                  {JOB_FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Search Roles</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={roleSearch} onChange={e => setRoleSearch(e.target.value)} placeholder="Filter roles..." className="text-sm h-9 pl-8" />
              </div>
            </div>
          </div>
          <ScrollArea className="h-36 rounded-md border p-2 mt-2">
            {filteredRoles.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">{rolesLoading ? "Loading roles..." : "No roles match"}</p>
            ) : (
              <div className="space-y-1">
                {filteredRoles.map(role => (
                  <label key={role.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={selectedRoleIds.includes(role.id)} onCheckedChange={() => toggleRole(role.id)} />
                    <span className="text-xs">{role.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{role.family}</span>
                  </label>
                ))}
              </div>
            )}
          </ScrollArea>
          {selectedRoles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedRoles.map(r => (
                <Badge key={r.id} variant="secondary" className="text-[10px] pr-1">
                  {r.name}
                  <button onClick={() => toggleRole(r.id)} className="ml-1 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* ── SEARCH ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Search</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Keywords {selectedRoleIds.length === 0 ? "*" : "(optional)"}</Label>
              <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="e.g. Product Manager" className="text-sm h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Country *</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ME_COUNTRIES_BAYT.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* ── OPTIONS ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Options</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Max Jobs</Label>
                <Select value={String(limit)} onValueChange={v => setLimit(parseInt(v))}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[100, 200, 500, 1000].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Posted Within (days)</Label>
                <Select value={daysOld} onValueChange={setDaysOld}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="0">All time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Incremental mode</Label>
                <p className="text-[10px] text-muted-foreground">Skip jobs already seen — saves cost on recurring runs</p>
              </div>
              <Switch checked={incremental} onCheckedChange={setIncremental} />
            </div>
          </div>
        </div>

        <Separator />

        {/* ── SCHEDULE ─── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Save as a recurring pipeline run</p>
            </div>
            <Switch checked={scheduleMode} onCheckedChange={setScheduleMode} />
          </div>
          {scheduleMode && (
            <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Schedule Name</Label>
                  <Input value={scheduleName} onChange={e => setScheduleName(e.target.value)} placeholder={autoScheduleName} className="text-sm h-9 mt-1" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <Button onClick={() => runNow.mutate()} disabled={runNow.isPending || (!keywords.trim() && selectedRoleIds.length === 0)} className="flex-1 h-10">
            {runNow.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run Now
          </Button>
          {scheduleMode && (
            <Button onClick={() => saveSchedule.mutate()} disabled={saveSchedule.isPending} variant="outline" className="flex-1 h-10">
              {saveSchedule.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Save Schedule
            </Button>
          )}
        </div>

        <div className="rounded-md bg-muted/50 p-2.5 text-[10px] text-muted-foreground">
          <span className="font-medium">Estimated cost:</span> {limit} jobs × $0.001 = <span className="font-semibold text-foreground">${(limit * 0.001).toFixed(2)}</span> · Incremental runs ~$0.02–0.07 after baseline
        </div>
      </CardContent>
    </Card>
  );
}

// ── NaukriGulf Form ───────────────────────────────────────────────────────────

function NaukriGulfForm() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: allRoles = [], isLoading: rolesLoading } = useQuery<JobRole[]>({
    queryKey: ["/api/masters/job-roles"],
    staleTime: 5 * 60 * 1000,
  });
  const [selectedFamily, setSelectedFamily] = useState<string>("all");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleSearch, setRoleSearch] = useState("");

  const filteredRoles = allRoles.filter(r => {
    if (selectedFamily !== "all" && r.family !== selectedFamily) return false;
    if (roleSearch && !r.name.toLowerCase().includes(roleSearch.toLowerCase())) return false;
    return true;
  });
  const selectedRoles = allRoles.filter(r => selectedRoleIds.includes(r.id));
  const toggleRole = (id: string) => setSelectedRoleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("UAE");
  const [limit, setLimit] = useState(200);
  const [incremental, setIncremental] = useState(true);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [frequency, setFrequency] = useState("daily");
  const [scheduleName, setScheduleName] = useState("");

  const buildConfig = () => ({
    search_keywords: keywords || undefined,
    job_role_ids: selectedRoleIds.length > 0 ? selectedRoleIds : undefined,
    location,
    limit,
    incremental,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST",
        body: JSON.stringify({ pipeline_type: "naukrigulf_jobs", config: buildConfig() }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "NaukriGulf collection started" }); qc.invalidateQueries({ queryKey: ["/api/pipelines"] }); },
    onError: (e: any) => toast({ title: "Failed to start", description: e.message, variant: "destructive" }),
  });

  const autoScheduleName = `${frequency === "daily" ? "Daily" : "Weekly"} NaukriGulf ${location}`;
  const saveSchedule = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/scheduler/schedules", {
        method: "POST",
        body: JSON.stringify({
          name: scheduleName || autoScheduleName,
          pipeline_type: "naukrigulf_jobs",
          config: buildConfig(),
          frequency,
          cron_expression: frequency === "daily" ? "0 0 * * *" : "0 0 * * 1",
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => toast({ title: "NaukriGulf schedule saved" }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-blue-500" /> NaukriGulf — GCC Jobs
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">$0.001/job · UAE/KSA/Qatar/Kuwait</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Info className="h-3 w-3" /> How to use <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-lg p-3">
            <p>1. <strong>NaukriGulf</strong> is the highest-volume board for GCC professionals (IT, Banking, Construction, Hospitality)</p>
            <p>2. <strong>Complementary to Bayt</strong> — different employer pool, strong mid-career coverage</p>
            <p>3. <strong>Bonus fields</strong>: recruiter contact name, desiredCandidate section, experience min/max structured</p>
            <p>4. <strong>Incremental mode</strong> — only new/changed jobs after first baseline run</p>
            <p>5. Covers UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman</p>
          </CollapsibleContent>
        </Collapsible>

        {/* ── JOB ROLES ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Job Roles</p>
          <p className="text-[10px] text-muted-foreground mb-2">Select roles — synonyms become NaukriGulf search queries</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Job Family</Label>
              <Select value={selectedFamily} onValueChange={setSelectedFamily}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Families</SelectItem>
                  {JOB_FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Search Roles</Label>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={roleSearch} onChange={e => setRoleSearch(e.target.value)} placeholder="Filter roles..." className="text-sm h-9 pl-8" />
              </div>
            </div>
          </div>
          <ScrollArea className="h-36 rounded-md border p-2 mt-2">
            {filteredRoles.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">{rolesLoading ? "Loading roles..." : "No roles match"}</p>
            ) : (
              <div className="space-y-1">
                {filteredRoles.map(role => (
                  <label key={role.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={selectedRoleIds.includes(role.id)} onCheckedChange={() => toggleRole(role.id)} />
                    <span className="text-xs">{role.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{role.family}</span>
                  </label>
                ))}
              </div>
            )}
          </ScrollArea>
          {selectedRoles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedRoles.map(r => (
                <Badge key={r.id} variant="secondary" className="text-[10px] pr-1">
                  {r.name}
                  <button onClick={() => toggleRole(r.id)} className="ml-1 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* ── SEARCH ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Search</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Keywords {selectedRoleIds.length === 0 ? "*" : "(optional)"}</Label>
              <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="e.g. Finance Manager" className="text-sm h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Location *</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ME_COUNTRIES_NG.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* ── OPTIONS ─── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Options</p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Max Jobs</Label>
              <Select value={String(limit)} onValueChange={v => setLimit(parseInt(v))}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[100, 200, 500, 1000].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Incremental mode</Label>
                <p className="text-[10px] text-muted-foreground">Skip jobs already seen in previous runs</p>
              </div>
              <Switch checked={incremental} onCheckedChange={setIncremental} />
            </div>
          </div>
        </div>

        <Separator />

        {/* ── SCHEDULE ─── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Save as a recurring pipeline run</p>
            </div>
            <Switch checked={scheduleMode} onCheckedChange={setScheduleMode} />
          </div>
          {scheduleMode && (
            <div className="space-y-2 rounded-lg border p-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Schedule Name</Label>
                  <Input value={scheduleName} onChange={e => setScheduleName(e.target.value)} placeholder={autoScheduleName} className="text-sm h-9 mt-1" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <Button onClick={() => runNow.mutate()} disabled={runNow.isPending || (!keywords.trim() && selectedRoleIds.length === 0)} className="flex-1 h-10">
            {runNow.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run Now
          </Button>
          {scheduleMode && (
            <Button onClick={() => saveSchedule.mutate()} disabled={saveSchedule.isPending} variant="outline" className="flex-1 h-10">
              {saveSchedule.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Save Schedule
            </Button>
          )}
        </div>

        <div className="rounded-md bg-muted/50 p-2.5 text-[10px] text-muted-foreground">
          <span className="font-medium">Estimated cost:</span> {limit} jobs × $0.001 = <span className="font-semibold text-foreground">${(limit * 0.001).toFixed(2)}</span> · Incremental runs ~$0.02–0.07 after baseline
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page layout ──────────────────────────────────────────────────────────────

export default function JobCollection() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/pipelines"><a className="text-xs text-muted-foreground hover:text-foreground">← Pipelines</a></Link>
        <h1 className="text-2xl font-bold mt-1">Job Collection</h1>
        <p className="text-sm text-muted-foreground">Configure and run job scrapers — LinkedIn, Google, Bayt.com, NaukriGulf</p>
      </div>

      {/* India + Global */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">India & Global</h2>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <LinkedInForm />
          <GoogleJobsForm />
        </div>
      </div>

      {/* Middle East */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Middle East (MENA)</h2>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <BaytForm />
          <NaukriGulfForm />
        </div>
      </div>

      <RunHistory pipelineTypes={["linkedin_jobs", "google_jobs", "bayt_jobs", "naukrigulf_jobs"]} title="Job Collection Runs" />
    </div>
  );
}
