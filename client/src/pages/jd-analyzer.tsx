import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, FileText, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExtractedSkill {
  name: string;
  category: string;
  confidence: number;
  taxonomy_match: {
    id: string;
    name: string;
    category: string;
    subcategory: string | null;
  } | null;
}

interface AnalyzeResult {
  skills: ExtractedSkill[];
  total: number;
}

interface Job {
  id: string;
  title: string;
  company_name: string | null;
}

const categoryColors: Record<string, string> = {
  skill: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  knowledge: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ability: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  technology: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  soft_skill: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
};

export default function JDAnalyzer() {
  const [mode, setMode] = useState<"paste" | "select">("paste");
  const [text, setText] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const { toast } = useToast();

  const { data: jobs } = useQuery<{ data: Job[] }>({
    queryKey: ["/api/jobs-for-analyzer"],
    queryFn: async () => {
      const res = await authFetch("/api/jobs?limit=100&page=1");
      if (!res.ok) throw new Error("Failed to fetch jobs");
      return res.json();
    },
  });

  const analyze = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (mode === "paste" && text.trim()) {
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
      toast({ title: "Analysis complete", description: `Extracted ${data.total} skills` });
    },
    onError: (err: Error) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const matched = result?.skills.filter((s) => s.taxonomy_match) || [];
  const unmatched = result?.skills.filter((s) => !s.taxonomy_match) || [];

  return (
    <div className="space-y-6" data-testid="jd-analyzer-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">JD Analyzer</h1>
        <p className="text-sm text-muted-foreground">Extract and map skills from job descriptions using AI</p>
      </div>

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
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Select a Job</Label>
                <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                  <SelectTrigger data-testid="jd-job-select">
                    <SelectValue placeholder="Choose a job..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobs?.data || []).map((job) => (
                      <SelectItem key={job.id} value={job.id}>
                        {job.title} {job.company_name ? `@ ${job.company_name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => analyze.mutate()}
              disabled={analyze.isPending}
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

        {/* Results */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Extracted Skills
              {result && <Badge variant="secondary">{result.total}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!result && !analyze.isPending && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Paste a JD or select a job, then click Analyze
              </div>
            )}

            {analyze.isPending && (
              <div className="text-center py-12">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground mt-2">Extracting skills with GPT-4o-mini...</p>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Matched Skills */}
                {matched.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-green-500" /> Taxonomy Matched ({matched.length})
                    </h3>
                    <div className="space-y-2">
                      {matched.map((skill, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded border bg-green-50/50 dark:bg-green-950/20">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[10px] ${categoryColors[skill.category] || ""}`}>
                              {skill.category}
                            </Badge>
                            <span className="text-sm font-medium">{skill.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {skill.taxonomy_match?.name}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {Math.round(skill.confidence * 100)}%
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unmatched Skills */}
                {unmatched.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                      Unmatched ({unmatched.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {unmatched.map((skill, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {skill.name}
                          <span className="ml-1 text-muted-foreground">{Math.round(skill.confidence * 100)}%</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
