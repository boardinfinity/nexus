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
import { Play, Loader2, CalendarClock, Users, X, Search, Info, ChevronDown, Upload } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PipelineTrigger } from "@/components/pipeline-trigger";
import { RunHistory } from "./run-history";
import { ChipSelect } from "./job-collection";
import { authFetch } from "@/lib/queryClient";

// ── Types ────────────────────────────────────────────────────────────────────

interface College {
  id: string;
  name: string;
  short_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  degree_level: string | null;
  nirf_rank: number | null;
  ranking_source: string | null;
  ranking_year: number | null;
  ranking_score: number | null;
  tier: string | null;
  linkedin_slug: string | null;
  website: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEGREE_LEVELS = ["MBA", "Engineering", "Medical", "Law", "Pharmacy", "Arts", "Science", "Commerce"];
const TIERS = ["Top 10", "Top 25", "Top 50", "Top 100", "Unranked"];

const GRADUATION_YEARS = [
  { value: "2025", label: "2025" },
  { value: "2024", label: "2024" },
  { value: "2023", label: "2023" },
  { value: "2022", label: "2022" },
  { value: "2021", label: "2021" },
  { value: "2020", label: "2020" },
  { value: "older", label: "Older" },
];

// Maps graduation year → actor's yearsOfExperienceIds enum (1=<1yr, 2=1-2, 3=3-5, 4=6-10, 5=10+)
const GRAD_YEAR_TO_YOE: Record<string, number[]> = {
  "2025": [1],
  "2024": [2],
  "2023": [3],
  "2022": [3],
  "2021": [3, 4],
  "2020": [4],
  "older": [4, 5],
};

// Aligned with harvestapi/linkedin-profile-search enum values
const YOE_OPTIONS = [
  { value: "1", label: "<1 yr" },
  { value: "2", label: "1-2 yr" },
  { value: "3", label: "3-5 yr" },
  { value: "4", label: "6-10 yr" },
  { value: "5", label: "10+ yr" },
];

const SENIORITY_OPTIONS = [
  { value: "100", label: "In Training" },
  { value: "110", label: "Entry" },
  { value: "120", label: "Senior" },
  { value: "130", label: "Strategic" },
  { value: "200", label: "Entry Manager" },
  { value: "210", label: "Experienced Mgr" },
  { value: "220", label: "Director" },
  { value: "300", label: "VP" },
  { value: "310", label: "CXO" },
  { value: "320", label: "Owner/Partner" },
];

const FUNCTION_OPTIONS = [
  { value: "8", label: "Engineering" },
  { value: "25", label: "Sales" },
  { value: "15", label: "Marketing" },
  { value: "10", label: "Finance" },
  { value: "18", label: "Operations" },
  { value: "19", label: "Product Mgmt" },
  { value: "13", label: "IT" },
  { value: "6", label: "Consulting" },
  { value: "12", label: "HR" },
  { value: "4", label: "Business Dev" },
  { value: "26", label: "Customer Success" },
  { value: "1", label: "Accounting" },
  { value: "14", label: "Legal" },
  { value: "24", label: "Research" },
  { value: "20", label: "Project Mgmt" },
  { value: "9", label: "Entrepreneurship" },
  { value: "3", label: "Arts & Design" },
  { value: "11", label: "Healthcare" },
  { value: "7", label: "Education" },
  { value: "16", label: "Media & Comms" },
  { value: "23", label: "Real Estate" },
  { value: "22", label: "QA" },
  { value: "21", label: "Purchasing" },
  { value: "2", label: "Administrative" },
  { value: "5", label: "Community Services" },
  { value: "17", label: "Military/Protective" },
];

const HEADCOUNT_OPTIONS = [
  { value: "A", label: "Self-Employed" },
  { value: "B", label: "1-10" },
  { value: "C", label: "11-50" },
  { value: "D", label: "51-200" },
  { value: "E", label: "201-500" },
  { value: "F", label: "501-1K" },
  { value: "G", label: "1K-5K" },
  { value: "H", label: "5K-10K" },
  { value: "I", label: "10K+" },
];

const SCRAPER_MODES = [
  { value: "Short", label: "Short", desc: "Basic data ($0.10/page)" },
  { value: "Full", label: "Full", desc: "All details (+$0.004/profile)" },
  { value: "Full + email search", label: "Full + Email Search", desc: "+$0.01/profile" },
];

const FREQUENCIES = [
  { value: "daily", label: "Daily (once)" },
  { value: "twice_daily", label: "Twice Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "hourly", label: "Every Hour" },
];

// ── Alumni Search Form ───────────────────────────────────────────────────────

function AlumniSearchForm() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // ── Colleges from master list ──
  const { data: allColleges = [], isLoading: collegesLoading, error: collegesError } = useQuery<College[]>({
    queryKey: ["/api/masters/colleges"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/colleges");
      if (!res.ok) throw new Error(`Failed to fetch colleges: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [filterDegree, setFilterDegree] = useState<string>("all");
  const [filterTier, setFilterTier] = useState<string>("all");
  const [collegeSearch, setCollegeSearch] = useState("");
  const [selectedCollegeIds, setSelectedCollegeIds] = useState<string[]>([]);

  const countries = Array.from(new Set(allColleges.map(c => c.country).filter(Boolean))) as string[];

  const filteredColleges = allColleges.filter(c => {
    if (filterCountry !== "all" && c.country !== filterCountry) return false;
    if (filterDegree !== "all" && c.degree_level !== filterDegree) return false;
    if (filterTier !== "all" && c.tier !== filterTier) return false;
    if (collegeSearch && !c.name.toLowerCase().includes(collegeSearch.toLowerCase())) return false;
    return true;
  });

  const selectedColleges = allColleges.filter(c => selectedCollegeIds.includes(c.id));

  const toggleCollege = (id: string) => {
    setSelectedCollegeIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // ── Target Profiles ──
  const [currentTitleInput, setCurrentTitleInput] = useState("");
  const [currentTitles, setCurrentTitles] = useState<string[]>([]);
  const [pastTitleInput, setPastTitleInput] = useState("");
  const [pastTitles, setPastTitles] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const addCurrentTitle = () => {
    const t = currentTitleInput.trim();
    if (t && !currentTitles.includes(t)) setCurrentTitles([...currentTitles, t]);
    setCurrentTitleInput("");
  };
  const addPastTitle = () => {
    const t = pastTitleInput.trim();
    if (t && !pastTitles.includes(t)) setPastTitles([...pastTitles, t]);
    setPastTitleInput("");
  };

  // ── Filters ──
  const [locationInput, setLocationInput] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [gradYear, setGradYear] = useState("");
  const [yearsOfExperience, setYearsOfExperience] = useState<string[]>([]);
  const [seniority, setSeniority] = useState<string[]>([]);
  const [functions, setFunctions] = useState<string[]>([]);
  const [currentCompanyInput, setCurrentCompanyInput] = useState("");
  const [currentCompanies, setCurrentCompanies] = useState<string[]>([]);
  const [pastCompanyInput, setPastCompanyInput] = useState("");
  const [pastCompanies, setPastCompanies] = useState<string[]>([]);
  const [headcount, setHeadcount] = useState<string[]>([]);
  const [recentlyChangedJobs, setRecentlyChangedJobs] = useState(false);
  const [industryInput, setIndustryInput] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [firstNameInput, setFirstNameInput] = useState("");
  const [firstNames, setFirstNames] = useState<string[]>([]);
  const [lastNameInput, setLastNameInput] = useState("");
  const [lastNames, setLastNames] = useState<string[]>([]);

  // ── Exclusions ──
  const [excludeLocationInput, setExcludeLocationInput] = useState("");
  const [excludeLocations, setExcludeLocations] = useState<string[]>([]);
  const [excludeCurrentCompanyInput, setExcludeCurrentCompanyInput] = useState("");
  const [excludeCurrentCompanies, setExcludeCurrentCompanies] = useState<string[]>([]);
  const [excludeSchoolInput, setExcludeSchoolInput] = useState("");
  const [excludeSchools, setExcludeSchools] = useState<string[]>([]);

  const addLocation = () => {
    const l = locationInput.trim();
    if (l && !locations.includes(l)) setLocations([...locations, l]);
    setLocationInput("");
  };
  const addCurrentCompany = () => {
    const c = currentCompanyInput.trim();
    if (c && !currentCompanies.includes(c)) setCurrentCompanies([...currentCompanies, c]);
    setCurrentCompanyInput("");
  };
  const addPastCompany = () => {
    const c = pastCompanyInput.trim();
    if (c && !pastCompanies.includes(c)) setPastCompanies([...pastCompanies, c]);
    setPastCompanyInput("");
  };
  const addExcludeLocation = () => {
    const l = excludeLocationInput.trim();
    if (l && !excludeLocations.includes(l)) setExcludeLocations([...excludeLocations, l]);
    setExcludeLocationInput("");
  };
  const addExcludeCurrentCompany = () => {
    const c = excludeCurrentCompanyInput.trim();
    if (c && !excludeCurrentCompanies.includes(c)) setExcludeCurrentCompanies([...excludeCurrentCompanies, c]);
    setExcludeCurrentCompanyInput("");
  };
  const addExcludeSchool = () => {
    const s = excludeSchoolInput.trim();
    if (s && !excludeSchools.includes(s)) setExcludeSchools([...excludeSchools, s]);
    setExcludeSchoolInput("");
  };
  const addIndustry = () => {
    const i = industryInput.trim();
    if (i && !industries.includes(i)) setIndustries([...industries, i]);
    setIndustryInput("");
  };
  const addFirstName = () => {
    const n = firstNameInput.trim();
    if (n && !firstNames.includes(n)) setFirstNames([...firstNames, n]);
    setFirstNameInput("");
  };
  const addLastName = () => {
    const n = lastNameInput.trim();
    if (n && !lastNames.includes(n)) setLastNames([...lastNames, n]);
    setLastNameInput("");
  };

  // When grad year changes, auto-set YOE
  const handleGradYearChange = (val: string) => {
    setGradYear(val);
    if (val && val !== "none") {
      const mapped = GRAD_YEAR_TO_YOE[val];
      if (mapped) setYearsOfExperience(mapped.map(String));
    } else {
      setYearsOfExperience([]);
    }
  };

  const yoeDisabled = gradYear !== "" && gradYear !== "none";

  // YoE values are enum IDs now (1-5), passed through as-is

  // ── Options ──
  const [scraperMode, setScraperMode] = useState("Full");
  const [pages, setPages] = useState(5);
  const [maxProfiles, setMaxProfiles] = useState(0);

  // ── Schedule ──
  const [scheduleMode, setScheduleMode] = useState(false);
  const [frequency, setFrequency] = useState("daily");
  const [scheduleName, setScheduleName] = useState("");

  const autoScheduleName = `${frequency === "daily" ? "Daily" : frequency === "weekly" ? "Weekly" : "Recurring"} Alumni Search`;

  // ── Cost estimate ──
  const estProfiles = pages * 25;
  const perProfileCost = scraperMode === "Full + email search" ? 0.01 : scraperMode === "Full" ? 0.004 : 0;
  const estCost = pages * 0.10 + estProfiles * perProfileCost;

  // ── Build config ──
  const buildConfig = () => ({
    college_ids: selectedCollegeIds.length > 0 ? selectedCollegeIds : undefined,
    current_job_titles: currentTitles.length > 0 ? currentTitles : undefined,
    past_job_titles: pastTitles.length > 0 ? pastTitles : undefined,
    search_query: searchQuery || undefined,
    locations: locations.length > 0 ? locations : undefined,
    graduation_year: gradYear && gradYear !== "none" ? gradYear : undefined,
    years_of_experience_ids: yearsOfExperience.length > 0 ? yearsOfExperience.map(Number) : undefined,
    seniority_level_ids: seniority.length > 0 ? seniority.map(Number) : undefined,
    function_ids: functions.length > 0 ? functions.map(Number) : undefined,
    current_companies: currentCompanies.length > 0 ? currentCompanies : undefined,
    past_companies: pastCompanies.length > 0 ? pastCompanies : undefined,
    company_headcount: headcount.length > 0 ? headcount : undefined,
    recently_changed_jobs: recentlyChangedJobs || undefined,
    industry_ids: industries.length > 0 ? industries : undefined,
    first_names: firstNames.length > 0 ? firstNames : undefined,
    last_names: lastNames.length > 0 ? lastNames : undefined,
    exclude_locations: excludeLocations.length > 0 ? excludeLocations : undefined,
    exclude_current_companies: excludeCurrentCompanies.length > 0 ? excludeCurrentCompanies : undefined,
    exclude_schools: excludeSchools.length > 0 ? excludeSchools : undefined,
    scraper_mode: scraperMode,
    pages,
    max_profiles: maxProfiles,
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST",
        body: JSON.stringify({ pipeline_type: "alumni", config: buildConfig() }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alumni search started" });
      qc.invalidateQueries({ queryKey: ["/api/pipelines"] });
    },
    onError: (e: any) => toast({ title: "Failed to start", description: e.message, variant: "destructive" }),
  });

  const saveSchedule = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/scheduler/schedules", {
        method: "POST",
        body: JSON.stringify({
          name: scheduleName || autoScheduleName,
          pipeline_type: "alumni",
          config: buildConfig(),
          frequency,
          cron_expression: frequency === "daily" ? "0 0 * * *" : frequency === "twice_daily" ? "0 0,12 * * *" : frequency === "weekly" ? "0 0 * * 1" : "0 * * * *",
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => toast({ title: "Schedule saved", description: "Will run automatically based on frequency" }),
    onError: (e: any) => toast({ title: "Failed to save schedule", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-600" /> Alumni Search
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">$0.10/page via Apify</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Info className="h-3 w-3" /> How to use
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-lg p-3">
            <p>1. <strong>Select colleges</strong> from the master list — each college's LinkedIn slug is used for the search</p>
            <p>2. <strong>Set target profiles</strong> — current/past job titles and search query narrow results</p>
            <p>3. <strong>Apply filters</strong> — location, graduation year, seniority, and company refine the search</p>
            <p>4. <strong>Each page = up to 25 profiles</strong> — 5 pages default = ~125 profiles per college</p>
            <p>5. <strong>Full mode</strong> fetches detailed profile data; Short is basic info only</p>
            <p>6. <strong>Schedule</strong> for recurring alumni collection</p>
          </CollapsibleContent>
        </Collapsible>

        {/* ── COLLEGES ─────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Colleges</p>
          <p className="text-[10px] text-muted-foreground mb-2">Select colleges from the master list — LinkedIn slugs are used as school URLs</p>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Country</Label>
                <Select value={filterCountry} onValueChange={setFilterCountry}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Countries</SelectItem>
                    {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Degree Level</Label>
                <Select value={filterDegree} onValueChange={setFilterDegree}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    {DEGREE_LEVELS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tier</Label>
                <Select value={filterTier} onValueChange={setFilterTier}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tiers</SelectItem>
                    {TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={collegeSearch} onChange={e => setCollegeSearch(e.target.value)}
                placeholder="Search colleges..." className="text-sm h-9 pl-8" />
            </div>
            <ScrollArea className="h-40 rounded-md border p-2">
              {filteredColleges.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  {collegesError ? `Error: ${(collegesError as Error).message}` : collegesLoading ? "Loading colleges..." : "No colleges match your filter"}
                </p>
              ) : (
                <div className="space-y-1">
                  {filteredColleges.map(college => (
                    <label key={college.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer">
                      <Checkbox
                        checked={selectedCollegeIds.includes(college.id)}
                        onCheckedChange={() => toggleCollege(college.id)}
                      />
                      <span className="text-xs">{college.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {[college.degree_level, college.tier, college.city].filter(Boolean).join(" · ")}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
            {selectedColleges.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs">Selected ({selectedColleges.length})</Label>
                  <button type="button" onClick={() => setSelectedCollegeIds([])} className="text-[10px] text-muted-foreground hover:text-foreground">Clear all</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedColleges.map(c => (
                    <Badge key={c.id} variant="secondary" className="text-[10px] pr-1">
                      {c.short_name || c.name}
                      <button onClick={() => toggleCollege(c.id)} className="ml-1 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* ── TARGET PROFILES ─────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Target Profiles</p>
          <p className="text-[10px] text-muted-foreground mb-2">Narrow alumni search by job titles and search keywords</p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Current Job Titles</Label>
              <div className="flex gap-2 mt-1">
                <Input value={currentTitleInput} onChange={e => setCurrentTitleInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCurrentTitle())}
                  placeholder="e.g. Product Manager + Enter" className="text-sm h-9 flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={addCurrentTitle} className="h-9 px-3 text-xs">Add</Button>
              </div>
              {currentTitles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {currentTitles.map(t => (
                    <Badge key={t} variant="secondary" className="text-xs pr-1">
                      {t}
                      <button onClick={() => setCurrentTitles(currentTitles.filter(x => x !== t))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Past Job Titles</Label>
              <div className="flex gap-2 mt-1">
                <Input value={pastTitleInput} onChange={e => setPastTitleInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addPastTitle())}
                  placeholder="e.g. Analyst + Enter" className="text-sm h-9 flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={addPastTitle} className="h-9 px-3 text-xs">Add</Button>
              </div>
              {pastTitles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {pastTitles.map(t => (
                    <Badge key={t} variant="secondary" className="text-xs pr-1">
                      {t}
                      <button onClick={() => setPastTitles(pastTitles.filter(x => x !== t))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Search Query (optional)</Label>
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Free text — supports LinkedIn operators" className="text-sm h-9 mt-1" />
            </div>
          </div>
        </div>

        <Separator />

        {/* ── FILTERS ─────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Filters</p>
          <p className="text-[10px] text-muted-foreground mb-2">Refine alumni results with location, experience, and seniority filters</p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Location</Label>
              <div className="flex gap-2 mt-1">
                <Input value={locationInput} onChange={e => setLocationInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addLocation())}
                  placeholder="e.g. Mumbai + Enter" className="text-sm h-9 flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={addLocation} className="h-9 px-3 text-xs">Add</Button>
              </div>
              {locations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {locations.map(l => (
                    <Badge key={l} variant="secondary" className="text-xs pr-1">
                      {l}
                      <button onClick={() => setLocations(locations.filter(x => x !== l))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Graduation Year (approx)</Label>
                <Select value={gradYear || "none"} onValueChange={v => handleGradYearChange(v === "none" ? "" : v)}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any</SelectItem>
                    {GRADUATION_YEARS.map(y => <SelectItem key={y.value} value={y.value}>{y.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-0.5">Auto-maps to years of experience</p>
              </div>
              <div>
                <Label className="text-xs">Years of Experience</Label>
                <div className={`mt-1 ${yoeDisabled ? "opacity-50 pointer-events-none" : ""}`}>
                  <ChipSelect options={YOE_OPTIONS} selected={yearsOfExperience} onChange={setYearsOfExperience} />
                </div>
                {yoeDisabled && <p className="text-[10px] text-muted-foreground mt-0.5">Auto-set from graduation year</p>}
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Seniority</Label>
              <ChipSelect options={SENIORITY_OPTIONS} selected={seniority} onChange={setSeniority} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Function</Label>
              <ChipSelect options={FUNCTION_OPTIONS} selected={functions} onChange={setFunctions} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Current Company</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={currentCompanyInput} onChange={e => setCurrentCompanyInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCurrentCompany())}
                    placeholder="e.g. Google + Enter" className="text-sm h-9 flex-1" />
                  <Button type="button" variant="outline" size="sm" onClick={addCurrentCompany} className="h-9 px-3 text-xs">Add</Button>
                </div>
                {currentCompanies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {currentCompanies.map(c => (
                      <Badge key={c} variant="secondary" className="text-xs pr-1">
                        {c}
                        <button onClick={() => setCurrentCompanies(currentCompanies.filter(x => x !== c))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Past Company</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={pastCompanyInput} onChange={e => setPastCompanyInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addPastCompany())}
                    placeholder="e.g. McKinsey + Enter" className="text-sm h-9 flex-1" />
                  <Button type="button" variant="outline" size="sm" onClick={addPastCompany} className="h-9 px-3 text-xs">Add</Button>
                </div>
                {pastCompanies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {pastCompanies.map(c => (
                      <Badge key={c} variant="secondary" className="text-xs pr-1">
                        {c}
                        <button onClick={() => setPastCompanies(pastCompanies.filter(x => x !== c))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Company Size</Label>
              <ChipSelect options={HEADCOUNT_OPTIONS} selected={headcount} onChange={setHeadcount} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
              <div>
                <p className="text-xs font-medium">Recently Changed Jobs</p>
                <p className="text-[10px] text-muted-foreground">Only include profiles who recently switched roles</p>
              </div>
              <Switch checked={recentlyChangedJobs} onCheckedChange={setRecentlyChangedJobs} />
            </div>
          </div>
        </div>

        <Separator />

        {/* ── ADVANCED (collapsible): Industry + Names ── */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
            <span>Advanced Filters</span>
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <div>
              <Label className="text-xs">Industry IDs</Label>
              <div className="flex gap-2 mt-1">
                <Input value={industryInput} onChange={e => setIndustryInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addIndustry())}
                  placeholder="LinkedIn industry ID (e.g. 4, 43) + Enter" className="text-sm h-9 flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={addIndustry} className="h-9 px-3 text-xs">Add</Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Common: 4=Software, 6=Internet, 43=Financial Services, 80=Consulting, 69=Higher Ed, 47=Healthcare</p>
              {industries.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {industries.map(i => (
                    <Badge key={i} variant="secondary" className="text-xs pr-1">
                      {i}
                      <button onClick={() => setIndustries(industries.filter(x => x !== i))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">First Names</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={firstNameInput} onChange={e => setFirstNameInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addFirstName())}
                    placeholder="e.g. Priya + Enter" className="text-sm h-9 flex-1" />
                  <Button type="button" variant="outline" size="sm" onClick={addFirstName} className="h-9 px-3 text-xs">Add</Button>
                </div>
                {firstNames.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {firstNames.map(n => (
                      <Badge key={n} variant="secondary" className="text-xs pr-1">
                        {n}
                        <button onClick={() => setFirstNames(firstNames.filter(x => x !== n))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs">Last Names</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={lastNameInput} onChange={e => setLastNameInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addLastName())}
                    placeholder="e.g. Sharma + Enter" className="text-sm h-9 flex-1" />
                  <Button type="button" variant="outline" size="sm" onClick={addLastName} className="h-9 px-3 text-xs">Add</Button>
                </div>
                {lastNames.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {lastNames.map(n => (
                      <Badge key={n} variant="secondary" className="text-xs pr-1">
                        {n}
                        <button onClick={() => setLastNames(lastNames.filter(x => x !== n))} className="ml-1 hover:text-destructive"><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* ── EXCLUSIONS (collapsible) ── */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
            <span>Exclusions</span>
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <p className="text-[10px] text-muted-foreground">Filter out profiles matching any of these criteria</p>
            <div>
              <Label className="text-xs">Exclude Locations</Label>
              <div className="flex gap-2 mt-1">
                <Input value={excludeLocationInput} onChange={e => setExcludeLocationInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addExcludeLocation())}
                  placeholder="e.g. USA + Enter" className="text-sm h-9 flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={addExcludeLocation} className="h-9 px-3 text-xs">Add</Button>
              </div>
              {excludeLocations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {excludeLocations.map(l => (
                    <Badge key={l} variant="destructive" className="text-xs pr-1">
                      {l}
                      <button onClick={() => setExcludeLocations(excludeLocations.filter(x => x !== l))} className="ml-1"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Exclude Current Companies</Label>
              <div className="flex gap-2 mt-1">
                <Input value={excludeCurrentCompanyInput} onChange={e => setExcludeCurrentCompanyInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addExcludeCurrentCompany())}
                  placeholder="e.g. Meta + Enter" className="text-sm h-9 flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={addExcludeCurrentCompany} className="h-9 px-3 text-xs">Add</Button>
              </div>
              {excludeCurrentCompanies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {excludeCurrentCompanies.map(c => (
                    <Badge key={c} variant="destructive" className="text-xs pr-1">
                      {c}
                      <button onClick={() => setExcludeCurrentCompanies(excludeCurrentCompanies.filter(x => x !== c))} className="ml-1"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Exclude Schools</Label>
              <div className="flex gap-2 mt-1">
                <Input value={excludeSchoolInput} onChange={e => setExcludeSchoolInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addExcludeSchool())}
                  placeholder="e.g. IIT Delhi + Enter" className="text-sm h-9 flex-1" />
                <Button type="button" variant="outline" size="sm" onClick={addExcludeSchool} className="h-9 px-3 text-xs">Add</Button>
              </div>
              {excludeSchools.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {excludeSchools.map(s => (
                    <Badge key={s} variant="destructive" className="text-xs pr-1">
                      {s}
                      <button onClick={() => setExcludeSchools(excludeSchools.filter(x => x !== s))} className="ml-1"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* ── OPTIONS ──────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Options</p>
          <p className="text-[10px] text-muted-foreground mb-2">Control scraper depth and result volume</p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Scraper Mode</Label>
              <Select value={scraperMode} onValueChange={setScraperMode}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCRAPER_MODES.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label} — {m.desc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Pages to Scrape</Label>
                <Input type="number" value={pages} onChange={e => setPages(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                  min={1} max={100} className="text-sm h-9 mt-1" />
                <p className="text-[10px] text-muted-foreground mt-0.5">Each page = up to 25 profiles</p>
              </div>
              <div>
                <Label className="text-xs">Max Profiles</Label>
                <Input type="number" value={maxProfiles} onChange={e => setMaxProfiles(Math.max(0, parseInt(e.target.value) || 0))}
                  min={0} className="text-sm h-9 mt-1" />
                <p className="text-[10px] text-muted-foreground mt-0.5">0 = unlimited</p>
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
                  <Input value={scheduleName} onChange={e => setScheduleName(e.target.value)}
                    placeholder={autoScheduleName} className="text-sm h-9 mt-1" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── ACTIONS ──────────────────────────────────────── */}
        <div className="flex gap-3 pt-1">
          <Button onClick={() => runNow.mutate()} disabled={runNow.isPending || selectedCollegeIds.length === 0}
            className="flex-1 h-10">
            {runNow.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run Alumni Search
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
          <span className="font-medium">Estimated cost:</span> {pages} pages × $0.10
          {perProfileCost > 0 && <> + ~{estProfiles} profiles × ${perProfileCost.toFixed(3)}</>}
          {" "}= <span className="font-semibold text-foreground">${estCost.toFixed(2)}</span>
          {selectedCollegeIds.length > 1 && <> × {selectedCollegeIds.length} colleges = <span className="font-semibold text-foreground">${(estCost * selectedCollegeIds.length).toFixed(2)}</span></>}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Bulk Upload Form ─────────────────────────────────────────────────────────

function BulkUploadForm() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: allColleges = [] } = useQuery<College[]>({
    queryKey: ["/api/masters/colleges"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/colleges");
      if (!res.ok) throw new Error(`Failed to fetch colleges: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const [selectedCollegeId, setSelectedCollegeId] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [collegeSearch, setCollegeSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredColleges = allColleges.filter(c =>
    !collegeSearch || c.name.toLowerCase().includes(collegeSearch.toLowerCase()) ||
    (c.short_name && c.short_name.toLowerCase().includes(collegeSearch.toLowerCase()))
  );

  const selectedCollege = allColleges.find(c => c.id === selectedCollegeId);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n")
        .map(l => l.trim().replace(/"/g, "").replace(/,$/g, ""))
        .filter(l => l.includes("linkedin.com/in/"));
      setUrls(Array.from(new Set(lines))); // Deduplicate
    };
    reader.readAsText(file);
  };

  const runBulkUpload = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/pipelines/run", {
        method: "POST",
        body: JSON.stringify({
          pipeline_type: "alumni_bulk_upload",
          config: {
            urls,
            college_id: selectedCollegeId || undefined,
            college_name: selectedCollege?.name || "Unknown",
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bulk upload started", description: `Processing ${urls.length} LinkedIn profiles` });
      qc.invalidateQueries({ queryKey: ["/api/pipelines"] });
    },
    onError: (e: any) => toast({ title: "Failed to start", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Upload className="h-5 w-5 text-green-600" /> Bulk Upload Profiles
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">CSV → Profile Scraper</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Info className="h-3 w-3" /> How to use
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-xs text-muted-foreground space-y-1 bg-muted/30 rounded-lg p-3">
            <p>1. <strong>Upload a CSV</strong> with LinkedIn profile URLs (one per row)</p>
            <p>2. <strong>Select the college</strong> these alumni belong to — used for education validation</p>
            <p>3. <strong>Run</strong> — all URLs are scraped via Apify in one batch</p>
            <p>4. Profiles where education doesn't match the college are filtered out automatically</p>
            <p>5. Matching profiles are saved to People + Alumni tables</p>
          </CollapsibleContent>
        </Collapsible>

        {/* ── FILE UPLOAD ────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">LinkedIn Profiles</p>
          <p className="text-[10px] text-muted-foreground mb-2">Upload a CSV exported from Clay, LinkedIn, or any source with profile URLs</p>
          <div className="mt-1 border-2 border-dashed rounded-lg p-4 text-center hover:border-primary/50 transition-colors">
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" id="csv-upload" />
            <label htmlFor="csv-upload" className="cursor-pointer">
              {fileName ? (
                <div>
                  <p className="text-sm font-medium">{fileName}</p>
                  <p className="text-xs text-green-600 mt-1">{urls.length} unique LinkedIn URLs found</p>
                </div>
              ) : (
                <div>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Drop CSV file or click to browse</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Accepts any CSV with linkedin.com/in/ URLs</p>
                </div>
              )}
            </label>
          </div>
        </div>

        {/* ── URL PREVIEW ────────────────────────────────────── */}
        {urls.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Preview ({urls.length} URLs)</Label>
              <button type="button" onClick={() => { setUrls([]); setFileName(""); }}
                className="text-[10px] text-muted-foreground hover:text-foreground">Clear</button>
            </div>
            <ScrollArea className="h-28 rounded-md border p-2">
              <div className="space-y-0.5">
                {urls.slice(0, 20).map((url, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground truncate font-mono">{url}</p>
                ))}
                {urls.length > 20 && (
                  <p className="text-[10px] text-muted-foreground font-medium pt-1">...and {urls.length - 20} more</p>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        <Separator />

        {/* ── COLLEGE SELECTION ──────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">College</p>
          <p className="text-[10px] text-muted-foreground mb-2">Select the college these alumni belong to — used for education validation</p>

          {selectedCollege ? (
            <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
              <Badge variant="secondary" className="text-xs">
                {selectedCollege.short_name || selectedCollege.name}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {[selectedCollege.degree_level, selectedCollege.tier, selectedCollege.city].filter(Boolean).join(" · ")}
              </span>
              <button onClick={() => setSelectedCollegeId("")} className="ml-auto hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={collegeSearch}
                  onChange={e => { setCollegeSearch(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search colleges..."
                  className="text-sm h-9 pl-8"
                />
              </div>
              {showDropdown && collegeSearch && (
                <div className="absolute z-10 w-full mt-1 rounded-md border bg-popover shadow-md">
                  <ScrollArea className="max-h-40">
                    {filteredColleges.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-3 text-center">No colleges found</p>
                    ) : (
                      <div className="p-1">
                        {filteredColleges.slice(0, 20).map(c => (
                          <button
                            key={c.id}
                            onClick={() => { setSelectedCollegeId(c.id); setCollegeSearch(""); setShowDropdown(false); }}
                            className="block w-full text-left px-2 py-1.5 rounded hover:bg-muted/50 text-xs"
                          >
                            {c.name}
                            <span className="text-[10px] text-muted-foreground ml-2">
                              {[c.degree_level, c.tier, c.city].filter(Boolean).join(" · ")}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RUN BUTTON ─────────────────────────────────────── */}
        <Button
          onClick={() => runBulkUpload.mutate()}
          disabled={runBulkUpload.isPending || urls.length === 0 || !selectedCollegeId}
          className="w-full h-10"
        >
          {runBulkUpload.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Upload & Process {urls.length > 0 ? `${urls.length} Profiles` : "Profiles"}
        </Button>

        {/* ── COST ESTIMATE ──────────────────────────────────── */}
        {urls.length > 0 && (
          <div className="rounded-md bg-muted/50 p-2.5 text-[10px] text-muted-foreground">
            <span className="font-medium">Estimated:</span> {urls.length} profiles via Apify Profile Scraper
            {" "}= <span className="font-semibold text-foreground">~${(urls.length * 0.004).toFixed(2)}</span>
            {" "} · Education validation filters non-matching profiles
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page Layout ──────────────────────────────────────────────────────────────

export default function PeopleAlumni() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipelines"><a className="text-xs text-muted-foreground hover:text-foreground">← Pipelines</a></Link>
        <div>
          <h1 className="text-2xl font-bold">People & Alumni</h1>
          <p className="text-sm text-muted-foreground">Search and enrich LinkedIn alumni profiles</p>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <AlumniSearchForm />
        <div className="space-y-6">
          <BulkUploadForm />
          <PipelineTrigger type="people_enrichment" title="Profile Enrichment" description="Enrich pending people profiles with AI extraction" icon={Users}
            fields={[{ name: "batch_size", label: "Batch Size", type: "number", placeholder: "50", defaultValue: "50" }]} />
        </div>
      </div>
      <RunHistory pipelineTypes={["alumni", "alumni_bulk_upload", "people_enrichment"]} title="People Pipeline Runs" />
    </div>
  );
}
