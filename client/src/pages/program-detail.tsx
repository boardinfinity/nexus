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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, BookOpen, Clock, Award, Loader2, GraduationCap,
  Pencil, Trash2, Plus, Search, X,
} from "lucide-react";
import { Link } from "wouter";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

const COURSE_TYPE_COLORS: Record<string, string> = {
  core: "bg-blue-100 text-blue-700 border-blue-200",
  major: "bg-purple-100 text-purple-700 border-purple-200",
  elective: "bg-green-100 text-green-700 border-green-200",
  capstone: "bg-amber-100 text-amber-700 border-amber-200",
  general_education: "bg-gray-100 text-gray-700 border-gray-200",
};

const COURSE_TYPES = ["core", "major", "elective", "capstone", "general_education"];

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#6366f1"];

const DEGREE_LABELS: Record<string, string> = {
  bachelor: "Bachelor's Degree",
  master: "Master's Degree",
  phd: "Doctorate",
  graduate_certificate: "Graduate Certificate",
  diploma: "Diploma",
};

const DEGREE_TYPES = ["bachelor", "master", "phd", "graduate_certificate", "diploma"];

interface ProgramDetail {
  id: string;
  name: string;
  degree_type: string;
  abbreviation: string | null;
  major: string | null;
  school_name: string | null;
  school_id: string | null;
  college_id: string;
  duration_years: number | null;
  total_credit_points: number | null;
  qf_emirates_level: number | null;
  delivery_mode: string | null;
  description: string | null;
  learning_outcomes: string[];
  intake_sessions: string[];
  courses: any[];
  skills: any[];
}

// ==================== Edit Program Dialog ====================
function EditProgramDialog({ open, onOpenChange, program, collegeId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  program: ProgramDetail;
  collegeId: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState(program.name);
  const [degreeType, setDegreeType] = useState(program.degree_type);
  const [abbreviation, setAbbreviation] = useState(program.abbreviation || "");
  const [major, setMajor] = useState(program.major || "");
  const [durationYears, setDurationYears] = useState(program.duration_years?.toString() || "");
  const [totalCreditPoints, setTotalCreditPoints] = useState(program.total_credit_points?.toString() || "");
  const [description, setDescription] = useState(program.description || "");
  const [learningOutcomes, setLearningOutcomes] = useState((program.learning_outcomes || []).join("\n"));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/colleges/${collegeId}/programs/${program.id}`, {
        name, degree_type: degreeType,
        abbreviation: abbreviation || null, major: major || null,
        duration_years: durationYears ? parseFloat(durationYears) : null,
        total_credit_points: totalCreditPoints ? parseInt(totalCreditPoints) : null,
        description: description || null,
        learning_outcomes: learningOutcomes ? learningOutcomes.split("\n").filter((s) => s.trim()) : [],
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Program updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "programs", program.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "programs"] });
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
          <DialogTitle>Edit Program</DialogTitle>
          <DialogDescription>Update program details.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Name *</Label>
            <Input className="h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
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
              <Label className="text-xs">Abbreviation</Label>
              <Input className="h-8 text-xs" value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Major/Specialization</Label>
              <Input className="h-8 text-xs" value={major} onChange={(e) => setMajor(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duration (years)</Label>
              <Input className="h-8 text-xs" type="number" value={durationYears} onChange={(e) => setDurationYears(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Total Credit Points</Label>
            <Input className="h-8 text-xs" type="number" value={totalCreditPoints} onChange={(e) => setTotalCreditPoints(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea className="text-xs min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Learning Outcomes (one per line)</Label>
            <Textarea className="text-xs min-h-[80px]" value={learningOutcomes} onChange={(e) => setLearningOutcomes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!name || !degreeType || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Add Course to Program Dialog ====================
function AddCourseDialog({ open, onOpenChange, collegeId, programId, existingCourseIds }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collegeId: string;
  programId: string;
  existingCourseIds: string[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [courseType, setCourseType] = useState("core");
  const [yearOfStudy, setYearOfStudy] = useState("1");

  const { data: allCourses } = useQuery<any[]>({
    queryKey: ["/api/colleges", collegeId, "courses", "all-for-assignment"],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/courses`);
      if (!res.ok) throw new Error("Failed to fetch courses");
      return res.json();
    },
    enabled: open,
  });

  const availableCourses = (allCourses || []).filter(
    (c: any) => !existingCourseIds.includes(c.id) &&
    (search === "" || c.code.toLowerCase().includes(search.toLowerCase()) || c.name.toLowerCase().includes(search.toLowerCase()))
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/colleges/${collegeId}/programs/${programId}/courses`, {
        course_id: selectedCourseId,
        course_type: courseType,
        year_of_study: parseInt(yearOfStudy),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Course added to program" });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "programs", programId] });
      setSelectedCourseId("");
      setSearch("");
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
          <DialogTitle>Add Course to Program</DialogTitle>
          <DialogDescription>Search and select a course to add.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Search Course</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="h-8 text-xs pl-8" placeholder="Search by code or name..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto border rounded-md">
            {availableCourses.length > 0 ? (
              availableCourses.slice(0, 50).map((c: any) => (
                <div
                  key={c.id}
                  className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-muted/50 ${selectedCourseId === c.id ? "bg-primary/10 border-l-2 border-primary" : ""}`}
                  onClick={() => setSelectedCourseId(c.id)}
                >
                  <div>
                    <span className="font-mono font-medium">{c.code}</span>
                    <span className="ml-2 text-muted-foreground">{c.name}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{c.credit_points}cp</Badge>
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-xs text-center text-muted-foreground">
                {search ? "No matching courses found" : "All courses already assigned"}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Course Type</Label>
              <Select value={courseType} onValueChange={setCourseType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COURSE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Year of Study</Label>
              <Select value={yearOfStudy} onValueChange={setYearOfStudy}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((y) => (
                    <SelectItem key={y} value={String(y)}>Year {y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={!selectedCourseId || mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Add Course
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== Main Program Detail Page ====================
export default function ProgramDetail({ params }: { params: { id: string; pid: string } }) {
  const { id: collegeId, pid: programId } = params;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [addCourseOpen, setAddCourseOpen] = useState(false);
  const [removingCourseId, setRemovingCourseId] = useState<string | null>(null);

  const { data: program, isLoading } = useQuery<ProgramDetail>({
    queryKey: ["/api/colleges", collegeId, "programs", programId],
    queryFn: async () => {
      const res = await authFetch(`/api/colleges/${collegeId}/programs/${programId}`);
      if (!res.ok) throw new Error("Failed to fetch program");
      return res.json();
    },
  });

  const { data: skillCoverage } = useQuery<{ categories: any[] }>({
    queryKey: ["/api/college/skill-coverage", programId],
    queryFn: async () => {
      const res = await authFetch(`/api/college/skill-coverage/${programId}`);
      if (!res.ok) throw new Error("Failed to fetch skill coverage");
      return res.json();
    },
    enabled: !!programId,
  });

  const removeCourse = useMutation({
    mutationFn: async (courseId: string) => {
      await apiRequest("DELETE", `/api/colleges/${collegeId}/programs/${programId}/courses/${courseId}`);
    },
    onSuccess: () => {
      toast({ title: "Course removed from program" });
      queryClient.invalidateQueries({ queryKey: ["/api/colleges", collegeId, "programs", programId] });
      setRemovingCourseId(null);
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

  if (!program) return <div className="text-center py-20 text-muted-foreground">Program not found</div>;

  // Group courses by year
  const coursesByYear: Record<number, any[]> = {};
  for (const pc of program.courses || []) {
    const year = pc.year_of_study || 0;
    if (!coursesByYear[year]) coursesByYear[year] = [];
    coursesByYear[year].push(pc);
  }
  const years = Object.keys(coursesByYear).map(Number).sort();

  // Skill category donut data
  const categoryData = (skillCoverage?.categories || []).map((c: any, i: number) => ({
    name: c.name,
    value: c.skill_count,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  // Unique skills list
  const uniqueSkills = new Map<string, any>();
  for (const s of program.skills || []) {
    if (!uniqueSkills.has(s.skill_name)) {
      uniqueSkills.set(s.skill_name, s);
    }
  }

  const existingCourseIds = (program.courses || []).map((pc: any) => pc.course_id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/colleges/${collegeId}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{program.name}</h1>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <Badge className="bg-blue-100 text-blue-700">{DEGREE_LABELS[program.degree_type] || program.degree_type}</Badge>
            {program.abbreviation && <Badge variant="outline">{program.abbreviation}</Badge>}
            {program.school_name && <span className="text-sm text-muted-foreground">{program.school_name}</span>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {program.duration_years && (
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{program.duration_years} years</p>
                <p className="text-xs text-muted-foreground">Duration</p>
              </div>
            </CardContent>
          </Card>
        )}
        {program.total_credit_points && (
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Award className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{program.total_credit_points}</p>
                <p className="text-xs text-muted-foreground">Credit Points</p>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-lg font-bold">{program.courses?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Courses</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <GraduationCap className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-lg font-bold">{uniqueSkills.size}</p>
              <p className="text-xs text-muted-foreground">Skills</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Description */}
      {program.description && (
        <Card>
          <CardHeader><CardTitle>Description</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">{program.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Learning Outcomes */}
      {program.learning_outcomes?.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Learning Outcomes</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {program.learning_outcomes.map((outcome, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-primary font-medium shrink-0">{i + 1}.</span>
                  <span className="text-muted-foreground">{outcome}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Course Journey */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Course Journey</CardTitle>
            <Button size="sm" onClick={() => setAddCourseOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add Course
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {years.length > 0 ? (
            <div className="space-y-6">
              {years.map((year) => (
                <div key={year}>
                  <h4 className="font-semibold mb-3">{year === 0 ? "Unassigned" : `Year ${year}`}</h4>
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {coursesByYear[year].map((pc: any) => (
                      <div
                        key={pc.id}
                        className={`border rounded-lg p-3 hover:shadow-sm transition-shadow ${COURSE_TYPE_COLORS[pc.course_type] || "bg-gray-50"}`}
                      >
                        <div className="flex items-start justify-between">
                          <div
                            className="cursor-pointer flex-1"
                            onClick={() => window.location.hash = `#/colleges/${collegeId}/courses/${pc.course_id}`}
                          >
                            <p className="font-mono text-xs">{pc.college_courses?.code}</p>
                            <p className="text-sm font-medium mt-0.5">{pc.college_courses?.name}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-1">
                            <Badge variant="outline" className="text-[10px]">
                              {pc.course_type?.replace(/_/g, " ")}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              onClick={() => setRemovingCourseId(pc.course_id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        {pc.recommended_term && (
                          <p className="text-xs mt-1 opacity-70">{pc.recommended_term}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm py-4">No courses mapped to this program yet</p>
          )}
        </CardContent>
      </Card>

      {/* Skill Profile */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Skill Profile</CardTitle></CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {categoryData.map((entry: any, i: number) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">No skill data available</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>All Skills ({uniqueSkills.size})</CardTitle></CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-y-auto space-y-1.5">
              {Array.from(uniqueSkills.values())
                .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
                .map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span>{s.skill_name}</span>
                      <Badge variant="secondary" className="text-[10px]">{s.skill_category}</Badge>
                    </div>
                    <div className="w-16 bg-muted rounded-full h-1.5">
                      <div
                        className="bg-primary rounded-full h-1.5"
                        style={{ width: `${(s.confidence || 0) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              {uniqueSkills.size === 0 && (
                <p className="text-muted-foreground text-sm py-4 text-center">No skills extracted yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialogs */}
      {editOpen && (
        <EditProgramDialog open={editOpen} onOpenChange={setEditOpen} program={program} collegeId={collegeId} />
      )}
      {addCourseOpen && (
        <AddCourseDialog
          open={addCourseOpen}
          onOpenChange={setAddCourseOpen}
          collegeId={collegeId}
          programId={programId}
          existingCourseIds={existingCourseIds}
        />
      )}
      <AlertDialog open={!!removingCourseId} onOpenChange={(open) => { if (!open) setRemovingCourseId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Course</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this course from the program? The course itself will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removingCourseId && removeCourse.mutate(removingCourseId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeCourse.isPending}
            >
              {removeCourse.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
