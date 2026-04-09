import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader2, Sparkles, FileText, CheckCircle, ChevronsUpDown, Check, Info, ChevronDown, IndianRupee } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AnalyzeSkill {
  name: string;
  category: string;
  skill_tier: string;
  required: boolean;
  taxonomy_match: { id: string; name: string } | null;
  is_new: boolean;
}

interface AnalyzeResult {
  bucket: string | null;
  job_function: string | null;
  job_function_name: string | null;
  job_family: string | null;
  job_family_name: string | null;
  job_industry: string | null;
  job_industry_name: string | null;
  seniority: string | null;
  company_type: string | null;
  geography: string | null;
  sub_role: string | null;
  standardized_title: string | null;
  company_name: string | null;
  experience_min: number | null;
  experience_max: number | null;
  min_education: string | null;
  preferred_fields: string[];
  jd_quality: string | null;
  classification_confidence: number;
  ctc_min: number | null;
  ctc_max: number | null;
  skills: AnalyzeSkill[];
  total: number;
  saved: boolean;
}

interface Job {
  id: string;
  title: string;
  company_name: string | null;
}

const qualityColors: Record<string, string> = {
  well_structured: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  adequate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  poor: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function JDAnalyzer() {
  const [mode, setMode] = useState<"paste" | "select">("paste");
  const [text, setText] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedJobLabel, setSelectedJobLabel] = useState("");
  const [selectedJobCompany, setSelectedJobCompany] = useState("");
  const [uploadedFilename, setUploadedFilename] = useState("");
  const [uploadWordCount, setUploadWordCount] = useState(0);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveCompany, setSaveCompany] = useState("");
  const [saveLocation, setSaveLocation] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle"|"saving"|"done"|"error">("idle");
  const [savedJobId, setSavedJobId] = useState<string | null>(null);
  const [salaryRunId, setSalaryRunId] = useState<string | null>(null);
  const [salaryStatus, setSalaryStatus] = useState<"idle"|"fetching"|"running"|"done"|"failed">("idle");
  const [salaryData, setSalaryData] = useState<any>(null);
  const [salaryError, setSalaryError] = useState<string | null>(null);
  const salaryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [jobSearchOpen, setJobSearchOpen] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { toast } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search input
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(jobSearchQuery);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [jobSearchQuery]);

  const { data: jobs, isLoading: jobsLoading } = useQuery<{ data: Job[] }>({
    queryKey: ["/api/jobs-search", debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50", page: "1" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await authFetch(`/api/jobs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  const analyze = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if ((mode === "paste" || mode === "upload") && text.trim()) {
        body.text = text;
      } else if (mode === "select" && selectedJobId) {
        body.job_id = selectedJobId;
      } else {
        throw new Error("Please provide text or select a job");
      }
      const res = await apiRequest("POST", "/api/analyze-jd", body);
      return res.json() as Promise<AnalyzeResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setSalaryStatus("idle"); setSalaryData(null); setSalaryError(null); setSalaryRunId(null);
      setSaveStatus("idle"); setSavedJobId(null);
      if (data.standardized_title) setSaveTitle(data.standardized_title);
      if (data.company_name) setSaveCompany(data.company_name);
      if (data.geography) setSaveLocation(data.geography);
      if (salaryPollRef.current) { clearInterval(salaryPollRef.current); salaryPollRef.current = null; }
      if (data.total === 0 && !data.bucket) {
        toast({
          title: "No results",
          description: "Could not classify this JD. It may be too short or vague.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Analysis complete", description: `${data.bucket || "Classified"} — ${data.total} skills extracted` });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const hardSkills = result?.skills.filter(s => s.skill_tier === "hard_skill") || [];
  const knowledgeSkills = result?.skills.filter(s => s.skill_tier === "knowledge") || [];
  const competencies = result?.skills.filter(s => s.skill_tier === "competency") || [];


  const pollSalary = async (run_id: string, company: string, job_title: string) => {
    try {
      const res = await authFetch(`/api/taxonomy/salary-lookup/result?run_id=${run_id}&company=${encodeURIComponent(company)}&job_title=${encodeURIComponent(job_title)}`);
      const data = await res.json();
      if (data.status === "done") {
        setSalaryData(data);
        setSalaryStatus("done");
        if (salaryPollRef.current) { clearInterval(salaryPollRef.current); salaryPollRef.current = null; }
      } else if (data.status === "failed") {
        setSalaryError(data.error || "AmbitionBox fetch failed");
        setSalaryStatus("failed");
        if (salaryPollRef.current) { clearInterval(salaryPollRef.current); salaryPollRef.current = null; }
      }
    } catch (e) { /* keep polling */ }
  };


  const handleFileUpload = async (file: File) => {
    const allowed = [".txt", ".pdf", ".docx", ".doc"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowed.includes(ext)) {
      setUploadError("Unsupported file type. Use .txt, .pdf, .docx, or .doc");
      return;
    }
    setUploadLoading(true); setUploadError(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await authFetch("/api/taxonomy/extract-text", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setText(data.text);
      setUploadedFilename(data.filename);
      setUploadWordCount(data.word_count);
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploadLoading(false);
    }
  };


  const handleSaveToNexus = async () => {
    if (!saveTitle.trim() || !saveCompany.trim()) return;
    setSaveStatus("saving");
    try {
      const res = await authFetch("/api/jobs/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: saveTitle, company_name: saveCompany, description: text, location_raw: saveLocation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSavedJobId(data.id);
      setSaveStatus("done");
    } catch (e: any) {
      setSaveStatus("error");
      setSalaryError(e.message);
    }
  };

  const handleGetSalary = async () => {
    if (!result) return;
    const company = selectedJobCompany || result.company_type || "";
    const job_title = result.standardized_title || "";
    if (!company) { setSalaryError("No company detected. Select a job first."); setSalaryStatus("failed"); return; }
    setSalaryStatus("fetching"); setSalaryData(null); setSalaryError(null);
    try {
      const res = await authFetch("/api/taxonomy/salary-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_name: company, job_title }) });
      const data = await res.json();
      if (data.run_id) {
        setSalaryRunId(data.run_id);
        setSalaryStatus("running");
        salaryPollRef.current = setInterval(() => pollSalary(data.run_id, company, job_title), 15000);
      } else {
        setSalaryError(data.error || "Failed to start fetch");
        setSalaryStatus("failed");
      }
    } catch (e: any) { setSalaryError(e.message); setSalaryStatus("failed"); }
  };

  // Cleanup poll on unmount
  useEffect(() => { return () => { if (salaryPollRef.current) clearInterval(salaryPollRef.current); }; }, []);

  return (
    <div className="space-y-6" data-testid="jd-analyzer-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">JD Analyzer</h1>
        <p className="text-sm text-muted-foreground">Classify and extract skills from job descriptions using AI</p>
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
            <p>• Paste a job description or select an existing job from the database</p>
            <p>• AI extracts: technical skills, tools, certifications, methodologies, competencies</p>
            <p>• Each extracted skill is matched against the taxonomy (8,888+ skills)</p>
            <p>• New skills not in the taxonomy are auto-created</p>
            <p className="pt-1"><strong>Two modes:</strong></p>
            <p>1. "Paste JD Text" — paste any job description text and analyze it</p>
            <p>2. "Select Existing Job" — search and pick from jobs in the database (type to search)</p>
            <p className="pt-1"><strong>What you get:</strong></p>
            <p>• Extracted skills with categories (technology, skill, knowledge, etc.)</p>
            <p>• Taxonomy match status (matched to existing skill or newly created)</p>
            <p>• Confidence scores for each extraction</p>
            <p className="pt-1"><strong>Limitations:</strong></p>
            <p>• Analysis requires a non-empty job description (minimum ~50 words for good results)</p>
            <p>• Accuracy is highest for technical skills (~85%) and lower for soft skills (~50%)</p>
            <p>• Processing takes 5-15 seconds per JD depending on length</p>
            <p>• Very short or vague JDs will produce few/no results</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" /> Input
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Source</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "paste" | "select")}>
                <SelectTrigger data-testid="jd-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paste">Paste JD Text</SelectItem>
                  <SelectItem value="select">Select Existing Job</SelectItem>
                  <SelectItem value="upload">Upload File</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "paste" ? (
              <div className="space-y-2">
                <Label className="text-xs">Job Description</Label>
                <Textarea
                  placeholder="Paste a job description here..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-[300px] text-sm"
                  data-testid="jd-text"
                />
              </div>
            ) : mode === "upload" ? (
              <div className="space-y-2">
                <Label className="text-xs">Upload JD File</Label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); }}
                  className="border-2 border-dashed border-primary/30 rounded-lg p-8 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
                >
                  {uploadLoading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Extracting text...</p>
                    </div>
                  ) : uploadedFilename ? (
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle className="h-8 w-8 text-green-600" />
                      <p className="text-sm font-medium">{uploadedFilename}</p>
                      <Badge variant="outline" className="text-green-700 border-green-300">✓ {uploadWordCount} words extracted</Badge>
                      <p className="text-xs text-muted-foreground mt-1">Click to upload a different file</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm font-medium">Drop file here or click to browse</p>
                      <p className="text-xs text-muted-foreground">PDF, DOCX, DOC, TXT supported</p>
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept=".txt,.pdf,.docx,.doc" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
                {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
                {uploadedFilename && text && (
                  <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground line-clamp-3">
                    <span className="font-medium">Preview: </span>{text.slice(0, 300)}...
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Select a Job</Label>
                <Popover open={jobSearchOpen} onOpenChange={setJobSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={jobSearchOpen}
                      className="w-full justify-between text-sm font-normal h-10"
                      data-testid="jd-job-select"
                    >
                      {selectedJobLabel || "Search by title or company..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Type to search jobs..."
                        value={jobSearchQuery}
                        onValueChange={setJobSearchQuery}
                      />
                      <CommandList>
                        {jobsLoading ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <>
                            <CommandEmpty>No jobs found.</CommandEmpty>
                            <CommandGroup>
                              {(jobs?.data || []).map((job) => (
                                <CommandItem
                                  key={job.id}
                                  value={job.id}
                                  onSelect={() => {
                                    setSelectedJobId(job.id);
                                    setSelectedJobLabel(
                                      `${job.title}${job.company_name ? ` @ ${job.company_name}` : ""}`
                                    );
                                    setSelectedJobCompany(job.company_name || "");
                                    setJobSearchOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedJobId === job.id ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <span className="truncate">
                                    {job.title}
                                    {job.company_name && (
                                      <span className="text-muted-foreground ml-1">@ {job.company_name}</span>
                                    )}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-[11px] text-muted-foreground">
                  Only showing jobs with descriptions. If your job isn't listed, switch to "Paste JD Text" and paste the description manually.
                </p>
              </div>
            )}


            {/* Save to Nexus — shown after analysis of pasted/uploaded JD */}
            {result && (mode === "paste" || mode === "upload") && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Save this JD to Nexus</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Job Title *</Label>
                    <input value={saveTitle} onChange={e => setSaveTitle(e.target.value)}
                      placeholder="e.g. Data Analyst" className="w-full mt-0.5 px-2 py-1.5 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <Label className="text-xs">Company *</Label>
                    <input value={saveCompany} onChange={e => setSaveCompany(e.target.value)}
                      placeholder="e.g. Accenture" className="w-full mt-0.5 px-2 py-1.5 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Location (optional)</Label>
                  <input value={saveLocation} onChange={e => setSaveLocation(e.target.value)}
                    placeholder="e.g. Bangalore" className="w-full mt-0.5 px-2 py-1.5 text-xs border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
                {saveStatus === "done" ? (
                  <p className="text-xs text-green-700 font-medium">✓ Saved to Nexus — Job ID: {savedJobId}</p>
                ) : saveStatus === "error" ? (
                  <p className="text-xs text-red-600">Save failed. Try again.</p>
                ) : (
                  <Button size="sm" onClick={handleSaveToNexus}
                    disabled={saveStatus === "saving" || !saveTitle.trim() || !saveCompany.trim()}
                    className="w-full text-xs h-8">
                    {saveStatus === "saving" ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</> : "Save to Nexus"}
                  </Button>
                )}
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => analyze.mutate()}
              disabled={analyze.isPending || (mode === "paste" && !text.trim()) || (mode === "select" && !selectedJobId) || (mode === "upload" && !text.trim())}
              data-testid="jd-analyze-btn"
            >
              {analyze.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {analyze.isPending ? "Analyzing..." : "Analyze with AI"}
            </Button>
          </CardContent>
        </Card>

        {/* Results — placeholder when empty or loading */}
        {!result && !analyze.isPending && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12 text-muted-foreground text-sm">
                Paste a JD or select a job, then click Analyze
              </div>
            </CardContent>
          </Card>
        )}

        {analyze.isPending && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground mt-2">Classifying with AI...</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* V2 Results */}
      {result && (
        <div className="space-y-4">
          {/* 1. Classification Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Classification
                {result.saved && <Badge variant="outline" className="text-[10px] text-green-600 border-green-300"><CheckCircle className="h-3 w-3 mr-1" />Saved</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Bucket label */}
              {result.bucket && (
                <div className="rounded-lg bg-teal-600 text-white px-4 py-3">
                  <p className="text-lg font-semibold">{result.bucket}</p>
                  {result.standardized_title && result.standardized_title !== result.bucket && (
                    <p className="text-teal-100 text-sm mt-0.5">{result.standardized_title}</p>
                  )}
                </div>
              )}

              {/* Classification badges */}
              <div className="flex flex-wrap gap-2">
                {result.job_function_name && (
                  <Badge variant="secondary" className="text-xs">{result.job_function_name}</Badge>
                )}
                {result.job_family_name && (
                  <Badge variant="secondary" className="text-xs">{result.job_family_name}</Badge>
                )}
                {result.job_industry_name && (
                  <Badge variant="secondary" className="text-xs">{result.job_industry_name}</Badge>
                )}
                {result.seniority && (
                  <Badge variant="secondary" className="text-xs">{result.seniority}</Badge>
                )}
                {result.company_type && (
                  <Badge variant="secondary" className="text-xs">{result.company_type}</Badge>
                )}
                {result.geography && (
                  <Badge variant="outline" className="text-xs">{result.geography}</Badge>
                )}
              </div>

              {/* Sub-role */}
              {result.sub_role && (
                <p className="text-sm text-muted-foreground">Sub-role: <span className="text-foreground font-medium">{result.sub_role}</span></p>
              )}

              {/* Quality + confidence */}
              <div className="flex items-center gap-2">
                {result.jd_quality && (
                  <Badge className={`text-[10px] ${qualityColors[result.jd_quality] || ""}`}>
                    {result.jd_quality.replace("_", " ")}
                  </Badge>
                )}
                {result.classification_confidence > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {Math.round(result.classification_confidence * 100)}% confidence
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 2. Experience & Education Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Experience & Education</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Experience</p>
                  <p className="text-sm font-medium">
                    {result.experience_min != null || result.experience_max != null
                      ? `${result.experience_min ?? 0} – ${result.experience_max ?? "?"} years`
                      : "Not specified"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Education</p>
                  <p className="text-sm font-medium capitalize">{result.min_education || "Not specified"}</p>
                  {result.preferred_fields.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">{result.preferred_fields.join(", ")}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">CTC</p>
                  <p className="text-sm font-medium">
                    {result.ctc_min != null || result.ctc_max != null
                      ? `₹${result.ctc_min ?? "?"} – ${result.ctc_max ?? "?"} LPA`
                      : "Not stated in JD"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 3. Skills Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                Skills <Badge variant="secondary">{result.total}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "Hard Skills", items: hardSkills, color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
                { label: "Knowledge", items: knowledgeSkills, color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
                { label: "Competencies", items: competencies, color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
              ].filter(g => g.items.length > 0).map(group => (
                <div key={group.label}>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    {group.label} ({group.items.length})
                  </h3>
                  <div className="space-y-1.5">
                    {group.items.map((skill, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded border">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{skill.name}</span>
                          <Badge className={`text-[10px] shrink-0 ${group.color}`}>
                            {skill.category}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant={skill.required ? "default" : "outline"} className="text-[10px]">
                            {skill.required ? "Required" : "Optional"}
                          </Badge>
                          {skill.is_new ? (
                            <Badge variant="outline" className="text-[10px] text-orange-600 border-orange-300">New</Badge>
                          ) : skill.taxonomy_match ? (
                            <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">
                              <CheckCircle className="h-2.5 w-2.5 mr-0.5" />Matched
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {result.total === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No skills extracted</p>
              )}

              {/* 4. Salary Insights Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <IndianRupee className="h-4 w-4 text-green-600" /> AmbitionBox Salary Data
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {salaryStatus === "idle" && (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">Get real salary data for this role from AmbitionBox (India). Takes ~2 minutes.</p>
                      <Button variant="outline" size="sm" onClick={handleGetSalary} className="w-fit border-green-600 text-green-700 hover:bg-green-50">
                        <IndianRupee className="h-3 w-3 mr-1" /> Get AmbitionBox Salary Data
                      </Button>
                    </div>
                  )}
                  {(salaryStatus === "fetching" || salaryStatus === "running") && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
                      <Loader2 className="h-4 w-4 text-amber-600 animate-spin mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">Fetching from AmbitionBox...</p>
                        <p className="text-xs text-amber-600 mt-1">Using residential proxies to access salary data. Usually takes 2–3 minutes. Results will appear automatically.</p>
                      </div>
                    </div>
                  )}
                  {salaryStatus === "done" && salaryData && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">{salaryData.matches?.length} matching roles from {salaryData.all_roles_count} total at {salaryData.company}</p>
                        <Badge variant="outline" className="text-xs">AmbitionBox</Badge>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Role</th>
                              <th className="text-left py-1.5 pr-3 font-medium text-muted-foreground">Exp</th>
                              <th className="text-right py-1.5 pr-3 font-medium text-muted-foreground">Min</th>
                              <th className="text-right py-1.5 pr-3 font-medium text-green-700">Avg</th>
                              <th className="text-right py-1.5 pr-3 font-medium text-muted-foreground">Max</th>
                              <th className="text-right py-1.5 font-medium text-muted-foreground">Responses</th>
                            </tr>
                          </thead>
                          <tbody>
                            {salaryData.matches?.map((m: any, i: number) => (
                              <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                                <td className="py-1.5 pr-3 font-medium">{m.role}</td>
                                <td className="py-1.5 pr-3 text-muted-foreground">{m.experience_range || "—"}</td>
                                <td className="py-1.5 pr-3 text-right">{m.min_lpa != null ? `₹${m.min_lpa}L` : "—"}</td>
                                <td className="py-1.5 pr-3 text-right font-semibold text-green-700">{m.avg_lpa != null ? `₹${m.avg_lpa}L` : "—"}</td>
                                <td className="py-1.5 pr-3 text-right">{m.max_lpa != null ? `₹${m.max_lpa}L` : "—"}</td>
                                <td className="py-1.5 text-right text-muted-foreground">{m.data_points}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {salaryStatus === "failed" && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-center justify-between">
                      <p className="text-sm text-red-700">{salaryError || "Failed to fetch salary data"}</p>
                      <Button variant="ghost" size="sm" onClick={() => setSalaryStatus("idle")} className="text-red-600 shrink-0 ml-2">Try Again</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
