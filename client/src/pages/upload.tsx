import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, Download, FileUp, CheckCircle2, XCircle, AlertTriangle, Loader2, History, Eye } from "lucide-react";
import { apiRequest, authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CsvUpload } from "@shared/schema";

type SourceType = "clay_linkedin" | "google_jobs" | "custom";
type UploadState = "idle" | "file_selected" | "previewing" | "uploading" | "completed" | "failed";

const COLUMN_MAPPINGS: Record<SourceType, Record<string, string>> = {
  clay_linkedin: {
    "Job Title": "title",
    "Job Id": "external_id",
    "Job Post - LinkedIn": "source_url",
    "Company Name": "company_name",
    "Company URL": "companies.domain",
    "Company LinkedIn Page": "companies.linkedin_url",
    "Location": "location_raw",
    "Posted On": "posted_at",
    "Seniority": "seniority_level",
  },
  google_jobs: {
    "job_title": "title",
    "job_id": "external_id",
    "employer_name": "company_name",
    "employer_website": "companies.domain",
    "employer_logo": "companies.logo_url",
    "job_description": "description",
    "job_employment_type": "employment_type",
    "job_apply_link": "application_url",
    "job_location": "location_raw",
    "job_city": "location_city",
    "job_state": "location_state",
    "job_country": "location_country",
    "job_posted_at_datetime_utc": "posted_at",
    "job_min_salary": "salary_min",
    "job_max_salary": "salary_max",
    "job_salary_period": "salary_unit",
    "job_google_link": "source_url",
    "job_onet_soc": "raw_data.onet_soc",
    "search_query": "raw_data.search_query",
  },
  custom: {
    "title": "title",
    "external_id": "external_id",
    "company_name": "company_name",
    "location": "location_raw",
    "posted_at": "posted_at",
    "source_url": "source_url",
    "description": "description",
    "employment_type": "employment_type",
    "seniority_level": "seniority_level",
  },
};

const REQUIRED_COLUMNS: Record<SourceType, string[]> = {
  clay_linkedin: ["Job Title", "Job Id"],
  google_jobs: ["job_title", "job_id"],
  custom: ["title", "external_id"],
};

const CHUNK_SIZE = 100;

interface UploadStats {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  errors: Array<{ row_index: number; error: string; raw?: Record<string, unknown> }>;
}

interface UploadDetailData {
  id: string;
  filename: string;
  source_type: string;
  total_rows: number;
  processed_rows: number;
  skipped_rows: number;
  failed_rows: number;
  error_log: Array<{ row_index: number; error: string; raw?: Record<string, unknown> }>;
  status: string;
  uploaded_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export default function UploadPage() {
  const queryClient = useQueryClient();
  const { data: uploadHistory, isLoading: historyLoading } = useQuery<{ data: CsvUpload[]; total: number }>({
    queryKey: ["/api/csv-uploads"],
    queryFn: async () => {
      const res = await authFetch("/api/csv-uploads?limit=20");
      if (!res.ok) throw new Error("Failed to fetch upload history");
      return res.json();
    },
  });

  const [sourceType, setSourceType] = useState<SourceType>("clay_linkedin");
  const [state, setState] = useState<UploadState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [stats, setStats] = useState<UploadStats>({ processed: 0, skipped: 0, failed: 0, total: 0, errors: [] });
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Upload detail dialog state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<UploadDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setState("file_selected");

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as any[];
        const hdrs = results.meta.fields || [];
        setHeaders(hdrs);
        setParsedData(data);
        setState("previewing");

        // Check for required columns
        const missing = REQUIRED_COLUMNS[sourceType].filter(col => !hdrs.includes(col));
        if (missing.length > 0) {
          toast({
            title: "Missing required columns",
            description: `The following columns are missing: ${missing.join(", ")}`,
            variant: "destructive",
          });
        }
      },
      error: (error) => {
        toast({ title: "CSV Parse Error", description: error.message, variant: "destructive" });
        setState("idle");
      },
    });
  }, [sourceType, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith(".csv")) {
      handleFileSelect(droppedFile);
    } else {
      toast({ title: "Invalid file", description: "Please drop a .csv file", variant: "destructive" });
    }
  }, [handleFileSelect, toast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFileSelect(selectedFile);
  }, [handleFileSelect]);

  const downloadTemplate = async () => {
    try {
      const res = await authFetch(`/api/upload/template/${sourceType}`);
      if (!res.ok) throw new Error("Failed to download template");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `template_${sourceType}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

  const startUpload = async () => {
    if (parsedData.length === 0) return;
    setState("uploading");
    const batches = Math.ceil(parsedData.length / CHUNK_SIZE);
    setTotalBatches(batches);
    setCurrentBatch(0);
    setStats({ processed: 0, skipped: 0, failed: 0, total: parsedData.length, errors: [] });

    try {
      // Start upload session
      const startRes = await apiRequest("POST", "/api/upload/start", {
        filename: file?.name || "upload.csv",
        source_type: sourceType,
        total_rows: parsedData.length,
      });
      const { upload_id } = await startRes.json();
      setUploadId(upload_id);

      // Send batches in background — sequential loop, non-blocking UI updates
      sendBatchesInBackground(upload_id, parsedData, sourceType, batches);
    } catch (err: any) {
      setState("failed");
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  };

  const sendBatchesInBackground = async (
    uploadIdVal: string,
    data: any[],
    source: SourceType,
    batches: number,
  ) => {
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    const allErrors: any[] = [];

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
      setCurrentBatch(batchNum);
      const chunk = data.slice(i, i + CHUNK_SIZE);

      let batchResult: any = null;
      let retried = false;

      // Try sending batch, retry once on failure
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const batchRes = await apiRequest("POST", "/api/upload/batch", {
            upload_id: uploadIdVal,
            source_type: source,
            rows: chunk,
          });
          batchResult = (await batchRes.json()).batch_result;
          break;
        } catch (err: any) {
          if (attempt === 0) {
            retried = true;
            continue;
          }
          // Second attempt failed — count all rows in batch as failed
          batchResult = {
            processed: 0,
            skipped: 0,
            failed: chunk.length,
            errors: chunk.map((_, idx) => ({
              row_index: i + idx,
              error: `Batch failed: ${err.message}`,
            })),
          };
        }
      }

      totalProcessed += batchResult.processed;
      totalSkipped += batchResult.skipped;
      totalFailed += batchResult.failed;
      allErrors.push(...(batchResult.errors || []));

      setStats({
        processed: totalProcessed,
        skipped: totalSkipped,
        failed: totalFailed,
        total: data.length,
        errors: allErrors,
      });
    }

    // Upload complete
    setState(totalFailed > totalProcessed ? "failed" : "completed");
    queryClient.invalidateQueries({ queryKey: ["/api/csv-uploads"] });
    toast({
      title: totalFailed > totalProcessed ? "Upload completed with errors" : "Upload completed",
      description: `${totalProcessed} processed, ${totalSkipped} skipped, ${totalFailed} failed`,
      variant: totalFailed > totalProcessed ? "destructive" : "default",
    });
  };

  const reset = () => {
    setState("idle");
    setFile(null);
    setParsedData([]);
    setHeaders([]);
    setStats({ processed: 0, skipped: 0, failed: 0, total: 0, errors: [] });
    setUploadId(null);
    setCurrentBatch(0);
    setTotalBatches(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Open upload detail dialog
  const openUploadDetail = async (uploadIdVal: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await authFetch(`/api/csv-uploads/${uploadIdVal}/errors`);
      if (!res.ok) throw new Error("Failed to fetch upload details");
      setDetailData(await res.json());
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // Download failed rows as CSV
  const downloadFailedRows = () => {
    if (!detailData?.error_log?.length) return;
    const rows = detailData.error_log.map((err) => {
      const raw = err.raw || {};
      return {
        row_number: err.row_index,
        error: err.error,
        title: (raw as any).title || (raw as any)["Job Title"] || (raw as any).job_title || "",
        company: (raw as any).company_name || (raw as any)["Company Name"] || (raw as any).employer_name || "",
        external_id: (raw as any).external_id || (raw as any)["Job Id"] || (raw as any).job_id || "",
      };
    });
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `failed_rows_${detailData.filename || "upload"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mapping = COLUMN_MAPPINGS[sourceType];
  const previewRows = parsedData.slice(0, 10);
  const progressPct = stats.total > 0 ? Math.round(((stats.processed + stats.skipped + stats.failed) / stats.total) * 100) : 0;

  return (
    <div className="space-y-6" data-testid="upload-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload CSV Data</h1>
        <p className="text-sm text-muted-foreground">
          Import job listings from CSV files into the Nexus database
        </p>
      </div>

      {/* Source Type Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Source Type</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={sourceType}
            onValueChange={(v) => {
              setSourceType(v as SourceType);
              if (state !== "idle") reset();
            }}
            className="flex gap-6"
            disabled={state === "uploading"}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="clay_linkedin" id="clay" />
              <Label htmlFor="clay" className="text-sm cursor-pointer">Clay LinkedIn</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="google_jobs" id="google" />
              <Label htmlFor="google" className="text-sm cursor-pointer">Google Jobs</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="custom" id="custom" />
              <Label htmlFor="custom" className="text-sm cursor-pointer">Custom</Label>
            </div>
          </RadioGroup>
          <Button variant="outline" size="sm" onClick={downloadTemplate} className="text-xs">
            <Download className="h-3.5 w-3.5 mr-1" />
            Download CSV Template
          </Button>
        </CardContent>
      </Card>

      {/* Drop Zone */}
      {(state === "idle" || state === "file_selected") && (
        <Card>
          <CardContent className="pt-6">
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/50"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleInputChange}
              />
              <FileUp className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">
                Drag & drop .csv here, or click to browse files
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Supports up to 50,000 rows per file
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {state === "previewing" && headers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                Column Mapping Preview — {parsedData.length.toLocaleString()} rows detected
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={reset} className="text-xs">
                  Cancel
                </Button>
                <Button size="sm" onClick={startUpload} className="text-xs">
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Start Upload
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold min-w-[140px]">CSV Column</TableHead>
                    <TableHead className="text-xs font-semibold min-w-[140px]">Maps To</TableHead>
                    <TableHead className="text-xs font-semibold min-w-[200px]">Sample 1</TableHead>
                    <TableHead className="text-xs font-semibold min-w-[200px]">Sample 2</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {headers.map((header) => {
                    const target = mapping[header];
                    const isRequired = REQUIRED_COLUMNS[sourceType].includes(header);
                    const isMapped = !!target;
                    return (
                      <TableRow key={header}>
                        <TableCell className={`text-xs ${isRequired && !isMapped ? "text-red-500 font-medium" : ""}`}>
                          {header}
                          {isRequired && <span className="text-red-500 ml-1">*</span>}
                        </TableCell>
                        <TableCell className={`text-xs ${isMapped ? "text-green-700 dark:text-green-400" : "text-muted-foreground italic"}`}>
                          {target || "—unmapped—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {previewRows[0]?.[header] ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {previewRows[1]?.[header] ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      {(state === "uploading" || state === "completed" || state === "failed") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              {state === "uploading" && <Loader2 className="h-4 w-4 animate-spin" />}
              {state === "completed" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              {state === "failed" && <XCircle className="h-4 w-4 text-red-500" />}
              {state === "uploading" ? "Uploading..." : state === "completed" ? "Upload Complete" : "Upload Failed"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {state === "uploading" && totalBatches > 0
                    ? `Processing batch ${currentBatch}/${totalBatches} — ${(stats.processed + stats.skipped + stats.failed).toLocaleString()}/${stats.total.toLocaleString()} rows processed`
                    : "Progress"}
                </span>
                <span>{(stats.processed + stats.skipped + stats.failed).toLocaleString()} / {stats.total.toLocaleString()} rows</span>
              </div>
              <Progress value={progressPct} className="h-3" />
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-sm font-semibold">{stats.processed.toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground">Processed</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                  <span className="text-sm font-semibold">{stats.skipped.toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground">Skipped (dupes)</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-sm font-semibold">{stats.failed.toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
            </div>

            {(state === "completed" || state === "failed") && (
              <Button variant="outline" size="sm" onClick={reset} className="w-full text-xs">
                Upload Another File
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error Report */}
      {stats.errors.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-red-600">
              Errors ({stats.errors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-[80px]">Row</TableHead>
                    <TableHead className="text-xs">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.errors.slice(0, 100).map((err, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{err.row_index}</TableCell>
                      <TableCell className="text-xs text-red-600">{err.error}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {stats.errors.length > 100 && (
              <p className="text-xs text-muted-foreground mt-2">
                Showing first 100 of {stats.errors.length} errors
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upload History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Upload History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : !uploadHistory?.data?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">No uploads yet</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">File Name</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs">Upload Date</TableHead>
                    <TableHead className="text-xs">Total Rows</TableHead>
                    <TableHead className="text-xs">Imported</TableHead>
                    <TableHead className="text-xs">Failed</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadHistory.data.map((upload) => (
                    <TableRow
                      key={upload.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openUploadDetail(upload.id)}
                    >
                      <TableCell className="text-xs font-medium max-w-[200px] truncate">{upload.filename}</TableCell>
                      <TableCell className="text-xs">{upload.source_type?.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {upload.created_at ? new Date(upload.created_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{upload.total_rows?.toLocaleString()}</TableCell>
                      <TableCell className="text-xs">
                        <span className="text-green-600">{upload.processed_rows?.toLocaleString()}</span>
                        {upload.skipped_rows > 0 && <span className="text-yellow-600 ml-1">(+{upload.skipped_rows} skipped)</span>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {upload.failed_rows > 0 ? (
                          <span className="text-red-500">{upload.failed_rows.toLocaleString()}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={upload.status === "completed" ? "default" : upload.status === "failed" ? "destructive" : "outline"}
                          className="text-[10px]"
                        >
                          {upload.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Upload Details — {detailData?.filename || "Loading..."}
            </DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detailData ? (
            <div className="space-y-4">
              {/* Summary info */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Source:</span> {detailData.source_type?.replace(/_/g, " ")}</div>
                <div><span className="text-muted-foreground">Status:</span> <Badge variant={detailData.status === "completed" ? "default" : detailData.status === "failed" ? "destructive" : "outline"} className="text-[10px] ml-1">{detailData.status}</Badge></div>
                <div><span className="text-muted-foreground">Uploaded:</span> {detailData.created_at ? new Date(detailData.created_at).toLocaleString() : "—"}</div>
                {detailData.uploaded_by && <div><span className="text-muted-foreground">By:</span> {detailData.uploaded_by}</div>}
              </div>

              {/* Progress bar with green/yellow/red breakdown */}
              {(() => {
                const total = detailData.total_rows || 1;
                const greenPct = ((detailData.processed_rows || 0) / total) * 100;
                const yellowPct = ((detailData.skipped_rows || 0) / total) * 100;
                const redPct = ((detailData.failed_rows || 0) / total) * 100;
                const successRate = Math.round(((detailData.processed_rows || 0) / total) * 100);
                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Success rate: {successRate}%</span>
                      <span className="text-muted-foreground">{detailData.total_rows?.toLocaleString()} total rows</span>
                    </div>
                    <div className="h-4 rounded-full overflow-hidden bg-muted flex">
                      {greenPct > 0 && <div className="bg-green-500 h-full" style={{ width: `${greenPct}%` }} />}
                      {yellowPct > 0 && <div className="bg-yellow-500 h-full" style={{ width: `${yellowPct}%` }} />}
                      {redPct > 0 && <div className="bg-red-500 h-full" style={{ width: `${redPct}%` }} />}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="flex items-center justify-center gap-1">
                        <div className="h-2 w-2 rounded-full bg-green-500" />
                        <span>{(detailData.processed_rows || 0).toLocaleString()} processed</span>
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <div className="h-2 w-2 rounded-full bg-yellow-500" />
                        <span>{(detailData.skipped_rows || 0).toLocaleString()} skipped</span>
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <div className="h-2 w-2 rounded-full bg-red-500" />
                        <span>{(detailData.failed_rows || 0).toLocaleString()} failed</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Skipped rows explanation */}
              {(detailData.skipped_rows || 0) > 0 && (
                <p className="text-xs text-yellow-700 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400 rounded-md px-3 py-2">
                  {detailData.skipped_rows} rows skipped as duplicates (already exist in database)
                </p>
              )}

              {/* Failed rows table */}
              {detailData.error_log && detailData.error_log.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium text-red-600">
                      Failed Rows ({detailData.error_log.length})
                    </h4>
                    <Button variant="outline" size="sm" onClick={downloadFailedRows} className="text-xs h-7 gap-1">
                      <Download className="h-3 w-3" />
                      Download Failed Rows as CSV
                    </Button>
                  </div>
                  <div className="rounded-md border overflow-x-auto max-h-[300px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs w-[60px]">Row</TableHead>
                          <TableHead className="text-xs">Error</TableHead>
                          <TableHead className="text-xs">Title</TableHead>
                          <TableHead className="text-xs">Company</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailData.error_log.slice(0, 100).map((err, i) => {
                          const raw = (err.raw || {}) as Record<string, any>;
                          return (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-mono">{err.row_index}</TableCell>
                              <TableCell className="text-xs text-red-600 max-w-[200px] truncate">{err.error}</TableCell>
                              <TableCell className="text-xs max-w-[120px] truncate">
                                {raw.title || raw["Job Title"] || raw.job_title || "—"}
                              </TableCell>
                              <TableCell className="text-xs max-w-[120px] truncate">
                                {raw.company_name || raw["Company Name"] || raw.employer_name || "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {detailData.error_log.length > 100 && (
                    <p className="text-xs text-muted-foreground">
                      Showing first 100 of {detailData.error_log.length} errors
                    </p>
                  )}
                </div>
              )}

              {/* No errors message */}
              {(!detailData.error_log || detailData.error_log.length === 0) && (detailData.failed_rows || 0) === 0 && (
                <p className="text-xs text-green-600 text-center py-4">No errors — all rows processed successfully</p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
