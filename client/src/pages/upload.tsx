import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Upload, Download, FileUp, CheckCircle2, XCircle, AlertTriangle, Loader2, History } from "lucide-react";
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

const CHUNK_SIZE = 500;

interface UploadStats {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  errors: Array<{ row_index: number; error: string; raw?: Record<string, unknown> }>;
}

export default function UploadPage() {
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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

      // Process chunks sequentially
      let totalProcessed = 0;
      let totalSkipped = 0;
      let totalFailed = 0;
      const allErrors: any[] = [];

      for (let i = 0; i < parsedData.length; i += CHUNK_SIZE) {
        const chunk = parsedData.slice(i, i + CHUNK_SIZE);

        const batchRes = await apiRequest("POST", "/api/upload/batch", {
          upload_id,
          source_type: sourceType,
          rows: chunk,
        });

        const { batch_result } = await batchRes.json();
        totalProcessed += batch_result.processed;
        totalSkipped += batch_result.skipped;
        totalFailed += batch_result.failed;
        allErrors.push(...(batch_result.errors || []));

        setStats({
          processed: totalProcessed,
          skipped: totalSkipped,
          failed: totalFailed,
          total: parsedData.length,
          errors: allErrors,
        });
      }

      setState(totalFailed > totalProcessed ? "failed" : "completed");
      toast({
        title: totalFailed > totalProcessed ? "Upload completed with errors" : "Upload completed",
        description: `${totalProcessed} processed, ${totalSkipped} skipped, ${totalFailed} failed`,
        variant: totalFailed > totalProcessed ? "destructive" : "default",
      });
    } catch (err: any) {
      setState("failed");
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  };

  const reset = () => {
    setState("idle");
    setFile(null);
    setParsedData([]);
    setHeaders([]);
    setStats({ processed: 0, skipped: 0, failed: 0, total: 0, errors: [] });
    setUploadId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
                <span>Progress</span>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadHistory.data.map((upload) => (
                    <TableRow key={upload.id}>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
