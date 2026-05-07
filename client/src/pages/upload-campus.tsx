/**
 * client/src/pages/upload-campus.tsx
 * ─────────────────────────────────────────────────────────────────────
 * Bulk campus JD upload — Track D (jdenh001)
 *
 * 4-step flow:
 *   Step 1: Batch metadata (college, program, job type, drive year, etc.)
 *   Step 2: Multi-file dropzone (.pdf / .docx / .txt, up to 50 files)
 *   Step 3: Per-JD review table — editable company + role, accept checkbox
 *   Step 4: Commit + success summary
 */

import { useState, useCallback, useRef } from "react";
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
  ArrowRight, ArrowLeft, Upload, Building2,
} from "lucide-react";
import { authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

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

interface ReviewRow extends FileResult {
  edited_company_name: string;
  edited_role_title: string;
  accept: boolean;
}

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

// ─────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────

export default function UploadCampusPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step state
  const [step, setStep] = useState<Step>(1);

  // Step 1 — batch metadata
  const [collegeId, setCollegeId] = useState("");
  const [program, setProgram] = useState("");
  const [jobType, setJobType] = useState("");
  const [driveYear, setDriveYear] = useState<string>(String(new Date().getFullYear()));
  const [source, setSource] = useState("");
  const [ctcTag, setCtcTag] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [creatingBatch, setCreatingBatch] = useState(false);

  // Step 2 — file upload
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Step 3 — review
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);

  // Step 4 — commit
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{
    committed: number;
    skipped: number;
    errors_count: number;
    job_ids: string[];
    batch_id: string;
  } | null>(null);

  // Colleges list
  const { data: colleges, isLoading: collegesLoading } = useQuery<{ data: College[] }>({
    queryKey: ["/api/masters/colleges"],
    queryFn: async () => {
      const res = await authFetch("/api/masters/colleges?limit=200");
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

  // ── Step 2: File selection + upload ────────────────────────────

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const allowed = arr.filter((f) => {
      const lower = f.name.toLowerCase();
      return lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".txt");
    });
    if (allowed.length !== arr.length) {
      toast({
        title: "Some files skipped",
        description: "Only .pdf, .docx, and .txt files are supported.",
        variant: "destructive",
      });
    }
    if (allowed.length > 50) {
      toast({ title: "Too many files", description: "Maximum 50 files per upload.", variant: "destructive" });
      setSelectedFiles(allowed.slice(0, 50));
      return;
    }
    setSelectedFiles(allowed);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

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
        ...r,
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

  // ── Step 3: Review table edits ──────────────────────────────────

  const updateRow = (idx: number, field: "edited_company_name" | "edited_role_title" | "accept", value: string | boolean) => {
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
      const items = reviewRows.map((r) => ({
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
      });
      setStep(4);
    } catch (e: any) {
      toast({ title: "Commit failed", description: e.message, variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          Campus JD Bulk Upload
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a folder of JDs from a campus placement drive — extract, review, and commit to the jobs table.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {[
          { n: 1, label: "Batch details" },
          { n: 2, label: "Upload files" },
          { n: 3, label: "Review" },
          { n: 4, label: "Done" },
        ].map(({ n, label }, i) => (
          <span key={n} className="flex items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                step === n
                  ? "bg-primary text-primary-foreground"
                  : step > n
                  ? "bg-green-600 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step > n ? "✓" : n}
            </span>
            <span className={step === n ? "font-medium text-foreground" : ""}>{label}</span>
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
                    {colleges?.data?.map((c) => (
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
              <CardTitle className="text-sm">Step 2 — Upload JD Files</CardTitle>
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
                accept=".pdf,.docx,.txt"
                multiple
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
              <FileUp className="h-9 w-9 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">
                Drag & drop JD files here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Accepts .pdf, .docx, .txt · Max 50 files · Max 10 MB each
              </p>
            </div>

            {/* Selected files list */}
            {selectedFiles.length > 0 && (
              <div className="rounded-md border divide-y max-h-64 overflow-y-auto">
                {selectedFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-xs truncate max-w-[70%]">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                ))}
              </div>
            )}

            {/* Upload progress */}
            {uploading && (
              <div className="space-y-1.5">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {uploadProgress < 90 ? "Extracting text and running analysis…" : "Finalising…"}
                </p>
              </div>
            )}

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
                    <TableHead className="text-xs min-w-[160px]">Filename</TableHead>
                    <TableHead className="text-xs min-w-[160px]">Company</TableHead>
                    <TableHead className="text-xs min-w-[180px]">Role Title</TableHead>
                    <TableHead className="text-xs w-16">Skills</TableHead>
                    <TableHead className="text-xs w-16">Status</TableHead>
                    <TableHead className="text-xs w-16">Analyzer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewRows.map((row, idx) => (
                    <TableRow key={idx} className={row.accept ? "" : "opacity-50"}>
                      {/* Accept checkbox */}
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={row.accept}
                          disabled={row.status === "failed"}
                          onCheckedChange={(v) => updateRow(idx, "accept", !!v)}
                        />
                      </TableCell>

                      {/* Filename */}
                      <TableCell className="text-xs max-w-[180px]">
                        <span className="truncate block" title={row.filename}>{row.filename}</span>
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
              Batch Committed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-lg font-semibold">{commitResult.committed}</span>
                </div>
                <p className="text-xs text-muted-foreground">JDs committed</p>
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
              <p>
                <span className="font-medium">Jobs created:</span> {commitResult.committed}
              </p>
            </div>

            <div className="flex gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link href={`/jobs?upload_batch_id=${commitResult.batch_id}`}>
                  View Jobs from This Batch
                </Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Reset for a new batch
                  setStep(1);
                  setCollegeId("");
                  setProgram("");
                  setJobType("");
                  setDriveYear(String(new Date().getFullYear()));
                  setSource("");
                  setCtcTag("");
                  setBatchId(null);
                  setSelectedFiles([]);
                  setReviewRows([]);
                  setCommitResult(null);
                }}
              >
                Upload Another Batch
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
