import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, BookOpen, Code2, Sparkles, MapPin, Calendar,
  GraduationCap, Loader2, Search, ExternalLink, BarChart3,
  Pencil, Trash2, Plus,
} from "lucide-react";
import { Link } from "wouter";
import { ResponsiveContainer, Tooltip as RTooltip, Cell, PieChart, Pie, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

const DEGREE_COLORS: Record<string, string> = {
  bachelor: "bg-blue-100 text-blue-700",
  master: "bg-purple-100 text-purple-700",
  phd: "bg-red-100 text-red-700",
  graduate_certificate: "bg-amber-100 text-amber-700",
  diploma: "bg-green-100 text-green-700",
};

const DEGREE_TYPES = ["bachelor", "master", "phd", "graduate_certificate", "diploma"];

const SKILL_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#6366f1"];

interface CollegeDetail {
  id: string;
  name: string;
  short_name: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  catalog_year: string | null;
  schools: any[];
  programs: any[];
  course_count: number;
}

interface Program {
  id: string;
  name: string;
  degree_type: string;
  abbreviation: string | null;
  major: string | null;
  school_name: string | null;
  school_id: string | null;
  course_count: number;
  skill_count: number;
  duration_years: number | null;
  total_credit_points: number | null;
  description: string | null;
  learning_outcomes: string[];
}

interface Course {
  id: string;
  code: string;
  name: string;
  credit_points: number;
  department_prefix: string | null;
  level: number | null;
  skill_count: number;
  description: string | null;
  prerequisites: string | null;
  hours_format: string | null;
}

// ==================== Edit College Dialog ====================
function EditCollegeDialog({ open, onOpenChange, college }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  college: CollegeDetail;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(college.name);
  const [shortName, setShortName] = useState(college.short_name || "");
  const [country, setCountry] = useState(college.country || "");
  const [city, setCity] = useState(college.city || "");
  const [website, setWebsite] = useState(college.website || "");
  const [catalogYear, setCatalogYear] = useState(college.catalog_year || "");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/colleges/${college.id}`, {
        name, short_name: shortName || null, country: country || null,
        city: city || null, website: website || null, catalog_year: catalogYear || null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "College updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", college.id] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit College</DialogTitle>
          <DialogDescription>Update college information.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Name *</Label>
            <Input className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Short Name</Label>
              <Input className="h-8 text-xs" value={shortName} onChange={(e) => setShortName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Catalog Year</Label>
              <Input className="h-8 text-xs" value={catalogYear} onChange={(e) => setCatalogYear(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Country</Label>
              <Input className="h-8 text-xs" value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">City</Label>
              <Input className="h-8 text-xs" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Website</Label>
            <Input className="h-8 text-xs" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!name || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Program Dialog (Create/Edit) ====================
function ProgramDialog({ open, onOpenChange, collegeId, schools, program }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collegeId: string;
  schools: any[];
  program?: Program | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!program;

  const [name, setName] = useState(program?.name || "");
  const [schoolId, setSchoolId] = useState(program?.school_id || "none");
  const [degreeType, setDegreeType] = useState(program?.degree_type || "bachelor");
  const [abbreviation, setAbbreviation] = useState(program?.abbreviation || "");
  const [major, setMajor] = useState(program?.major || "");
  const [durationYears, setDurationYears] = useState(program?.duration_years?.toString() || "");
  const [totalCreditPoints, setTotalCreditPoints] = useState(program?.total_credit_points?.toString() || "");
  const [description, setDescription] = useState(program?.description || "");
  const [learningOutcomes, setLearningOutcomes] = useState((program?.learning_outcomes || []).join("\n"));

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        school_id: schoolId === "none" ? null : schoolId,
        degree_type: degreeType,
        abbreviation: abbreviation || null,
        major: major || null,
        duration_years: durationYears ? parseFloat(durationYears) : null,
        total_credit_points: totalCreditPoints ? parseInt(totalCreditPoints) : null,
        description: description || null,
        learning_outcomes: learningOutcomes ? learningOutcomes.split("\n").filter((s) => s.trim()) : [],
      };
      if (isEdit) {
        const res = await apiRequest("PATCH", `/api/colleges/${collegeId}/programs/${program.id}`, body);
        return res.json();
      } else {
        const res = await apiRequest("POST", `/api/colleges/${collegeId}/programs`, body);
        return res.json();
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Program updated" : "Program created" });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "programs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Program" : "Add Program"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update program details." : "Create a new program."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Name *</Label>
            <Input className="h-8 text-xs" placeholder="e.g. Bachelor of Computer Science" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Degree Type *</Label>
              <Select value={degreeType} onValueChange={setDegreeType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEGREE_TYPES.map((d) => (
                    <SelectItem key={d} value={d}>{d.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">School</Label>
              <Select value={schoolId} onValueChange={setSchoolId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No school</SelectItem>
                  {schools.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Abbreviation</Label>
              <Input className="h-8 text-xs" placeholder="e.g. BCS" value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Major/Specialization</Label>
              <Input className="h-8 text-xs" placeholder="e.g. Data Science" value={major} onChange={(e) => setMajor(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Duration (years)</Label>
              <Input className="h-8 text-xs" type="number" value={durationYears} onChange={(e) => setDurationYears(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Total Credit Points</Label>
              <Input className="h-8 text-xs" type="number" value={totalCreditPoints} onChange={(e) => setTotalCreditPoints(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea className="text-xs min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Learning Outcomes (one per line)</Label>
            <Textarea className="text-xs min-h-[80px]" placeholder="Enter each learning outcome on a new line" value={learningOutcomes} onChange={(e) => setLearningOutcomes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!name || !degreeType || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Course Dialog (Create/Edit) ====================
function CourseDialog({ open, onOpenChange, collegeId, course }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collegeId: string;
  course?: Course | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!course;

  const [code, setCode] = useState(course?.code || "");
  const [name, setName] = useState(course?.name || "");
  const [creditPoints, setCreditPoints] = useState(course?.credit_points?.toString() || "6");
  const [description, setDescription] = useState(course?.description || "");
  const [prerequisites, setPrerequisites] = useState(course?.prerequisites || "");
  const [hoursFormat, setHoursFormat] = useState(course?.hours_format || "");

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        code, name,
        credit_points: parseInt(creditPoints) || 6,
        description: description || null,
        prerequisites: prerequisites || null,
        hours_format: hoursFormat || null,
      };
      if (isEdit) {
        const res = await apiRequest("PATCH", `/api/colleges/${collegeId}/courses/${course.id}`, body);
        return res.json();
      } else {
        const res = await apiRequest("POST", `/api/colleges/${collegeId}/courses`, body);
        return res.json();
      }
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Course updated" : "Course created" });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "courses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Course" : "Add Course"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update course details." : "Create a new course."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Code *</Label>
              <Input className="h-8 text-xs font-mono" placeholder="e.g. ACCY121" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Credit Points</Label>
              <Input className="h-8 text-xs" type="number" value={creditPoints} onChange={(e) => setCreditPoints(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Name *</Label>
            <Input className="h-8 text-xs" placeholder="e.g. Introduction to Accounting" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea className="text-xs min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prerequisites</Label>
            <Input className="h-8 text-xs" placeholder="e.g. ACCY121 & ACCY122" value={prerequisites} onChange={(e) => setPrerequisites(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hours Format</Label>
            <Input className="h-8 text-xs" placeholder="e.g. L-2, T-2" value={hoursFormat} onChange={(e) => setHoursFormat(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!code || !name || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Delete Confirmation Dialog ====================
function DeleteConfirmDialog({ open, onOpenChange, title, description, onConfirm, isPending }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ==================== Main College Detail Page ====================
export default function CollegeDetail({ params }: { params: { id: string } }) {
  const collegeId = params.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("programs");
  const [courseSearch, setCourseSearch] = useState("");
  const [prefixFilter, setPrefixFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);

  // Dialog states
  const [editCollegeOpen, setEditCollegeOpen] = useState(false);
  const [programDialogOpen, setProgramDialogOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "program" | "course"; id: string; name: string } | null>(null);

  const { data: college, isLoading } = useQuery<CollegeDetail>({
    queryKey: ["/api/colleges", collegeId],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}`);
      if (!res.ok) throw new Error("Failed to fetch college");
      return res.json();
    },
  });

  const { data: programs } = useQuery<Program[]>({
    queryKey: ["/api/colleges", collegeId, "programs"],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/programs`);
      if (!res.ok) throw new Error("Failed to fetch programs");
      return res.json();
    },
    enabled: !!collegeId,
  });

  const courseParams = new URLSearchParams();
  if (courseSearch) courseParams.set("search", courseSearch);
  if (prefixFilter !== "all") courseParams.set("prefix", prefixFilter);
  if (levelFilter !== "all") courseParams.set("level", levelFilter);

  const { data: courses } = useQuery<Course[]>({
    queryKey: ["/api/colleges", collegeId, "courses", courseParams.toString()],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/courses?${courseParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch courses");
      return res.json();
    },
    enabled: !!collegeId && tab === "courses",
  });

  const { data: heatmapData } = useQuery<any[]>({
    queryKey: ["/api/college/program-skill-heatmap", collegeId],
    queryFn: async () => {
      const res = await authFetch(`/api/college/program-skill-heatmap/${collegeId}`);
      if (!res.ok) throw new Error("Failed to fetch heatmap");
      return res.json();
    },
    enabled: !!collegeId && tab === "skills",
  });

  const { data: gapData } = useQuery<{ gaps: Record<string, string[]>; total: number }>({
    queryKey: ["/api/college/skill-gaps", collegeId],
    queryFn: async () => {
      const res = await authFetch(`/api/college/skill-gaps/${collegeId}`);
      if (!res.ok) throw new Error("Failed to fetch gaps");
      return res.json();
    },
    enabled: !!collegeId && tab === "analytics",
  });

  const { data: comparisonData } = useQuery<any>({
    queryKey: ["/api/college/compare-programs", compareIds.join(",")],
    queryFn: async () => {
      const res = await authFetch(`/api/college/compare-programs?program_ids=${compareIds.join(",")}`);
      if (!res.ok) throw new Error("Failed to compare");
      return res.json();
    },
    enabled: compareIds.length >= 2 && tab === "analytics",
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) return;
      if (deleteTarget.type === "program") {
        await apiRequest("DELETE", `/api/colleges/${collegeId}/programs/${deleteTarget.id}`);
      } else {
        await apiRequest("DELETE", `/api/colleges/${collegeId}/courses/${deleteTarget.id}`);
      }
    },
    onSuccess: () => {
      toast({ title: `${deleteTarget?.type === "program" ? "Program" : "Course"} deleted` });
      if (deleteTarget?.type === "program") {
        queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "programs"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "courses"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!college) return <div className="text-center py-20 text-muted-foreground">College not found</div>;

  // Build heatmap chart data
  const heatmapChartData = (() => {
    if (!heatmapData) return [];
    const categories = Array.from(new Set(heatmapData.map((h: any) => h.skill_category)));
    const programNames = Array.from(new Set(heatmapData.map((h: any) => h.program_name)));
    return programNames.map((pName) => {
      const row: Record<string, any> = { program: pName.length > 25 ? pName.slice(0, 25) + "..." : pName };
      for (const cat of categories) {
        const match = heatmapData.find((h: any) => h.program_name === pName && h.skill_category === cat);
        row[cat] = match ? Number(match.skill_count) : 0;
      }
      return row;
    });
  })();

  const heatmapCategories = heatmapData ? Array.from(new Set(heatmapData.map((h: any) => h.skill_category))) : [];

  // Unique prefixes for filter
  const prefixes = courses ? Array.from(new Set(courses.map((c) => c.department_prefix).filter(Boolean))) : [];

  // Group programs by school
  const programsBySchool: Record<string, Program[]> = {};
  for (const p of programs || []) {
    const school = p.school_name || "Other";
    if (!programsBySchool[school]) programsBySchool[school] = [];
    programsBySchool[school].push(p);
  }

  const toggleCompare = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/colleges">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{college.name}</h1>
            {college.short_name && <Badge variant="secondary">{college.short_name}</Badge>}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditCollegeOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Link href={`/colleges/${collegeId}/insights`}>
              <Button variant="outline" size="sm">
                <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Alumni insights
              </Button>
            </Link>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
            {(college.city || college.country) && (
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[college.city, college.country].filter(Boolean).join(", ")}</span>
            )}
            {college.catalog_year && (
              <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Catalog {college.catalog_year}</span>
            )}
            {college.website && (
              <a href={college.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" />Website
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <BookOpen className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{college.programs.length}</p>
                <p className="text-sm text-muted-foreground">Programs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Code2 className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{college.course_count}</p>
                <p className="text-sm text-muted-foreground">Courses</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <GraduationCap className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{college.schools.length}</p>
                <p className="text-sm text-muted-foreground">Schools</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="programs">Programs</TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="skills">Skill Coverage</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* Programs Tab */}
        <TabsContent value="programs" className="space-y-6">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setEditingProgram(null); setProgramDialogOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add Program
            </Button>
          </div>
          {Object.entries(programsBySchool).map(([school, progs]) => (
            <div key={school}>
              <h3 className="text-lg font-semibold mb-3">{school}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {progs.map((p) => (
                  <Card key={p.id} className="hover:border-primary/50 transition-colors">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between">
                        <Link href={`/colleges/${collegeId}/programs/${p.id}`}>
                          <div className="cursor-pointer flex-1">
                            <p className="font-medium">{p.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge className={DEGREE_COLORS[p.degree_type] || "bg-gray-100 text-gray-700"}>
                                {p.degree_type?.replace(/_/g, " ")}
                              </Badge>
                              {p.abbreviation && <Badge variant="outline">{p.abbreviation}</Badge>}
                            </div>
                          </div>
                        </Link>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.preventDefault(); setEditingProgram(p); setProgramDialogOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.preventDefault(); setDeleteTarget({ type: "program", id: p.id, name: p.name }); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <span>{p.course_count} courses</span>
                        <span>{p.skill_count} skills</span>
                        {p.duration_years && <span>{p.duration_years}yr</span>}
                        {p.total_credit_points && <span>{p.total_credit_points}cp</span>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </TabsContent>

        {/* Courses Tab */}
        <TabsContent value="courses" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search courses..." value={courseSearch} onChange={(e) => setCourseSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={prefixFilter} onValueChange={setPrefixFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Prefix" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Prefixes</SelectItem>
                {prefixes.map((p) => <SelectItem key={p!} value={p!}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="Level" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                {[100, 200, 300, 400].map((l) => <SelectItem key={l} value={String(l)}>{l}-level</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => { setEditingCourse(null); setCourseDialogOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add Course
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Skills</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(courses || []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono font-medium cursor-pointer" onClick={() => window.location.hash = `#/colleges/${collegeId}/courses/${c.id}`}>{c.code}</TableCell>
                    <TableCell className="cursor-pointer" onClick={() => window.location.hash = `#/colleges/${collegeId}/courses/${c.id}`}>{c.name}</TableCell>
                    <TableCell>{c.credit_points}</TableCell>
                    <TableCell>{c.level}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{c.skill_count}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingCourse(c); setCourseDialogOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget({ type: "course", id: c.id, name: `${c.code} — ${c.name}` })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!courses || courses.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No courses found</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Skill Coverage Tab */}
        <TabsContent value="skills" className="space-y-4">
          {heatmapChartData.length > 0 ? (
            <Card>
              <CardHeader><CardTitle>Program Skill Heatmap</CardTitle></CardHeader>
              <CardContent>
                <div className="w-full" style={{ height: Math.max(400, heatmapChartData.length * 50) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={heatmapChartData} layout="vertical" margin={{ left: 150, right: 20, top: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="program" width={150} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {heatmapCategories.map((cat, i) => (
                        <Bar key={cat} dataKey={cat} stackId="a" fill={SKILL_COLORS[i % SKILL_COLORS.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-50" />
                No skill data available yet
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Program Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Program Comparison</CardTitle>
              <p className="text-sm text-muted-foreground">Select 2-4 programs to compare skill profiles</p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                {(programs || []).map((p) => (
                  <Badge
                    key={p.id}
                    variant={compareIds.includes(p.id) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleCompare(p.id)}
                  >
                    {p.name}
                  </Badge>
                ))}
              </div>
              {comparisonData && (
                <div>
                  <div className="mb-4 text-sm text-muted-foreground">
                    {comparisonData.skills?.length || 0} skills compared across {comparisonData.programs?.length || 0} programs
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Skill</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Programs</TableHead>
                        <TableHead>Coverage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(comparisonData.skills || []).slice(0, 50).map((s: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{s.skill_name}</TableCell>
                          <TableCell><Badge variant="secondary">{s.skill_category}</Badge></TableCell>
                          <TableCell className="text-sm">{(s.program_names || []).join(", ")}</TableCell>
                          <TableCell>
                            <Badge variant={s.program_count === compareIds.length ? "default" : "outline"}>
                              {s.program_count}/{compareIds.length}
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

          {/* Skill Gaps */}
          <Card>
            <CardHeader>
              <CardTitle>Skill Gap Analysis</CardTitle>
              <p className="text-sm text-muted-foreground">Taxonomy skills not covered by any program ({gapData?.total || 0} gaps)</p>
            </CardHeader>
            <CardContent>
              {gapData && Object.keys(gapData.gaps).length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(gapData.gaps).map(([category, skills]) => (
                    <div key={category}>
                      <h4 className="font-medium mb-2">{category} ({skills.length})</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {skills.slice(0, 20).map((s) => (
                          <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                        ))}
                        {skills.length > 20 && <Badge variant="secondary" className="text-xs">+{skills.length - 20} more</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm py-4">No gap data available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {editCollegeOpen && (
        <EditCollegeDialog open={editCollegeOpen} onOpenChange={setEditCollegeOpen} college={college} />
      )}
      {programDialogOpen && (
        <ProgramDialog
          open={programDialogOpen}
          onOpenChange={setProgramDialogOpen}
          collegeId={collegeId}
          schools={college.schools}
          program={editingProgram}
        />
      )}
      {courseDialogOpen && (
        <CourseDialog
          open={courseDialogOpen}
          onOpenChange={setCourseDialogOpen}
          collegeId={collegeId}
          course={editingCourse}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title={`Delete ${deleteTarget.type === "program" ? "Program" : "Course"}`}
          description={`Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.${deleteTarget.type === "course" ? " This will also remove it from any programs it's assigned to." : ""}`}
          onConfirm={() => deleteMutation.mutate()}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
