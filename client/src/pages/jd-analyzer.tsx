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
import type { AnalyzeResult } from "@/components/jd-analyzer/types";
import { ResultHeader } from "@/components/jd-analyzer/ResultHeader";
import { ClassificationCard } from "@/components/jd-analyzer/ClassificationCard";
import { BucketMappingCard } from "@/components/jd-analyzer/BucketMappingCard";
import { ExperienceEducationCTC } from "@/components/jd-analyzer/ExperienceEducationCTC";
import { SkillsCard } from "@/components/jd-analyzer/SkillsCard";

interface Job {
  id: string;
  title: string;
  company_name: string | null;
}

export default function JDAnalyzer() {
  const [mode, setMode] = useState<"paste" | "select" | "upload">("paste");
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
        if (mode === "upload" && uploadedFilename) body.filename = uploadedFilename;
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
      if (!res.ok) throw new Error(data.error || data.detail || "Save failed — check console");
      setSavedJobId(data.id);
      setSaveStatus("done");
    } catch (e: any) {
      setSaveStatus("error");
      setSalaryError(e.message);
    }
  };

  const handleGetSalary = async () => {
    if (!result) return;
    const company = selectedJobCompany || result.company_name || "";
    const job_title = result.standardized_title || "";
    if (!job_title) { setSalaryError("No job title detected. Analyze a JD first."); setSalaryStatus("failed"); return; }
    setSalaryStatus("fetching"); setSalaryData(null); setSalaryError(null);
    try {
      const res = await authFetch("/api/taxonomy/salary-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_name: company || "Any", job_title }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Salary lookup failed");
      setSalaryData(data);
      setSalaryStatus("done");
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
              <Select value={mode} onValueChange={(v) => setMode(v as "paste" | "select" | "upload")}>
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

      {/* V2 Results — refactored into sub-components for transparency (Track C jdenh001) */}
      {result && (
        <div className="space-y-4" data-testid="jd-analyzer-results">
          <ResultHeader result={result} />
          <ClassificationCard result={result} />
          <BucketMappingCard result={result} />
          <ExperienceEducationCTC result={result} />
          <SkillsCard result={result} />
        </div>
      )}
    </div>
  );
}
