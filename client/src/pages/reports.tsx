import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import {
  FileText, Upload, Search, ChevronLeft, ChevronRight, ArrowLeft,
  Loader2, Trash2, Play, CheckCircle2, XCircle, Clock, AlertTriangle,
  TrendingUp, TrendingDown, Minus, ArrowUpRight, Sparkles, Pencil, Check, X, Info, ChevronDown,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const REPORT_TYPES = [
  { value: "skills_report", label: "Skills Report" },
  { value: "industry_report", label: "Industry Report" },
  { value: "labor_market", label: "Labor Market" },
  { value: "salary_survey", label: "Salary Survey" },
];

const REGIONS = ["Global", "India", "UAE", "GCC", "APAC", "Europe", "North America"];

const SOURCE_SUGGESTIONS = [
  "WEF", "McKinsey", "NASSCOM", "LinkedIn", "Coursera", "Deloitte", "BCG", "Naukri", "TeamLease",
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: "Pending", color: "bg-gray-100 text-gray-700", icon: Clock },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-700", icon: Loader2 },
  completed: { label: "Completed", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  error: { label: "Error", color: "bg-red-100 text-red-700", icon: XCircle },
};

const GROWTH_ICONS: Record<string, { icon: any; color: string; label: string }> = {
  growing: { icon: TrendingUp, color: "text-green-600", label: "Growing" },
  emerging: { icon: ArrowUpRight, color: "text-blue-600", label: "Emerging" },
  stable: { icon: Minus, color: "text-gray-600", label: "Stable" },
  declining: { icon: TrendingDown, color: "text-red-600", label: "Declining" },
};

interface Report {
  id: string;
  title: string;
  source_org: string | null;
  report_year: number | null;
  report_type: string | null;
  region: string | null;
  file_url: string | null;
  file_type: string | null;
  file_size_bytes: number | null;
  page_count: number | null;
  total_chunks: number | null;
  processed_chunks: number;
  summary: string | null;
  key_findings: any[];
  extracted_data: any;
  processing_status: string;
  error_message: string | null;
  processed_at: string | null;
  uploaded_by: string | null;
  created_at: string;
  skill_count?: number;
}

interface SkillMention {
  id: string;
  report_id: string;
  taxonomy_skill_id: string | null;
  skill_name: string;
  mention_context: string | null;
  ranking: number | null;
  growth_indicator: string | null;
  data_point: string | null;
}

export default function Reports() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState("");
  const [editRegion, setEditRegion] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async ({ id, report_type, region }: { id: string; report_type: string; region: string }) => {
      const res = await apiRequest("PATCH", `/api/reports/${id}`, { report_type, region });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Report updated", description: "Report metadata has been saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      setEditingId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/reports/${id}/process`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Processing failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Processing complete", description: "Report has been analyzed successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
    },
    onError: (err: Error) => {
      toast({ title: "Processing failed", description: err.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
    },
  });

  function startEditReport(report: Report, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(report.id);
    setEditType(report.report_type || "");
    setEditRegion(report.region || "");
  }

  function saveEditReport(e: React.MouseEvent) {
    e.stopPropagation();
    if (editingId) {
      updateMutation.mutate({ id: editingId, report_type: editType, region: editRegion });
    }
  }

  function cancelEditReport(e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(null);
  }

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", "20");
  if (search) params.set("search", search);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (typeFilter !== "all") params.set("report_type", typeFilter);
  if (regionFilter !== "all") params.set("region", regionFilter);

  const { data: listData, isLoading } = useQuery<{ data: Report[]; total: number }>({
    queryKey: ["/api/reports", params.toString()],
    queryFn: async () => {
      const res = await authFetch(`/api/reports?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch reports");
      return res.json();
    },
  });

  const totalPages = listData ? Math.ceil(listData.total / 20) : 1;

  if (selectedReport) {
    return (
      <ReportDetail
        reportId={selectedReport.id}
        onBack={() => setSelectedReport(null)}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="reports-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Industry Reports</h1>
          <p className="text-sm text-muted-foreground">Upload and analyze industry reports for skill insights</p>
        </div>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>

          <DialogTrigger asChild>
            <Button data-testid="btn-upload-report">
              <Upload className="h-4 w-4 mr-2" />
              Upload Report
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <UploadDialog
              onSuccess={() => {
                setUploadOpen(false);
                queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
              }}
            />
          </DialogContent>
        </Dialog>
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
            <p>• Upload industry reports (WEF Future of Jobs, Coursera Skills Report, etc.) as PDFs</p>
            <p>• AI extracts key findings, skill trends, and growth/decline signals</p>
            <p>• Findings are categorized (technology, skills, labor_market, salary) with confidence scores</p>
            <p>• Skills mentioned in reports are matched to the taxonomy, creating "report signals"</p>
            <p className="pt-1"><strong>Processing:</strong></p>
            <p>• Large reports are processed in chunks (to handle 100+ page PDFs)</p>
            <p>• AI generates an executive summary and structured key findings</p>
            <p>• Each finding gets a relevance score (0-100%)</p>
            <p className="pt-1"><strong>What you get:</strong></p>
            <p>• Executive summary</p>
            <p>• Key findings with categories and confidence scores</p>
            <p>• Skill signals — which skills are rising/declining according to the report</p>
            <p>• Edit type/region metadata using the pencil icon on reports with missing info</p>
            <p className="pt-1"><strong>Limitations:</strong></p>
            <p>• PDF must be text-based. Max size: 20MB</p>
            <p>• Very large reports (200+ pages) may take 5-10 minutes to process</p>
            <p>• Reports in non-English languages have reduced extraction accuracy</p>
            <p>• Skill matching depends on the taxonomy — niche skills may not match</p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search reports..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-64"
          data-testid="search-reports"
        />
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {REPORT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={regionFilter} onValueChange={(v) => { setRegionFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            {REGIONS.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !listData?.data?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No reports yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Upload an industry report to get started</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3">
            {listData.data.map((report) => {
              const statusConf = STATUS_CONFIG[report.processing_status] || STATUS_CONFIG.pending;
              const StatusIcon = statusConf.icon;
              const typeLabel = REPORT_TYPES.find((t) => t.value === report.report_type)?.label || report.report_type || "—";
              const isEditing = editingId === report.id;
              return (
                <Card
                  key={report.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => !isEditing && setSelectedReport(report)}
                  data-testid={`report-card-${report.id}`}
                >
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{report.title}</h3>
                        <Badge variant="outline" className={statusConf.color}>
                          <StatusIcon className={`h-3 w-3 mr-1 ${report.processing_status === "processing" ? "animate-spin" : ""}`} />
                          {statusConf.label}
                        </Badge>
                      </div>
                      {isEditing ? (
                        <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                          <Select value={editType} onValueChange={setEditType}>
                            <SelectTrigger className="h-7 w-[150px] text-xs">
                              <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                              {REPORT_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={editRegion} onValueChange={setEditRegion}>
                            <SelectTrigger className="h-7 w-[130px] text-xs">
                              <SelectValue placeholder="Select region..." />
                            </SelectTrigger>
                            <SelectContent>
                              {REGIONS.map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={saveEditReport} disabled={updateMutation.isPending}>
                            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-green-600" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={cancelEditReport}>
                            <X className="h-3 w-3 text-red-600" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {report.source_org && <span>{report.source_org}</span>}
                          {report.report_year && <span>{report.report_year}</span>}
                          <span>{typeLabel}</span>
                          <span>{report.region || "—"}</span>
                          {(report.skill_count ?? 0) > 0 && (
                            <span className="text-primary font-medium">{report.skill_count} skills</span>
                          )}
                          {report.file_size_bytes && (
                            <span>{(report.file_size_bytes / 1048576).toFixed(1)} MB</span>
                          )}
                          {(!report.report_type || !report.region) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 opacity-40 hover:opacity-100"
                              onClick={(e) => startEditReport(report, e)}
                              title="Edit type/region"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    {(report.processing_status === "processing" || report.processing_status === "error") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-4 shrink-0"
                        disabled={reprocessMutation.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          reprocessMutation.mutate(report.id);
                        }}
                        data-testid={`btn-reprocess-${report.id}`}
                      >
                        {reprocessMutation.isPending ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 mr-1" />
                        )}
                        Re-process
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ==================== Upload Dialog ====================

function UploadDialog({ onSuccess }: { onSuccess: () => void }) {
  const [title, setTitle] = useState("");
  const [sourceOrg, setSourceOrg] = useState("");
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [reportType, setReportType] = useState("");
  const [region, setRegion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const filteredSuggestions = SOURCE_SUGGESTIONS.filter(
    (s) => s.toLowerCase().includes(sourceOrg.toLowerCase()) && sourceOrg.length > 0
  );

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped && (dropped.name.endsWith(".pdf") || dropped.name.endsWith(".docx"))) {
      setFile(dropped);
      if (!title) setTitle(dropped.name.replace(/\.(pdf|docx)$/i, ""));
    } else {
      toast({ title: "Invalid file", description: "Please upload a PDF or DOCX file", variant: "destructive" });
    }
  }, [title, toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      if (!title) setTitle(selected.name.replace(/\.(pdf|docx)$/i, ""));
    }
  };

  const handleUpload = async () => {
    if (!file || !title) return;
    setUploading(true);
    setUploadProgress(10);

    try {
      // Upload file to Supabase Storage
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const filePath = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

      setUploadProgress(20);
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("reports")
        .upload(filePath, file);

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      setUploadProgress(70);

      // Get public URL
      const { data: urlData } = supabase.storage.from("reports").getPublicUrl(uploadData.path);

      // Create report record
      const res = await apiRequest("POST", "/api/reports", {
        title,
        source_org: sourceOrg || null,
        report_year: reportYear ? parseInt(reportYear) : null,
        report_type: reportType || null,
        region: region || null,
        file_url: urlData.publicUrl,
        file_type: fileExt,
        file_size_bytes: file.size,
      });

      setUploadProgress(100);
      toast({ title: "Report uploaded", description: "You can now process it to extract insights." });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Upload Industry Report</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div>
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. WEF Future of Jobs 2025"
          />
        </div>
        <div className="relative">
          <Label htmlFor="source_org">Source Organization</Label>
          <Input
            id="source_org"
            value={sourceOrg}
            onChange={(e) => { setSourceOrg(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="e.g. World Economic Forum"
          />
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md">
              {filteredSuggestions.map((s) => (
                <div
                  key={s}
                  className="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent"
                  onMouseDown={() => { setSourceOrg(s); setShowSuggestions(false); }}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="year">Year</Label>
            <Input
              id="year"
              type="number"
              value={reportYear}
              onChange={(e) => setReportYear(e.target.value)}
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>File (PDF or DOCX, max 50MB)</Label>
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              file ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={handleFileSelect}
            />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">({(file.size / 1048576).toFixed(1)} MB)</span>
              </div>
            ) : (
              <>
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Drop file here or click to browse</p>
              </>
            )}
          </div>
        </div>
        {uploading && (
          <Progress value={uploadProgress} className="h-2" />
        )}
      </div>
      <DialogFooter>
        <Button onClick={handleUpload} disabled={!file || !title || uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
          {uploading ? "Uploading..." : "Upload"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ==================== Report Detail ====================

function ReportDetail({ reportId, onBack }: { reportId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Phase processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState("");
  const [processedChunks, setProcessedChunks] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [failedPhase, setFailedPhase] = useState<string | null>(null);

  const { data: report, isLoading } = useQuery<Report>({
    queryKey: ["/api/reports", reportId],
    queryFn: async () => {
      const res = await authFetch(`/api/reports/${reportId}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
    refetchInterval: false,
  });

  const { data: skills } = useQuery<SkillMention[]>({
    queryKey: ["/api/reports", reportId, "skills"],
    queryFn: async () => {
      const res = await authFetch(`/api/reports/${reportId}/skills`);
      if (!res.ok) throw new Error("Failed to fetch skills");
      return res.json();
    },
    enabled: report?.processing_status === "completed",
  });

  const runProcessing = async () => {
    setIsProcessing(true);
    setFailedPhase(null);
    setPhaseLabel("Processing report...");
    setProcessedChunks(0);
    setTotalChunks(0);

    try {
      const res = await apiRequest("POST", `/api/reports/${reportId}/process`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Processing failed");
      }

      toast({ title: "Processing complete", description: "Report has been analyzed successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/reports", reportId] });
    } catch (err: any) {
      toast({ title: "Processing failed", description: err.message, variant: "destructive" });
      setFailedPhase(err.message);
      queryClient.invalidateQueries({ queryKey: ["/api/reports", reportId] });
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/reports/${reportId}`);
    },
    onSuccess: () => {
      toast({ title: "Report deleted" });
      onBack();
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !report) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusConf = STATUS_CONFIG[report.processing_status] || STATUS_CONFIG.pending;
  const StatusIcon = statusConf.icon;
  const typeLabel = REPORT_TYPES.find((t) => t.value === report.report_type)?.label || report.report_type || "—";
  const findings = report.key_findings || [];
  const tables = report.extracted_data?.tables || [];
  const stats = report.extracted_data?.stats || [];

  return (
    <div className="space-y-4" data-testid="report-detail">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{report.title}</h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
              {report.source_org && <span>{report.source_org}</span>}
              {report.report_year && <span>{report.report_year}</span>}
              <span>{typeLabel}</span>
              {report.region && <span>{report.region}</span>}
              <Badge variant="outline" className={isProcessing ? STATUS_CONFIG.processing.color : statusConf.color}>
                {isProcessing ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <StatusIcon className={`h-3 w-3 mr-1 ${report.processing_status === "processing" ? "animate-spin" : ""}`} />
                )}
                {isProcessing ? "Processing" : statusConf.label}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isProcessing && (report.processing_status === "pending" || report.processing_status === "error" || report.processing_status === "processing") && (
            <Button
              onClick={() => runProcessing()}
              data-testid="btn-process"
            >
              <Play className="h-4 w-4 mr-2" />
              {report.processing_status === "error" || report.processing_status === "processing" ? "Re-process" : "Process Report"}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            disabled={isProcessing}
            onClick={() => {
              if (confirm("Delete this report? This cannot be undone.")) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Processing Progress */}
      {isProcessing && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{phaseLabel}</span>
              {totalChunks > 0 && (
                <span className="text-sm text-muted-foreground">
                  Chunk {processedChunks} of {totalChunks}
                </span>
              )}
            </div>
            {totalChunks > 0 && (
              <Progress value={(processedChunks / totalChunks) * 100} className="h-2" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {!isProcessing && report.processing_status === "error" && report.error_message && (
        <Card className="border-destructive">
          <CardContent className="py-4 flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{report.error_message}</span>
          </CardContent>
        </Card>
      )}

      {/* Completed results */}
      {report.processing_status === "completed" && (
        <>
          {/* Executive Summary */}
          {report.summary && (
            <Accordion type="single" collapsible defaultValue="summary">
              <AccordionItem value="summary">
                <AccordionTrigger>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Executive Summary
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.summary}</p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Key Findings */}
          {findings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Key Findings ({findings.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {findings.map((f: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 py-1.5 border-b last:border-0">
                      <Badge variant="outline" className="text-xs shrink-0 mt-0.5">
                        {f.category || "general"}
                      </Badge>
                      <span className="text-sm">{f.finding}</span>
                      {f.confidence && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {Math.round(f.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Skill Mentions */}
          {skills && skills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Skill Mentions ({skills.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Skill</TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Rank</TableHead>
                      <TableHead>Data Point</TableHead>
                      <TableHead>Taxonomy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skills.map((skill) => {
                      const growth = skill.growth_indicator ? GROWTH_ICONS[skill.growth_indicator] : null;
                      const GrowthIcon = growth?.icon;
                      return (
                        <TableRow key={skill.id}>
                          <TableCell className="font-medium">{skill.skill_name}</TableCell>
                          <TableCell>
                            {growth && GrowthIcon ? (
                              <span className={`flex items-center gap-1 text-xs ${growth.color}`}>
                                <GrowthIcon className="h-3.5 w-3.5" />
                                {growth.label}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>{skill.ranking ?? "—"}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs">
                            {skill.data_point || "—"}
                          </TableCell>
                          <TableCell>
                            {skill.taxonomy_skill_id ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Extracted Tables */}
          {tables.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Extracted Tables ({tables.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {tables.map((t: any, i: number) => (
                  <div key={i}>
                    {t.title && <h4 className="text-sm font-medium mb-2">{t.title}</h4>}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Label</TableHead>
                          <TableHead>Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(t.rows || []).map((row: any, j: number) => (
                          <TableRow key={j}>
                            <TableCell className="text-sm">{row.label}</TableCell>
                            <TableCell className="text-sm">{row.value}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Stats */}
          {stats.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {stats.map((s: any, i: number) => (
                <Card key={i}>
                  <CardContent className="py-4">
                    <p className="text-xs text-muted-foreground">{s.metric}</p>
                    <p className="text-xl font-bold mt-1">{s.value}</p>
                    {s.context && <p className="text-xs text-muted-foreground mt-1">{s.context}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Pending state */}
      {!isProcessing && report.processing_status === "pending" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Report not yet processed</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Click "Process Report" to extract insights using AI
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
