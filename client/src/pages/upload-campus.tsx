/**
 * client/src/pages/upload-campus.tsx
 * ─────────────────────────────────────────────────────────────────────
 * Bulk campus JD upload — Track D (jdenh001) + Excel ingest v2 (campjdbcab)
 *
 * 4-step flow with two ingest modes:
 *   Mode "files":   Step 1 → Step 2 (multi-file pdf/docx/txt) → Step 3 review → Step 4 commit
 *   Mode "excel":   Step 1 → Step 2 (single .xlsx)
 *                          → Step 2.5 column mapping + track detection
 *                          → if Track A (full JD): Step 2.6 async progress polling
 *                                                  → Step 3 review (per-row) → Step 4 commit
 *                          → if Track B (vacancy log): Step 4 success
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  FileUp, Loader2, CheckCircle2, XCircle, AlertTriangle,
  ArrowRight, ArrowLeft, Upload, Building2, FileSpreadsheet,
} from "lucide-react";
import { authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 2.5 | 2.6 | 3 | 4;
type IngestMode = "files" | "excel";

const JOB_TYPES: { value: string; label: string }[] = [
  { value: "summer_internship", label: "Summer Internship" },
  { value: "full_time_placement", label: "Full-Time Placement" },
  { value: "ppo", label: "PPO (Pre-Placement Offer)" },
  { value: "other", label: "Other" },
];

interface College {
  id: string;
  name: string;
}

interface FileResult {
  filename: string;
  extracted: {
    company_name: string | null;
    role_title: string | null;
    jd_text_preview: string;
  };
  analyze_run_id: string;
  status: "succeeded" | "partial" | "failed";
  skill_count: number;
  was_partial: boolean;
  error?: string;
}

interface ReviewRow {
  // Source identifier — for file upload this is the filename, for excel this is "Row N — <raw_title>"
  label: string;
  // Excel-only fields (undefined for file-upload rows)
  excel_row_index?: number;
  raw_title?: string;
  raw_employer?: string | null;
  // Common
  analyze_run_id: string;
  status: "succeeded" | "partial" | "failed";
  was_partial: boolean;
  skill_count: number; // 0 for excel rows since /review doesn't return it directly; we read skills_extracted length
  error?: string;
  edited_company_name: string;
  edited_role_title: string;
  accept: boolean;
}

type DetectedTrack = "track_a_full_jd" | "track_b_vacancy_log" | "unknown";

interface ParseResponse {
  filename: string;
  sheet_name: string;
  total_rows: number;
  header_row_index: number;
  headers: string[];
  detected_track: DetectedTrack;
  column_mapping: Record<string, number | undefined>;
  preview_rows: Record<string, any>[];
}

interface WorkerStatus {
  batch_id: string;
  status: string;
  batch_type: string;
  total: number;
  ok: number;
  fail: number;
  remaining: number;
  percent: number;
  eta_min: number | null;
}

// All possible roles in a column mapping — drives the mapping UI
const ALL_ROLES: { key: string; label: string; required_for: ("A" | "B")[] }[] = [
  { key: "title", label: "Job / Vacancy Title", required_for: ["A", "B"] },
  { key: "employer", label: "Employer / Company", required_for: [] },
  { key: "description", label: "Description (full JD)", required_for: ["A"] },
  { key: "publishing_channel", label: "Publishing Channel", required_for: [] },
  { key: "start_date", label: "Start Date", required_for: [] },
  { key: "end_date", label: "End Date", required_for: [] },
];

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function statusBadge(status: "succeeded" | "partial" | "failed", was_partial: boolean) {
  if (status === "failed") {
    return <Badge variant="destructive" className="text-[10px]">failed</Badge>;
  }
  if (was_partial || status === "partial") {
    return <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-600">partial</Badge>;
  }
  return <Badge variant="default" className="text-[10px] bg-green-600">ok</Badge>;
}

function trackLabel(t: DetectedTrack): string {
  if (t === "track_a_full_jd") return "Full JD (will run AI analyze)";
  if (t === "track_b_vacancy_log") return "Vacancy log (title-only)";
  return "Unknown — please pick";
}

// ─────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────

export default function UploadCampusPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step state
  const [step, setStep] = useState<Step>(1);
  const [ingestMode, setIngestMode] = useState<IngestMode>("files");

  // Step 1 — batch metadata
  const [collegeId, setCollegeId] = useState("");
  const [program, setProgram] = useState("");
  const [jobType, setJobType] = useState("");
  const [driveYear, setDriveYear] = useState<string>(String(new Date().getFullYear()));
  const [source, setSource] = useState("");
  const [ctcTag, setCtcTag] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [creatingBatch, setCreatingBatch] = useState(false);

  // Step 2 — file upload (files mode)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Step 2 — Excel mode
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [activeTrack, setActiveTrack] = useState<"A" | "B" | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | undefined>>({});
  const [submittingExcel, setSubmittingExcel] = useState(false);

  // Step 2.6 — async worker polling (Track A excel)
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [polling, setPolling] = useState(false);

  // Step 3 — review
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [showAllRows, setShowAllRows] = useState(false);

  // Step 4 — commit
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{
    committed: number;
    skipped: number;
    errors_count: number;
    job_ids: string[];
    batch_id: string;
    track?: "files" | "track_a" | "track_b";
    total_rows?: number;
  } | null>(null);

  // Colleges list — /api/masters/colleges returns a raw College[] array, not {data:[]}.
  const { data: colleges, isLoading: collegesLoading } = useQuery<College[]>({
    queryKey: ["/api/masters/colleges"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/colleges");
      if (!res.ok) throw new Error("Failed to fetch colleges");
      return res.json();
    },
  });

  // ── Step 1: Create batch ────────────────────────────────────────

  const createBatch = async () => {
    if (!collegeId) {
      toast({ title: "College required", description: "Please select a college.", variant: "destructive" });
      return;
    }
    setCreatingBatch(true);
    try {
      const res = await authFetch("/api/campus-upload/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          college_id: collegeId,
          program: program || undefined,
          job_type: jobType || undefined,
          drive_year: driveYear ? Number(driveYear) : undefined,
          source: source || undefined,
          ctc_tag: ctcTag || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setBatchId(json.batch.id);
      setStep(2);
    } catch (e: any) {
      toast({ title: "Failed to create batch", description: e.message, variant: "destructive" });
    } finally {
      setCreatingBatch(false);
    }
  };

  // ── Step 2: File selection ──────────────────────────────────────

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);

    // If a single .xlsx/.xls is dropped, switch to excel mode
    if (arr.length === 1 && /\.(xlsx|xls)$/i.test(arr[0].name)) {
      setIngestMode("excel");
      setExcelFile(arr[0]);
      setSelectedFiles([]);
      setParseResult(null);
      return;
    }

    // Otherwise, files mode: pdf/docx/txt
    const allowed = arr.filter((f) => {
      const lower = f.name.toLowerCase();
      return lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".txt");
    });
    if (allowed.length !== arr.length) {
      toast({
        title: "Some files skipped",
        description: "Only .pdf, .docx, .txt (or a single .xlsx) are supported.",
        variant: "destructive",
      });
    }
    if (allowed.length > 50) {
      toast({ title: "Too many files", description: "Maximum 50 files per upload.", variant: "destructive" });
      setIngestMode("files");
      setExcelFile(null);
      setSelectedFiles(allowed.slice(0, 50));
      return;
    }
    setIngestMode("files");
    setExcelFile(null);
    setSelectedFiles(allowed);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  // ── Step 2 (files mode): Upload PDF/DOCX/TXT files ──────────────

  const uploadFiles = async () => {
    if (!batchId || selectedFiles.length === 0) return;
    setUploading(true);
    setUploadProgress(10);

    try {
      const formData = new FormData();
      for (const f of selectedFiles) {
        formData.append("files", f, f.name);
      }

      setUploadProgress(30);

      const res = await authFetch(`/api/campus-upload/batch/${batchId}/files`, {
        method: "POST",
        body: formData,
      });

      setUploadProgress(90);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      const rows: ReviewRow[] = (json.files || []).map((r: FileResult) => ({
        label: r.filename,
        analyze_run_id: r.analyze_run_id,
        status: r.status,
        was_partial: r.was_partial,
        skill_count: r.skill_count,
        error: r.error,
        edited_company_name: r.extracted.company_name || "",
        edited_role_title: r.extracted.role_title || "",
        accept: r.status !== "failed",
      }));
      setReviewRows(rows);
      setUploadProgress(100);
      setStep(3);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // ── Step 2 (excel mode): Parse the .xlsx ────────────────────────

  const parseExcel = async () => {
    if (!excelFile) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", excelFile, excelFile.name);
      const res = await authFetch(`/api/campus-upload/excel/parse`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json: ParseResponse = await res.json();
      setParseResult(json);
      setMapping(json.column_mapping || {});
      setActiveTrack(
        json.detected_track === "track_a_full_jd"
          ? "A"
          : json.detected_track === "track_b_vacancy_log"
          ? "B"
          : null
      );
      setStep(2.5);
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  // ── Step 2.5: Submit mapping (Track A enqueue OR Track B commit) ─

  const submitExcel = async () => {
    if (!excelFile || !parseResult || !batchId || !activeTrack) return;

    // Validate required mappings
    const required = activeTrack === "A" ? ["title", "description"] : ["title"];
    for (const r of required) {
      if (mapping[r] === undefined || mapping[r] === null || (mapping[r] as number) < 0) {
        toast({
          title: "Missing column mapping",
          description: `Track ${activeTrack} requires a column for '${r}'.`,
          variant: "destructive",
        });
        return;
      }
    }

    setSubmittingExcel(true);
    try {
      const fd = new FormData();
      fd.append("file", excelFile, excelFile.name);
      fd.append("batch_id", batchId);
      fd.append("mapping", JSON.stringify(mapping));
      fd.append("header_row_index", String(parseResult.header_row_index));

      const endpoint =
        activeTrack === "A"
          ? "/api/campus-upload/excel/enqueue"
          : "/api/campus-upload/vacancy-log/commit";

      const res = await authFetch(endpoint, { method: "POST", body: fd });
      if (!res.ok && res.status !== 202) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();

      if (activeTrack === "A") {
        // Async — go to progress screen
        setStep(2.6);
        setWorkerStatus(null);
        setPolling(true);
        toast({
          title: "Tasks enqueued",
          description: `${json.enqueued} rows queued for AI analysis. Polling for progress…`,
        });
      } else {
        // Track B — synchronous commit, jump to success
        setCommitResult({
          committed: json.committed,
          skipped: json.skipped || 0,
          errors_count: 0,
          job_ids: [],
          batch_id: batchId,
          track: "track_b",
          total_rows: json.total_rows,
        });
        setStep(4);
      }
    } catch (e: any) {
      toast({ title: "Submit failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmittingExcel(false);
    }
  };

  // ── Step 2.6: Poll worker status for Track A async ──────────────

  useEffect(() => {
    if (!polling || !batchId || step !== 2.6) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await authFetch(
          `/api/admin/campus-excel-worker/status?batch_id=${batchId}`
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json: WorkerStatus = await res.json();
        if (cancelled) return;
        setWorkerStatus(json);

        // Done when all rows finished (ok+fail == total) and no remaining
        if (json.total > 0 && json.remaining === 0) {
          setPolling(false);
          // Fetch review rows
          await loadExcelReview(batchId);
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error("[upload-campus] status poll failed:", e?.message);
        }
      }
    };

    tick(); // immediate first call
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [polling, batchId, step]);

  // Load excel-batch review rows after worker completes
  const loadExcelReview = async (bId: string) => {
    try {
      const res = await authFetch(`/api/campus-upload/batch/${bId}/review`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const tasks: any[] = json.excel_tasks || [];
      const runs: any[] = json.runs || [];
      const runById = new Map<string, any>(runs.map((r) => [r.id, r]));

      const rows: ReviewRow[] = tasks.map((t) => {
        const run = t.analyze_run_id ? runById.get(t.analyze_run_id) : null;
        const status: "succeeded" | "partial" | "failed" =
          t.status === "succeeded"
            ? "succeeded"
            : t.status === "failed"
            ? "failed"
            : "partial";
        const wasPartial = run?.was_partial === true;
        const skillCount = Array.isArray(run?.skills_extracted)
          ? run.skills_extracted.length
          : 0;
        return {
          label: `Row ${t.excel_row_index} — ${t.raw_title || "(no title)"}`,
          excel_row_index: t.excel_row_index,
          raw_title: t.raw_title,
          raw_employer: t.raw_employer,
          analyze_run_id: t.analyze_run_id || "",
          status,
          was_partial: wasPartial,
          skill_count: skillCount,
          error: t.error_message,
          edited_company_name: t.raw_employer || "",
          edited_role_title: t.raw_title || "",
          accept: status !== "failed",
        };
      });
      setReviewRows(rows);
      setStep(3);
    } catch (e: any) {
      toast({ title: "Failed to load review", description: e.message, variant: "destructive" });
    }
  };

  // ── Step 3: Review table edits ──────────────────────────────────

  const updateRow = (
    idx: number,
    field: "edited_company_name" | "edited_role_title" | "accept",
    value: string | boolean
  ) => {
    setReviewRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const toggleAllAccepted = (accept: boolean) => {
    setReviewRows((prev) =>
      prev.map((r) => ({ ...r, accept: r.status === "failed" ? false : accept }))
    );
  };

  const acceptedCount = reviewRows.filter((r) => r.accept).length;

  // ── Step 4: Commit ──────────────────────────────────────────────

  const commitBatch = async () => {
    if (!batchId) return;
    setCommitting(true);
    try {
      const items = reviewRows
        .filter((r) => r.analyze_run_id) // skip rows without a run (e.g. failed excel tasks)
        .map((r) => ({
          analyze_run_id: r.analyze_run_id,
          edited_company_name: r.edited_company_name || undefined,
          edited_role_title: r.edited_role_title || undefined,
          accept: r.accept,
        }));

      const res = await authFetch(`/api/campus-upload/batch/${batchId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setCommitResult({
        committed: json.committed,
        skipped: json.skipped,
        errors_count: json.errors_count,
        job_ids: json.job_ids || [],
        batch_id: batchId,
        track: ingestMode === "excel" ? "track_a" : "files",
      });
      setStep(4);
    } catch (e: any) {
      toast({ title: "Commit failed", description: e.message, variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  };

  const resetForNewBatch = () => {
    setStep(1);
    setIngestMode("files");
    setCollegeId("");
    setProgram("");
    setJobType("");
    setDriveYear(String(new Date().getFullYear()));
    setSource("");
    setCtcTag("");
    setBatchId(null);
    setSelectedFiles([]);
    setExcelFile(null);
    setParseResult(null);
    setActiveTrack(null);
    setMapping({});
    setWorkerStatus(null);
    setPolling(false);
    setReviewRows([]);
    setShowAllRows(false);
    setCommitResult(null);
  };

  // Visible rows in Step 3 (soft-cap at 100 unless user expands)
  const visibleRows = showAllRows ? reviewRows : reviewRows.slice(0, 100);
  const hiddenCount = reviewRows.length - visibleRows.length;

  // ── Render ──────────────────────────────────────────────────────

  // Friendly numeric step for the indicator. Steps 2, 2.5, 2.6 all map to the
  // "Upload" pill; step 3 to "Review"; step 4 to "Done".
  const indicatorStep =
    step === 1 ? 1
    : step < 3 ? 2
    : step === 3 ? 3
    : 4;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          Campus JD Bulk Upload
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload PDFs/DOCX/TXT, or an Excel sheet (full JDs or vacancy log).
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {[
          { n: 1, label: "Batch details" },
          { n: 2, label: "Upload" },
          { n: 3, label: "Review" },
          { n: 4, label: "Done" },
        ].map(({ n, label }, i) => (
          <span key={n} className="flex items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                indicatorStep === n
                  ? "bg-primary text-primary-foreground"
                  : indicatorStep > n
                  ? "bg-green-600 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {indicatorStep > n ? "✓" : n}
            </span>
            <span className={indicatorStep === n ? "font-medium text-foreground" : ""}>{label}</span>
            {i < 3 && <ArrowRight className="h-3 w-3" />}
          </span>
        ))}
      </div>

      {/* ══════════ STEP 1: Batch metadata ══════════ */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Step 1 — Batch Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* College */}
              <div className="space-y-1.5">
                <Label className="text-xs">College *</Label>
                <Select value={collegeId} onValueChange={setCollegeId} disabled={collegesLoading}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder={collegesLoading ? "Loading…" : "Select college"} />
                  </SelectTrigger>
                  <SelectContent>
                    {colleges?.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Program */}
              <div className="space-y-1.5">
                <Label className="text-xs">Program (optional)</Label>
                <Input
                  className="text-xs h-9"
                  placeholder="e.g. MBA Class of 2027"
                  value={program}
                  onChange={(e) => setProgram(e.target.value)}
                />
              </div>

              {/* Job type */}
              <div className="space-y-1.5">
                <Label className="text-xs">Job Type</Label>
                <Select value={jobType} onValueChange={setJobType}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder="Select type (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_TYPES.map((jt) => (
                      <SelectItem key={jt.value} value={jt.value} className="text-xs">{jt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Drive year */}
              <div className="space-y-1.5">
                <Label className="text-xs">Drive Year</Label>
                <Input
                  className="text-xs h-9"
                  type="number"
                  min={2020}
                  max={2035}
                  value={driveYear}
                  onChange={(e) => setDriveYear(e.target.value)}
                />
              </div>

              {/* Source */}
              <div className="space-y-1.5">
                <Label className="text-xs">Source Tag (optional)</Label>
                <Input
                  className="text-xs h-9"
                  placeholder="e.g. Naukri bulk export"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </div>

              {/* CTC tag */}
              <div className="space-y-1.5">
                <Label className="text-xs">CTC Tag (optional)</Label>
                <Input
                  className="text-xs h-9"
                  placeholder="e.g. ₹6-12 LPA"
                  value={ctcTag}
                  onChange={(e) => setCtcTag(e.target.value)}
                />
              </div>
            </div>

            <Button
              size="sm"
              onClick={createBatch}
              disabled={creatingBatch || !collegeId}
              className="mt-2"
            >
              {creatingBatch ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating…</>
              ) : (
                <>Continue <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ══════════ STEP 2: File upload ══════════ */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Step 2 — Upload JD Files or Excel Sheet</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3 w-3 mr-1" />Back
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Batch ID: <code className="font-mono text-[10px] bg-muted px-1 rounded">{batchId}</code>
            </p>

            {/* Dropzone */}
            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/50"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.xlsx,.xls"
                multiple
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
              <FileUp className="h-9 w-9 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">
                Drag & drop JD files here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Multiple .pdf / .docx / .txt (max 50, 10 MB each) — or a single .xlsx (max 5000 rows)
              </p>
            </div>

            {/* Excel mode preview */}
            {ingestMode === "excel" && excelFile && (
              <div className="rounded-md border bg-muted/30 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">{excelFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(excelFile.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-7"
                  onClick={() => {
                    setExcelFile(null);
                    setIngestMode("files");
                  }}
                >
                  Remove
                </Button>
              </div>
            )}

            {/* Selected files list (files mode) */}
            {ingestMode === "files" && selectedFiles.length > 0 && (
              <div className="rounded-md border divide-y max-h-64 overflow-y-auto">
                {selectedFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-xs truncate max-w-[70%]">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                ))}
              </div>
            )}

            {/* Upload progress (files mode) */}
            {uploading && (
              <div className="space-y-1.5">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {uploadProgress < 90 ? "Extracting text and running analysis…" : "Finalising…"}
                </p>
              </div>
            )}

            {/* Action button — branches by ingest mode */}
            {ingestMode === "excel" && excelFile ? (
              <Button size="sm" onClick={parseExcel} disabled={parsing}>
                {parsing ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Parsing Excel…</>
                ) : (
                  <><FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />Analyze Excel</>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={uploadFiles}
                disabled={uploading || selectedFiles.length === 0}
              >
                {uploading ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Uploading…</>
                ) : (
                  <><Upload className="h-3.5 w-3.5 mr-1.5" />Upload {selectedFiles.length > 0 ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""}` : "Files"}</>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ══════════ STEP 2.5: Excel column mapping ══════════ */}
      {step === 2.5 && parseResult && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                Step 2 — Excel Column Mapping
                <span className="ml-2 text-muted-foreground font-normal text-xs">
                  {parseResult.filename} · {parseResult.sheet_name} · {parseResult.total_rows} rows
                </span>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setStep(2)}
              >
                <ArrowLeft className="h-3 w-3 mr-1" />Back
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Track selector */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <Label className="text-xs">Ingest track</Label>
              <p className="text-[11px] text-muted-foreground">
                Detected: <span className="font-medium text-foreground">{trackLabel(parseResult.detected_track)}</span>
              </p>
              <div className="flex gap-2 mt-1">
                <Button
                  size="sm"
                  variant={activeTrack === "A" ? "default" : "outline"}
                  className="text-xs h-7"
                  onClick={() => setActiveTrack("A")}
                >
                  Track A — Full JD (AI analyze)
                </Button>
                <Button
                  size="sm"
                  variant={activeTrack === "B" ? "default" : "outline"}
                  className="text-xs h-7"
                  onClick={() => setActiveTrack("B")}
                >
                  Track B — Vacancy log
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Track A queues every row for AI extraction (slow but full skills). Track B
                inserts titles directly into the vacancy log (fast, no AI).
              </p>
            </div>

            {/* Column mapping */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALL_ROLES.map((role) => {
                const required = activeTrack && role.required_for.includes(activeTrack);
                const currentIdx = mapping[role.key];
                return (
                  <div key={role.key} className="space-y-1">
                    <Label className="text-xs">
                      {role.label}
                      {required && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    <Select
                      value={currentIdx === undefined || currentIdx < 0 ? "__none__" : String(currentIdx)}
                      onValueChange={(v) => {
                        setMapping((prev) => ({
                          ...prev,
                          [role.key]: v === "__none__" ? undefined : Number(v),
                        }));
                      }}
                    >
                      <SelectTrigger className="text-xs h-8">
                        <SelectValue placeholder="— not mapped —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs">— not mapped —</SelectItem>
                        {parseResult.headers.map((h, i) => (
                          <SelectItem key={i} value={String(i)} className="text-xs">
                            Col {i + 1}: {h || `(blank)`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>

            {/* Preview */}
            <div className="space-y-1.5">
              <Label className="text-xs">First 5 rows preview</Label>
              <div className="rounded-md border overflow-x-auto max-h-[260px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {parseResult.headers.map((h, i) => (
                        <TableHead key={i} className="text-[10px] whitespace-nowrap">
                          {h || `(blank ${i + 1})`}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseResult.preview_rows.map((row, ri) => (
                      <TableRow key={ri}>
                        {parseResult.headers.map((h, ci) => (
                          <TableCell key={ci} className="text-[10px] max-w-[200px] truncate">
                            {row[h || `col_${ci}`] !== undefined && row[h || `col_${ci}`] !== null
                              ? String(row[h || `col_${ci}`]).slice(0, 80)
                              : ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <Button
              size="sm"
              onClick={submitExcel}
              disabled={submittingExcel || !activeTrack}
            >
              {submittingExcel ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Submitting…</>
              ) : activeTrack === "A" ? (
                <>Start AI analysis for {parseResult.total_rows} rows <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></>
              ) : (
                <>Commit {parseResult.total_rows} rows to vacancy log <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ══════════ STEP 2.6: Async worker progress (Track A) ══════════ */}
      {step === 2.6 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Running AI analysis on your Excel rows
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Batch ID:{" "}
              <code className="font-mono text-[10px] bg-muted px-1 rounded">{batchId}</code>
            </p>

            {workerStatus ? (
              <>
                <Progress value={workerStatus.percent} className="h-2" />
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <div className="text-lg font-semibold">{workerStatus.total}</div>
                    <p className="text-[10px] text-muted-foreground">Total</p>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-green-600">{workerStatus.ok}</div>
                    <p className="text-[10px] text-muted-foreground">Succeeded</p>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-red-500">{workerStatus.fail}</div>
                    <p className="text-[10px] text-muted-foreground">Failed</p>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{workerStatus.remaining}</div>
                    <p className="text-[10px] text-muted-foreground">Remaining</p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground text-center">
                  {workerStatus.percent}% complete
                  {workerStatus.eta_min !== null && workerStatus.eta_min > 0
                    ? ` · ETA ~${workerStatus.eta_min} min`
                    : ""}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                Connecting to worker…
              </p>
            )}

            <p className="text-[11px] text-muted-foreground">
              You can leave this page open — the worker runs server-side. We'll auto-jump to the
              review screen when all rows are processed.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ══════════ STEP 3: Review table ══════════ */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                Step 3 — Review Extracted JDs
                <span className="ml-2 text-muted-foreground font-normal text-xs">
                  ({acceptedCount} of {reviewRows.length} accepted)
                </span>
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => toggleAllAccepted(true)}>
                  Accept all
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => toggleAllAccepted(false)}>
                  Clear all
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setStep(2)}>
                  <ArrowLeft className="h-3 w-3 mr-1" />Back
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-8 pl-4">✓</TableHead>
                    <TableHead className="text-xs min-w-[200px]">
                      {ingestMode === "excel" ? "Excel Row" : "Filename"}
                    </TableHead>
                    <TableHead className="text-xs min-w-[160px]">Company</TableHead>
                    <TableHead className="text-xs min-w-[180px]">Role Title</TableHead>
                    <TableHead className="text-xs w-16">Skills</TableHead>
                    <TableHead className="text-xs w-16">Status</TableHead>
                    <TableHead className="text-xs w-16">Analyzer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row, idx) => (
                    <TableRow key={idx} className={row.accept ? "" : "opacity-50"}>
                      {/* Accept checkbox */}
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={row.accept}
                          disabled={row.status === "failed"}
                          onCheckedChange={(v) => updateRow(idx, "accept", !!v)}
                        />
                      </TableCell>

                      {/* Label (filename or excel row) */}
                      <TableCell className="text-xs max-w-[220px]">
                        <span className="truncate block" title={row.label}>{row.label}</span>
                        {row.error && (
                          <span className="text-[10px] text-red-500 block truncate" title={row.error}>{row.error}</span>
                        )}
                      </TableCell>

                      {/* Editable company */}
                      <TableCell>
                        <Input
                          value={row.edited_company_name}
                          onChange={(e) => updateRow(idx, "edited_company_name", e.target.value)}
                          className="text-xs h-7 min-w-[130px]"
                          placeholder="Company name"
                          disabled={!row.accept}
                        />
                      </TableCell>

                      {/* Editable role title */}
                      <TableCell>
                        <Input
                          value={row.edited_role_title}
                          onChange={(e) => updateRow(idx, "edited_role_title", e.target.value)}
                          className="text-xs h-7 min-w-[160px]"
                          placeholder="Role title"
                          disabled={!row.accept}
                        />
                      </TableCell>

                      {/* Skill count */}
                      <TableCell className="text-xs text-center">
                        {row.skill_count}
                      </TableCell>

                      {/* Status badge */}
                      <TableCell>
                        {statusBadge(row.status, row.was_partial)}
                      </TableCell>

                      {/* Link to JD analyzer view */}
                      <TableCell>
                        {row.analyze_run_id && (
                          <Link
                            href={`/jd-analyzer?run_id=${row.analyze_run_id}`}
                            className="text-[10px] text-primary underline-offset-2 hover:underline"
                          >
                            Why?
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {hiddenCount > 0 && (
              <div className="p-3 border-t text-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setShowAllRows(true)}
                >
                  Show remaining {hiddenCount} rows
                </Button>
              </div>
            )}

            <div className="p-4 border-t flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {acceptedCount} JD{acceptedCount !== 1 ? "s" : ""} will be committed to the jobs table.
              </p>
              <Button
                size="sm"
                onClick={commitBatch}
                disabled={committing || acceptedCount === 0}
              >
                {committing ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Committing…</>
                ) : (
                  <>Commit {acceptedCount} JD{acceptedCount !== 1 ? "s" : ""} <ArrowRight className="h-3.5 w-3.5 ml-1.5" /></>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══════════ STEP 4: Success ══════════ */}
      {step === 4 && commitResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              {commitResult.track === "track_b" ? "Vacancy Log Committed" : "Batch Committed"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-lg font-semibold">{commitResult.committed}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {commitResult.track === "track_b" ? "Vacancies inserted" : "JDs committed"}
                </p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                  <span className="text-lg font-semibold">{commitResult.skipped}</span>
                </div>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-lg font-semibold">{commitResult.errors_count}</span>
                </div>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>

            <div className="rounded-md bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p>
                <span className="font-medium">Batch ID:</span>{" "}
                <code className="font-mono text-[10px] bg-muted px-1 rounded">{commitResult.batch_id}</code>
              </p>
              {commitResult.total_rows !== undefined && (
                <p>
                  <span className="font-medium">Source rows:</span> {commitResult.total_rows}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              {commitResult.track === "track_b" ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/admin/campus-vacancies?batch_id=${commitResult.batch_id}`}>
                    View Vacancies
                  </Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/jobs?upload_batch_id=${commitResult.batch_id}`}>
                    View Jobs from This Batch
                  </Link>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={resetForNewBatch}>
                Upload Another Batch
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
