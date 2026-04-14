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
import { Play, Loader2, CalendarClock, Link2, Globe, X, Search } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { RunHistory } from "./run-history";

const authFetch = async (url: string, opts: RequestInit = {}) => {
  const { data: { session } } = await (window as any).__supabase?.auth?.getSession?.() || { data: { session: null } };
  const headers: any = { ...opts.headers };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  if (!headers["Content-Type"] && opts.body && typeof opts.body === "string") headers["Content-Type"] = "application/json";
  return fetch(url, { ...opts, headers });
};

// ── Preset data ──────────────────────────────────────────────────────────────

const LOCATIONS = [
  { group: "India — Metros", items: ["Mumbai", "Delhi-NCR", "Bangalore", "Hyderabad", "Chennai", "Pune", "Kolkata", "Ahmedabad"] },
  { group: "India — Tier 2", items: ["Jaipur", "Lucknow", "Chandigarh", "Kochi", "Indore", "Nagpur", "Coimbatore", "Gurgaon", "Noida"] },
  { group: "International", items: ["Dubai, UAE", "Singapore", "London, UK", "New York, US", "Remote"] },
  { group: "Broad", items: ["India", "United Arab Emirates", "United States", "United Kingdom"] },
];

const EXP_LEVELS = [
  { value: "1", label: "Internship" }, { value: "2", label: "Entry" }, { value: "3", label: "Associate" },
  { value: "4", label: "Mid-Senior" }, { value: "5", label: "Director" }, { value: "6", label: "Executive" },
];

const WORK_TYPES = [
  { value: "1", label: "Full-time" }, { value: "2", label: "Part-time" },
  { value: "3", label: "Contract" }, { value: "4", label: "Temporary" }, { value: "6", label: "Internship" },
];

const WORK_LOCATIONS = [
  { value: "1", label: "On-site" }, { value: "2", label: "Remote" }, { value: "3", label: "Hybrid" },
];

const INDUSTRIES = [
  { value: "96", label: "IT Services" }, { value: "6", label: "Internet / Tech" },
  { value: "4", label: "Software Products" }, { value: "43", label: "Financial Services" },
  { value: "41", label: "Banking" }, { value: "11", label: "Management Consulting" },
  { value: "34", label: "FMCG" }, { value: "27", label: "Consumer Electronics" },
  { value: "26", label: "Automotive" }, { value: "14", label: "Healthcare" },
  { value: "69", label: "Education" }, { value: "44", label: "Real Estate" },
  { value: "8", label: "Telecom" }, { value: "86", label: "Media & Entertainment" },
  { value: "75", label: "Government" }, { value: "91", label: "Non-Profit" },
  { value: "48", label: "Insurance" }, { value: "1", label: "Retail" },
  { value: "12", label: "Pharma" }, { value: "53", label: "E-Commerce" },
];

const TIME_OPTIONS = [
  { value: "r3600", label: "Past Hour" }, { value: "r86400", label: "Past 24 Hours" },
  { value: "r604800", label: "Past Week" }, { value: "r2592000", label: "Past Month" }, { value: "", label: "Any Time" },
];

const LIMIT_PRESETS = [50, 100, 250, 500, 1000];

const FREQUENCIES = [
  { value: "daily", label: "Daily (once)" }, { value: "twice_daily", label: "Twice Daily" },
  { value: "weekly", label: "Weekly" }, { value: "hourly", label: "Every Hour" },
];

// ── Chip toggle component ────────────────────────────────────────────────────

function ChipSelect({ options, selected, onChange }: {
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

// ── Job Role type ───────────────────────────────────────────────────────────

interface JobRole {
  id: string;
  name: string;
  family: string;
  synonyms: string[];
}

const JOB_FAMILIES = ["Management", "Technology", "Core Engineering", "Others"] as const;

// ── Main LinkedIn form ───────────────────────────────────────────────────────

function LinkedInForm() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Job Roles taxonomy
  const { data: taxonomyData } = useQuery<{ families: Record<string, JobRole[]>; total: number }>({
    queryKey: ["/api/taxonomy/job-roles"],
    queryFn: async () => {
      const res = await authFetch("/api/taxonomy/job-roles");
      if (!res.ok) throw new Error("Failed to fetch job roles");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const [selectedFamily, setSelectedFamily] = useState<string>("all");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [roleSearch, setRoleSearch] = useState("");

  const allRoles: JobRole[] = taxonomyData
    ? Object.values(taxonomyData.families).flat()
    : [];

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
  const [customLoc, setCustomLoc] = useState("");

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

  const effectiveLocation = location === "__custom" ? customLoc : location;
  const autoScheduleName = `${frequency === "daily" ? "Daily" : frequency === "weekly" ? "Weekly" : "Recurring"} ${keywords} in ${effectiveLocation}`;

  const buildConfig = () => ({
    search_keywords: keywords || undefined,
    job_role_ids: selectedRoleIds.length > 0 ? selectedRoleIds : undefined,
    location: effectiveLocation,
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
    onSuccess: () => { toast({ title: "LinkedIn scraper started" }); qc.invalidateQueries({ queryKey: ["/api/pipelines/runs"] }); },
    onError: (e: any) => toast({ title: "Failed to start", description: e.message, variant: "destructive" }),
  });

  const saveSchedule = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/scheduler/schedules", {
        method: "POST", body: JSON.stringify({
          name: scheduleName || autoScheduleName,
          pipeline_type: "linkedin_jobs",
          config: buildConfig(),
          frequency: frequency === "twice_daily" ? "hourly" : frequency,
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

        {/* ── JOB ROLES ─────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Job Roles</p>
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
                  {taxonomyData ? "No roles match your filter" : "Loading roles..."}
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
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Search</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Keywords {selectedRoleIds.length === 0 ? "*" : "(optional override)"}</Label>
              <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="e.g. Data Analyst" className="text-sm h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Select value={location} onValueChange={v => { setLocation(v); if (v !== "__custom") setCustomLoc(""); }}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map(g => (
                    <div key={g.group}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">{g.group}</div>
                      {g.items.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </div>
                  ))}
                  <SelectItem value="__custom">Custom location...</SelectItem>
                </SelectContent>
              </Select>
              {location === "__custom" && (
                <Input value={customLoc} onChange={e => setCustomLoc(e.target.value)} placeholder="Type location" className="text-sm h-8 mt-1.5" />
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* ── FILTERS ──────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Filters</p>
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
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Company Filter</p>
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
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Time & Sort</p>
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
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Options</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Fetch job descriptions</Label>
                <p className="text-[10px] text-muted-foreground">+$0.001/job — recommended for JD analysis</p>
              </div>
              <Switch checked={fetchDesc} onCheckedChange={setFetchDesc} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">Easy Apply only</Label>
                <p className="text-[10px] text-muted-foreground">LinkedIn Easy Apply positions only</p>
              </div>
              <Switch checked={easyApply} onCheckedChange={setEasyApply} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Job Limit</Label>
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
  const [query, setQuery] = useState("Data Analyst in Mumbai");
  const [country, setCountry] = useState("IN");
  const [datePosted, setDatePosted] = useState("week");
  const [empTypes, setEmpTypes] = useState<string[]>(["FULLTIME"]);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [jobReqs, setJobReqs] = useState("");
  const [employer, setEmployer] = useState("");
  const [numPages, setNumPages] = useState("5");

  const run = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST", body: JSON.stringify({
          pipeline_type: "google_jobs",
          config: { queries: [query], country, date_posted: datePosted, employment_types: empTypes.join(",") || undefined, remote_only: remoteOnly || undefined, job_requirements: jobReqs || undefined, employer_name: employer || undefined, num_pages: parseInt(numPages) || 5 },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => { toast({ title: "Google Jobs search started" }); qc.invalidateQueries({ queryKey: ["/api/pipelines/runs"] }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-green-600" /> Google Jobs (JSearch)
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">Aggregates 20+ job boards</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">Search Query *</Label>
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. Data Analyst in Mumbai" className="text-sm h-9 mt-1" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="IN">India</SelectItem>
                <SelectItem value="AE">UAE</SelectItem>
                <SelectItem value="US">United States</SelectItem>
                <SelectItem value="UK">United Kingdom</SelectItem>
                <SelectItem value="SG">Singapore</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
            <Label className="text-xs">Pages</Label>
            <Input type="number" value={numPages} onChange={e => setNumPages(e.target.value)} className="text-sm h-9 mt-1" />
          </div>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Employment Type</Label>
          <ChipSelect options={[
            { value: "FULLTIME", label: "Full-time" }, { value: "PARTTIME", label: "Part-time" },
            { value: "CONTRACTOR", label: "Contract" }, { value: "INTERN", label: "Intern" },
          ]} selected={empTypes} onChange={setEmpTypes} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Experience</Label>
            <Select value={jobReqs} onValueChange={setJobReqs}>
              <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="under_3_years">Under 3 years</SelectItem>
                <SelectItem value="more_than_3_years">3+ years</SelectItem>
                <SelectItem value="no_experience">No experience</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Employer</Label>
            <Input value={employer} onChange={e => setEmployer(e.target.value)} placeholder="e.g. Amazon" className="text-sm h-9 mt-1" />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Remote jobs only</Label>
          <Switch checked={remoteOnly} onCheckedChange={setRemoteOnly} />
        </div>
        <Button onClick={() => run.mutate()} disabled={run.isPending || !query.trim()} className="w-full h-10">
          {run.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Run Google Jobs Search
        </Button>
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
        <p className="text-sm text-muted-foreground">Configure and run job scrapers with detailed filters</p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <LinkedInForm />
        <GoogleJobsForm />
      </div>
      <RunHistory pipelineTypes={["linkedin_jobs", "google_jobs"]} title="Job Collection Runs" />
    </div>
  );
}
