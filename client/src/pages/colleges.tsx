import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  GraduationCap, Upload, Search, BookOpen, Code2, Sparkles,
  Loader2, CheckCircle2, XCircle, Building2, MapPin, Calendar,
} from "lucide-react";
import { Link } from "wouter";

interface College {
  id: string;
  name: string;
  short_name: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  catalog_year: string | null;
  program_count: number;
  course_count: number;
  skill_count: number;
  created_at: string;
}

interface CatalogUpload {
  id: string;
  status: string;
  progress: any;
  extraction_results: any;
  error_message: string | null;
  college_id: string | null;
}

export default function Colleges() {
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadStep, setUploadStep] = useState(1);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [collegeName, setCollegeName] = useState("");
  const [catalogYear, setCatalogYear] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: colleges, isLoading } = useQuery<College[]>({
    queryKey: ["/api/colleges"],
    queryFn: async () => {
      const res = await authFetch("/api/colleges");
      if (!res.ok) throw new Error("Failed to fetch colleges");
      return res.json();
    },
  });

  const { data: processingStatus } = useQuery<CatalogUpload>({
    queryKey: ["/api/college/processing-status", uploadId],
    queryFn: async () => {
      const res = await authFetch(`/api/college/processing-status/${uploadId}`);
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json();
    },
    enabled: !!uploadId && uploadStep === 3,
    refetchInterval: 3000,
  });

  // Auto-advance to step 4 when processing completes
  if (processingStatus?.status === "completed" && uploadStep === 3) {
    setUploadStep(4);
    queryClient.invalidateQueries({ queryKey: ["/api/colleges"] });
  }
  if (processingStatus?.status === "failed" && uploadStep === 3) {
    setUploadStep(4);
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      const res = await apiRequest("POST", "/api/college/upload-catalog", {
        file_name: selectedFile.name,
        file_data: base64,
        file_size_bytes: selectedFile.size,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setUploadId(data.id);
      setUploadStep(2);
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/college/process-catalog", {
        upload_id: uploadId,
        college_name: collegeName || undefined,
        catalog_year: catalogYear || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setUploadStep(3);
    },
    onError: (err: Error) => {
      toast({ title: "Processing failed", description: err.message, variant: "destructive" });
    },
  });

  const resetUpload = () => {
    setUploadStep(1);
    setUploadId(null);
    setCollegeName("");
    setCatalogYear("");
    setSelectedFile(null);
    setUploadOpen(false);
  };

  const filtered = (colleges || []).filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.short_name?.toLowerCase().includes(search.toLowerCase())
  );

  const progressPct = processingStatus?.progress?.pages_processed && processingStatus?.progress?.total_pages
    ? Math.round((processingStatus.progress.pages_processed / processingStatus.progress.total_pages) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">College Explorer</h1>
          <p className="text-muted-foreground">Upload academic catalogs and explore program intelligence</p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Upload Catalog
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search colleges..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <GraduationCap className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No colleges yet</h3>
            <p className="text-muted-foreground mt-1">Upload an academic catalog PDF to get started</p>
            <Button className="mt-4" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Catalog
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((college) => (
            <Link key={college.id} href={`/colleges/${college.id}`}>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{college.name}</CardTitle>
                      {college.short_name && (
                        <Badge variant="secondary" className="mt-1">{college.short_name}</Badge>
                      )}
                    </div>
                    <GraduationCap className="h-5 w-5 text-muted-foreground shrink-0" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {(college.city || college.country) && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{[college.city, college.country].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                    {college.catalog_year && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>Catalog {college.catalog_year}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-4 pt-3 border-t text-sm">
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-blue-500" />
                      <span className="font-medium">{college.program_count}</span>
                      <span className="text-muted-foreground">programs</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Code2 className="h-3.5 w-3.5 text-green-500" />
                      <span className="font-medium">{college.course_count}</span>
                      <span className="text-muted-foreground">courses</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                      <span className="font-medium">{college.skill_count}</span>
                      <span className="text-muted-foreground">skills</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      <Dialog open={uploadOpen} onOpenChange={(o) => { if (!o) resetUpload(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {uploadStep === 1 && "Upload Academic Catalog"}
              {uploadStep === 2 && "Confirm Details"}
              {uploadStep === 3 && "Processing Catalog"}
              {uploadStep === 4 && "Processing Complete"}
            </DialogTitle>
          </DialogHeader>

          {uploadStep === 1 && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                {selectedFile ? (
                  <div>
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium">Click to upload PDF</p>
                    <p className="text-sm text-muted-foreground">Academic catalog PDF file</p>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
              <DialogFooter>
                <Button
                  disabled={!selectedFile || uploadMutation.isPending}
                  onClick={() => uploadMutation.mutate()}
                >
                  {uploadMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Upload
                </Button>
              </DialogFooter>
            </div>
          )}

          {uploadStep === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>College Name (optional — AI will detect)</Label>
                <Input
                  value={collegeName}
                  onChange={(e) => setCollegeName(e.target.value)}
                  placeholder="e.g. University of Wollongong in Dubai"
                />
              </div>
              <div className="space-y-2">
                <Label>Catalog Year (optional)</Label>
                <Input
                  value={catalogYear}
                  onChange={(e) => setCatalogYear(e.target.value)}
                  placeholder="e.g. 2025-2026"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUploadStep(1)}>Back</Button>
                <Button
                  disabled={processMutation.isPending}
                  onClick={() => processMutation.mutate()}
                >
                  {processMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Start Processing
                </Button>
              </DialogFooter>
            </div>
          )}

          {uploadStep === 3 && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="font-medium capitalize">
                  {processingStatus?.progress?.current_step?.replace(/_/g, " ") || "Starting..."}
                </span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <div className="text-sm text-muted-foreground space-y-1">
                {processingStatus?.progress?.schools_found != null && (
                  <p>Schools found: {processingStatus.progress.schools_found}</p>
                )}
                {processingStatus?.progress?.programs_found != null && (
                  <p>Programs found: {processingStatus.progress.programs_found}</p>
                )}
                {processingStatus?.progress?.courses_found != null && (
                  <p>Courses found: {processingStatus.progress.courses_found}</p>
                )}
                {processingStatus?.progress?.skills_progress && (
                  <p>Skill extraction: {processingStatus.progress.skills_progress}</p>
                )}
              </div>
            </div>
          )}

          {uploadStep === 4 && (
            <div className="space-y-4 py-4">
              {processingStatus?.status === "completed" ? (
                <>
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                    <span className="font-medium">Processing Complete</span>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                    <p>Schools: <span className="font-medium">{processingStatus.extraction_results?.schools || 0}</span></p>
                    <p>Programs: <span className="font-medium">{processingStatus.extraction_results?.programs || 0}</span></p>
                    <p>Courses: <span className="font-medium">{processingStatus.extraction_results?.courses || 0}</span></p>
                    <p>Skills extracted: <span className="font-medium">{processingStatus.extraction_results?.skills || 0}</span></p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <XCircle className="h-6 w-6 text-red-500" />
                    <span className="font-medium">Processing Failed</span>
                  </div>
                  {processingStatus?.error_message && (
                    <p className="text-sm text-red-600">{processingStatus.error_message}</p>
                  )}
                </>
              )}
              <DialogFooter>
                {processingStatus?.college_id && (
                  <Link href={`/colleges/${processingStatus.college_id}`}>
                    <Button onClick={resetUpload}>View College</Button>
                  </Link>
                )}
                <Button variant="outline" onClick={resetUpload}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
