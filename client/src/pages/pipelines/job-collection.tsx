import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Linkedin, Globe, Play, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { RunHistory } from "./run-history";

function useRunPipeline() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ type, config }: { type: string; config: any }) => {
      const res = await fetch("/api/pipelines/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_type: type, config }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pipeline started" });
      qc.invalidateQueries({ queryKey: ["/api/pipelines/runs"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
}

function MultiCheck({ label, options, selected, onChange }: {
  label: string; options: { value: string; label: string }[];
  selected: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1.5">
        {options.map(o => (
          <label key={o.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Checkbox checked={selected.includes(o.value)}
              onCheckedChange={c => onChange(c ? [...selected, o.value] : selected.filter(v => v !== o.value))} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function LinkedInForm() {
  const run = useRunPipeline();
  const [keywords, setKeywords] = useState("Software Engineer");
  const [location, setLocation] = useState("India");
  const [expLevel, setExpLevel] = useState<string[]>([]);
  const [workType, setWorkType] = useState<string[]>(["1"]);
  const [workLoc, setWorkLoc] = useState<string[]>([]);
  const [timePosted, setTimePosted] = useState("r86400");
  const [companyNames, setCompanyNames] = useState("");
  const [fetchDesc, setFetchDesc] = useState(true);
  const [sortBy, setSortBy] = useState("DD");
  const [limit, setLimit] = useState("100");

  const handleRun = () => run.mutate({
    type: "linkedin_jobs",
    config: {
      search_keywords: keywords, location,
      date_posted: timePosted === "r86400" ? "24h" : timePosted === "r604800" ? "week" : timePosted === "r2592000" ? "month" : "any",
      limit: parseInt(limit) || 100,
      experience_level: expLevel.join(",") || undefined,
      work_type: workType.join(",") || undefined,
      work_location: workLoc.join(",") || undefined,
      company_names: companyNames || undefined,
      fetch_description: fetchDesc,
      sort_by: sortBy,
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Linkedin className="h-4 w-4 text-blue-600" /> LinkedIn Jobs
        </CardTitle>
        <p className="text-xs text-muted-foreground">$0.001/job via Apify. +$0.001 with descriptions.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Keywords *</Label><Input value={keywords} onChange={e => setKeywords(e.target.value)} className="text-xs h-8 mt-1" /></div>
          <div><Label className="text-xs">Location</Label><Input value={location} onChange={e => setLocation(e.target.value)} className="text-xs h-8 mt-1" /></div>
        </div>
        <MultiCheck label="Experience Level" selected={expLevel} onChange={setExpLevel}
          options={[{value:"1",label:"Internship"},{value:"2",label:"Entry"},{value:"3",label:"Associate"},{value:"4",label:"Mid-Senior"},{value:"5",label:"Director"},{value:"6",label:"Executive"}]} />
        <MultiCheck label="Work Type" selected={workType} onChange={setWorkType}
          options={[{value:"1",label:"Full-time"},{value:"2",label:"Part-time"},{value:"3",label:"Contract"},{value:"4",label:"Temporary"},{value:"6",label:"Internship"}]} />
        <MultiCheck label="Work Location" selected={workLoc} onChange={setWorkLoc}
          options={[{value:"1",label:"On-site"},{value:"2",label:"Remote"},{value:"3",label:"Hybrid"}]} />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Time Posted</Label>
            <Select value={timePosted} onValueChange={setTimePosted}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="r86400">Past 24h</SelectItem>
                <SelectItem value="r604800">Past Week</SelectItem>
                <SelectItem value="r2592000">Past Month</SelectItem>
                <SelectItem value="any">Any Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Sort By</Label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DD">Most Recent</SelectItem>
                <SelectItem value="R">Relevance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Limit</Label><Input type="number" value={limit} onChange={e => setLimit(e.target.value)} className="text-xs h-8 mt-1" /></div>
        </div>
        <div><Label className="text-xs">Company Names</Label><Input value={companyNames} onChange={e => setCompanyNames(e.target.value)} placeholder="e.g. Google, TCS, Infosys" className="text-xs h-8 mt-1" /></div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox checked={fetchDesc} onCheckedChange={c => setFetchDesc(!!c)} />
          Fetch full JD text (+$0.001/job) — recommended
        </label>
        <Button onClick={handleRun} disabled={run.isPending || !keywords.trim()} className="w-full h-9 text-sm">
          {run.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Run LinkedIn Scraper
        </Button>
      </CardContent>
    </Card>
  );
}

function GoogleJobsForm() {
  const run = useRunPipeline();
  const [query, setQuery] = useState("Data Analyst in Mumbai");
  const [country, setCountry] = useState("IN");
  const [datePosted, setDatePosted] = useState("week");
  const [empTypes, setEmpTypes] = useState<string[]>(["FULLTIME"]);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [jobReqs, setJobReqs] = useState("");
  const [employer, setEmployer] = useState("");
  const [numPages, setNumPages] = useState("5");

  const handleRun = () => run.mutate({
    type: "google_jobs",
    config: {
      queries: [query], country, date_posted: datePosted,
      employment_types: empTypes.join(",") || undefined,
      remote_only: remoteOnly || undefined,
      job_requirements: jobReqs || undefined,
      employer_name: employer || undefined,
      num_pages: parseInt(numPages) || 5,
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Globe className="h-4 w-4 text-green-600" /> Google Jobs (JSearch)
        </CardTitle>
        <p className="text-xs text-muted-foreground">Aggregates LinkedIn + Indeed + Glassdoor + company sites</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div><Label className="text-xs">Search Query *</Label><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. Data Analyst in Mumbai" className="text-xs h-8 mt-1" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
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
          <div><Label className="text-xs">Pages</Label><Input type="number" value={numPages} onChange={e => setNumPages(e.target.value)} className="text-xs h-8 mt-1" /></div>
        </div>
        <MultiCheck label="Employment Type" selected={empTypes} onChange={setEmpTypes}
          options={[{value:"FULLTIME",label:"Full-time"},{value:"PARTTIME",label:"Part-time"},{value:"CONTRACTOR",label:"Contract"},{value:"INTERN",label:"Intern"}]} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Experience Required</Label>
            <Select value={jobReqs} onValueChange={setJobReqs}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any</SelectItem>
                <SelectItem value="under_3_years">Under 3 years</SelectItem>
                <SelectItem value="more_than_3_years">3+ years</SelectItem>
                <SelectItem value="no_experience">No experience</SelectItem>
                <SelectItem value="no_degree">No degree</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Employer Name</Label><Input value={employer} onChange={e => setEmployer(e.target.value)} placeholder="e.g. Amazon" className="text-xs h-8 mt-1" /></div>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox checked={remoteOnly} onCheckedChange={c => setRemoteOnly(!!c)} />
          Remote jobs only
        </label>
        <Button onClick={handleRun} disabled={run.isPending || !query.trim()} className="w-full h-9 text-sm">
          {run.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Run Google Jobs Search
        </Button>
      </CardContent>
    </Card>
  );
}

export default function JobCollection() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipelines"><a className="text-xs text-muted-foreground hover:text-foreground">← Pipelines</a></Link>
        <div>
          <h1 className="text-2xl font-bold">Job Collection</h1>
          <p className="text-sm text-muted-foreground">Scrape jobs from LinkedIn and Google with detailed filters</p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LinkedInForm />
        <GoogleJobsForm />
      </div>
      <RunHistory pipelineTypes={["linkedin_jobs", "google_jobs"]} title="Job Collection Runs" />
    </div>
  );
}
